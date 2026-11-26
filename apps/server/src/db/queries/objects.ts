import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { bindParamLimit, chunk } from "../../lib/chunk.js";
import { ApiError } from "../../lib/http.js";
import type { PackRecord } from "../../lib/object-pack.js";
import {
  isObjectHash,
  objectKey,
  removeStoredFile,
  storeObjects,
} from "../../lib/storage.js";
import { db, type Tx } from "../index.js";
import { objects, repoObjects } from "../schema/objects.js";
import { members } from "../schema/projects.js";
import { repos } from "../schema/repos.js";
import {
  addUsage,
  assertStorageAllows,
  newRepoObjectScopes,
  projectScope,
  remainingAllowance,
  type UsageScope,
  userScope,
} from "./storage-usage.js";

/** An object id on the wire: 64 lowercase hex characters. */
export const objectHashSchema = z
  .string()
  .refine(isObjectHash, "Not an object hash");

/** The objects dit asks a repo about before it uploads a push. */
export const missingObjectsBodySchema = z.object({
  hashes: z.array(objectHashSchema).min(1).max(10_000),
});

/** The objects a caller asks a repo to send back. */
export const fetchObjectsBodySchema = z.object({
  hashes: z.array(objectHashSchema).min(1).max(10_000),
});

/**
 * What the repo lacks (`missing`: upload these) and what the hub linked into
 * it on the caller's say-so (`claimed`: held by a repo of a project the caller
 * is a member of, so no upload is needed).
 */
export const missingObjectsSchema = z.object({
  missing: z.array(z.string()),
  claimed: z.array(z.string()),
});

/**
 * What a pack upload did: `stored` objects the hub had never held and now
 * does, `known` objects whose bytes it already had.
 */
export const objectsUploadedSchema = z.object({
  stored: z.number().int().nonnegative(),
  known: z.number().int().nonnegative(),
});

type ObjectsUploaded = z.infer<typeof objectsUploadedSchema>;

/** A repo gaining an object, and the account that pushed it. */
type ObjectLink = { repoId: number; pushedBy: string };

/**
 * Namespaces the advisory locks {@link lockObjects} takes (the two-key overload
 * of `pg_advisory_xact_lock`), so an object's key can never collide with one
 * some other subsystem locks on: "OB" in hex.
 */
const OBJECT_LOCK_CLASS = 0x4f42;

/**
 * The most object locks one transaction takes. Every lock holds a slot in the
 * server's shared lock table, which by default has room for 64 per connection
 * across all of them, so a push or a removal over a thousand objects takes
 * their locks a group at a time rather than all at once.
 */
export const OBJECT_LOCKS_PER_TRANSACTION = 100;

/** An object's lock key: the hash's first 32 bits, as the signed int Postgres takes. */
const objectLockKey = (hash: string): number =>
  Number.parseInt(hash.slice(0, 8), 16) | 0;

/**
 * Takes the locks that keep objects' `objects` rows and their files together,
 * released when `tx` ends. A push holds one per object from reading the rows
 * until the rows it writes commit, and a removal of files holds one per file
 * while it checks that no row names the file, so neither sees the other half
 * done. Keyed by the hash's first 32 bits: two objects that share them only
 * queue behind each other.
 *
 * Keys are sorted ascending and locked in bounded batches so callers never
 * deadlock and never exceed Postgres's bind-parameter ceiling.
 */
export async function lockObjects(tx: Tx, hashes: string[]): Promise<void> {
  const keys = [...new Set(hashes.map(objectLockKey))].sort((a, b) => a - b);
  if (keys.length === 0) return;
  const maxKeys = Math.max(
    1,
    Math.min(OBJECT_LOCKS_PER_TRANSACTION, bindParamLimit() - 1)
  );
  // `unnest` yields each batch's elements in ascending order, and each row's
  // lock is taken as the scan reaches it.
  for (const batch of chunk(keys, maxKeys)) {
    await tx.execute(sql`
      select pg_advisory_xact_lock(${OBJECT_LOCK_CLASS}, key)
        from unnest(array[${sql.join(
          batch.map((key) => sql`${key}`),
          sql`, `
        )}]::int[]) as key
    `);
  }
}

/**
 * Answers a push's question for the repo: of `hashes`, which must be uploaded
 * (`missing`, in the order asked and without repeats) and which the hub linked
 * into the repo without an upload (`claimed`). An object the repo holds is in
 * neither. An object another repo holds is claimed when that repo's project is
 * one `userId` is a member of — the caller could already read those bytes — and
 * is missing otherwise: a project's objects are never revealed to, or linked
 * for, someone outside it.
 */
export async function missingObjects(
  repoId: number,
  hashes: string[],
  userId: string
): Promise<{ missing: string[]; claimed: string[] }> {
  const asked = [...new Set(hashes)];
  const held = new Set<string>();
  for (const batch of chunk(asked, Math.max(1, bindParamLimit() - 1))) {
    const rows = await db
      .select({ hash: repoObjects.objectHash })
      .from(repoObjects)
      .where(
        and(
          eq(repoObjects.repoId, repoId),
          inArray(repoObjects.objectHash, batch)
        )
      );
    for (const row of rows) held.add(row.hash);
  }
  const lacking = asked.filter((hash) => !held.has(hash));

  const claimed = new Set<string>();
  for (let at = 0; at < lacking.length; at += OBJECT_LOCKS_PER_TRANSACTION) {
    const run = lacking.slice(at, at + OBJECT_LOCKS_PER_TRANSACTION);
    for (const hash of await claimGroup({ repoId, pushedBy: userId }, run)) {
      claimed.add(hash);
    }
  }
  return {
    missing: lacking.filter((hash) => !claimed.has(hash)),
    claimed: lacking.filter((hash) => claimed.has(hash)),
  };
}

/** The objects a folder would push, each with the size of the frame it would upload. */
export const storageCheckBodySchema = z.object({
  objects: z
    .array(
      z.object({
        hash: objectHashSchema,
        size: z.number().int().nonnegative(),
      })
    )
    .max(10_000),
});

/**
 * What `objects` would add: `bytes` of those no repo of the caller's projects
 * holds, how many `held` ones add nothing, and the room `remainingBytes` the
 * project and the caller have left, null where neither has a cap.
 */
export const storageCheckSchema = z.object({
  bytes: z.number().int().nonnegative(),
  held: z.number().int().nonnegative(),
  remainingBytes: z.number().int().nonnegative().nullable(),
});

/**
 * Totals the upload a folder would take in `projectId`. An object another
 * project holds is counted whole, as the caller cannot know it exists, which
 * can only overstate: the charge rule frees an object any repo holds. Nothing
 * is linked or written.
 */
export async function checkStorage(
  projectId: number,
  userId: string,
  wanted: z.infer<typeof storageCheckBodySchema>["objects"]
): Promise<z.infer<typeof storageCheckSchema>> {
  const sizes = new Map<string, number>();
  for (const { hash, size } of wanted) {
    if (!sizes.has(hash)) sizes.set(hash, size);
  }

  const held = new Set<string>();
  for (const batch of chunk(
    [...sizes.keys()],
    Math.max(1, bindParamLimit() - 1)
  )) {
    for (const hash of await heldByMembersOf(db, userId, batch)) held.add(hash);
  }

  let bytes = 0;
  for (const [hash, size] of sizes) {
    if (!held.has(hash)) bytes += size;
  }
  return {
    bytes,
    held: held.size,
    remainingBytes: await remainingAllowance([
      projectScope(projectId),
      userScope(userId),
    ]),
  };
}

/** A scope's key in a {@link GroupUsage}. */
const scopeKey = (scope: UsageScope): string => `${scope.kind}:${scope.id}`;

/**
 * The bytes a group of records links into a repo, by scope. No counter shows
 * them until the group counts them just before it commits, so every cap check
 * in the group adds them to what the counter says.
 */
class GroupUsage {
  readonly #bytes = new Map<string, { scope: UsageScope; bytes: number }>();

  /** What the group has linked into `scope` so far. */
  readonly pending = (scope: UsageScope): number =>
    this.#bytes.get(scopeKey(scope))?.bytes ?? 0;

  add(scopes: UsageScope[], bytes: number): void {
    for (const scope of scopes) {
      this.#bytes.set(scopeKey(scope), {
        scope,
        bytes: this.pending(scope) + bytes,
      });
    }
  }

  /**
   * The group's bytes by scope, projects before users: the order one
   * `addUsage` over a project and a user takes their counter rows in, so a
   * group counting its bytes and a single upload counting its own never each
   * hold the row the other waits on.
   */
  byScope(): { scope: UsageScope; bytes: number }[] {
    return [...this.#bytes.values()].sort((a, b) =>
      a.scope.kind.localeCompare(b.scope.kind)
    );
  }
}

/**
 * The scopes that linking `hash` into the repo adds `size` bytes to, once
 * their caps allow it with what the group has already linked. Read in the
 * transaction that writes the link, before it does.
 */
async function scopesAllowing(
  tx: Tx,
  link: ObjectLink,
  usage: GroupUsage,
  hash: string,
  size: number
): Promise<UsageScope[]> {
  const scopes = await newRepoObjectScopes(
    tx,
    link.repoId,
    hash,
    link.pushedBy
  );
  await assertStorageAllows(scopes, size, usage.pending);
  return scopes;
}

/**
 * The `repo_objects` row. A push racing this one may have linked the object
 * first; answers whether this call did.
 */
async function insertRepoObject(
  tx: Tx,
  link: ObjectLink,
  hash: string
): Promise<boolean> {
  const inserted = await tx
    .insert(repoObjects)
    .values({ repoId: link.repoId, objectHash: hash, pushedBy: link.pushedBy })
    .onConflictDoNothing()
    .returning({ hash: repoObjects.objectHash });
  return inserted.length > 0;
}

/**
 * Links an object the hub already stores for another repo into this one. No
 * file is written; the object's bytes count towards the repo's project and the
 * pusher where they do not already hold it.
 */
async function linkObject(
  tx: Tx,
  link: ObjectLink,
  usage: GroupUsage,
  hash: string,
  size: number
): Promise<void> {
  const scopes = await scopesAllowing(tx, link, usage, hash, size);
  if (await insertRepoObject(tx, link, hash)) usage.add(scopes, size);
}

/**
 * Records an object the hub has never held, checked against the caps before
 * anything is written: its `objects` row and its link into the repo. Answers
 * whether this call created the `objects` row, which is when the caller must
 * store the frame before the transaction commits. The caller holds the
 * object's lock, so no other push creates the row first; a row that lands
 * beside it anyway keeps its own size and its own file, and that size is what
 * the link counts.
 */
async function recordObject(
  tx: Tx,
  link: ObjectLink,
  usage: GroupUsage,
  record: PackRecord
): Promise<boolean> {
  const scopes = await scopesAllowing(
    tx,
    link,
    usage,
    record.hash,
    record.frame.length
  );

  const [created] = await tx
    .insert(objects)
    .values({ hash: record.hash, kind: record.kind, size: record.frame.length })
    .onConflictDoNothing()
    .returning({ size: objects.size });
  const size = created?.size ?? (await objectSize(tx, record.hash));
  if (await insertRepoObject(tx, link, record.hash)) usage.add(scopes, size);
  return created !== undefined;
}

/** The size an object's committed row records. */
async function objectSize(tx: Tx, hash: string): Promise<number> {
  const [row] = await tx
    .select({ size: objects.size })
    .from(objects)
    .where(eq(objects.hash, hash));
  if (!row) throw new Error(`object ${hash} has no row`);
  return row.size;
}

/**
 * The `objects` rows of `hashes`, each with whether the repo holds it, read
 * `for key share` so the reap cannot delete one between this read and the
 * link that names it. A reap that deleted one first leaves no row to read.
 *
 * The rows are locked in hash order, the order the reap locks them in. A plan
 * that reads the heap, as a group of more than a dozen keys gets on a large
 * table, would otherwise lock them in heap order, and a push holding a higher
 * row while it waits on a lower one the reap holds deadlocks with it.
 */
const groupRows = (tx: Tx, repoId: number, hashes: string[]) =>
  tx
    .select({
      hash: objects.hash,
      size: objects.size,
      inRepo: sql<boolean>`exists (
          select 1 from ${repoObjects}
           where ${repoObjects.repoId} = ${repoId}
             and ${repoObjects.objectHash} = ${objects.hash})`,
    })
    .from(objects)
    .where(inArray(objects.hash, hashes))
    .orderBy(objects.hash)
    .for("key share");

/** The statements a push runs, for a test to read their plans. */
export const acceptStatements = { groupRows };

/** What a group took: its counts, and the cap refusal that ended it early. */
type GroupTaken = { counts: ObjectsUploaded; refusal: ApiError | null };

/**
 * Takes a group of verified records into a repo in one transaction, under all
 * of their objects' locks. A record the repo already holds, or one repeated
 * earlier in the group, changes nothing; an object the hub holds for another
 * repo is linked without a file; anything else is recorded, and its frame
 * stored. Every frame the group stores is on disk for good before the
 * transaction that inserts its row commits, and the group's bytes are counted
 * just before it does.
 *
 * A record a storage cap refuses ends the group: the records before it are
 * taken and the refusal is answered for the caller to throw, and nothing of
 * the refused record or those after it is written.
 *
 * The rows are read through {@link groupRows}; an object a reap deleted first
 * is stored again.
 */
async function acceptGroup(
  link: ObjectLink,
  records: PackRecord[]
): Promise<GroupTaken> {
  return db.transaction(async (tx) => {
    const hashes = records.map((record) => record.hash);
    await lockObjects(tx, hashes);
    const rows = await groupRows(tx, link.repoId, hashes);
    const existing = new Map(rows.map((row) => [row.hash, row]));

    const usage = new GroupUsage();
    const counts = { stored: 0, known: 0 };
    const recorded: PackRecord[] = [];
    const seen = new Set<string>();
    let refusal: ApiError | null = null;
    for (const record of records) {
      const row = existing.get(record.hash);
      try {
        if (seen.has(record.hash) || row?.inRepo) {
          counts.known += 1;
        } else if (row) {
          await linkObject(tx, link, usage, record.hash, row.size);
          counts.known += 1;
        } else if (await recordObject(tx, link, usage, record)) {
          recorded.push(record);
          counts.stored += 1;
        } else {
          counts.known += 1;
        }
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        refusal = error;
        break;
      }
      seen.add(record.hash);
    }

    await storeObjects(
      recorded.map(({ hash, frame }) => ({ hash, bytes: frame }))
    );
    for (const { scope, bytes } of usage.byScope()) {
      await addUsage(tx, [scope], bytes);
    }
    return { counts, refusal };
  });
}

/**
 * Which of `hashes` a repo of a project `userId` is a member of holds. A link
 * reads it in the transaction that makes it, under the objects' locks.
 */
async function heldByMembersOf(
  tx: Pick<typeof db, "selectDistinct">,
  userId: string,
  hashes: string[]
): Promise<Set<string>> {
  const rows = await tx
    .selectDistinct({ hash: repoObjects.objectHash })
    .from(repoObjects)
    .innerJoin(repos, eq(repos.id, repoObjects.repoId))
    .innerJoin(members, eq(members.projectId, repos.projectId))
    .where(
      and(eq(members.userId, userId), inArray(repoObjects.objectHash, hashes))
    );
  return new Set(rows.map((row) => row.hash));
}

/**
 * Links into the repo the objects of `hashes` that a repo of one of the
 * caller's projects holds, in one transaction under their locks and answers
 * the ones it linked. No file is written and nothing is charged: a row exists
 * for each, so the first pusher already pays. Whether a holder exists is read
 * after the locks and the `for key share` read of the `objects` rows, so a
 * holder unlinked, or an object reaped, before this transaction leaves the hash
 * unclaimed and missing.
 */
async function claimGroup(
  link: ObjectLink,
  hashes: string[]
): Promise<string[]> {
  return db.transaction(async (tx) => {
    await lockObjects(tx, hashes);
    const rows = await groupRows(tx, link.repoId, hashes);
    const candidates = rows.filter((row) => !row.inRepo);
    if (candidates.length === 0) return [];

    const claimable = await heldByMembersOf(
      tx,
      link.pushedBy,
      candidates.map((row) => row.hash)
    );
    const claimed: string[] = [];
    for (const row of candidates) {
      if (!claimable.has(row.hash)) continue;
      await insertRepoObject(tx, link, row.hash);
      claimed.push(row.hash);
    }
    return claimed;
  });
}

/**
 * Links a commit's lineage objects into the repo, in the transaction that
 * writes the commit. A hash the repo holds is left as it is; one a repo of a
 * project the caller is a member of holds is linked as a claim links it, with
 * no file written and nothing charged. Any other is refused with a 400 naming
 * it, since the repo could not serve it back.
 *
 * Takes no lock of its own: the caller has already called {@link lockObjects}
 * on every hash it will link in `tx`, in one call, so that a transaction
 * linking several commits' lineage still takes all its locks together.
 */
export async function linkLineageObjects(
  tx: Tx,
  link: ObjectLink,
  hashes: string[]
): Promise<void> {
  const asked = [...new Set(hashes)];
  if (asked.length === 0) return;

  const rows = await groupRows(tx, link.repoId, asked);
  const inRepo = new Set(
    rows.filter((row) => row.inRepo).map((row) => row.hash)
  );
  const candidates = rows.filter((row) => !row.inRepo).map((row) => row.hash);
  const claimable =
    candidates.length === 0
      ? new Set<string>()
      : await heldByMembersOf(tx, link.pushedBy, candidates);
  const refused = asked.filter(
    (hash) => !inRepo.has(hash) && !claimable.has(hash)
  );
  if (refused.length > 0) {
    throw new ApiError(400, {
      code: "lineage_not_held",
      message: `Lineage objects this repo cannot serve: ${refused.join(", ")}`,
      details: { hashes: refused },
    });
  }
  for (const hash of candidates) {
    if (claimable.has(hash)) await insertRepoObject(tx, link, hash);
  }
}

/**
 * The hashes of `hashes` the repo holds, each with its object's kind, read in
 * batches under the bind-parameter limit.
 */
export async function heldObjects(
  repoId: number,
  hashes: string[]
): Promise<Map<string, number>> {
  const held = new Map<string, number>();
  for (const batch of chunk(hashes, bindParamLimit() - 1)) {
    const rows = await db
      .select({ hash: objects.hash, kind: objects.kind })
      .from(repoObjects)
      .innerJoin(objects, eq(objects.hash, repoObjects.objectHash))
      .where(and(eq(repoObjects.repoId, repoId), inArray(objects.hash, batch)));
    for (const row of rows) held.set(row.hash, row.kind);
  }
  return held;
}

/**
 * `items` in runs of `size`, the last one shorter. When `items` fails, the
 * run read before the failure is yielded first, then the failure is thrown.
 */
async function* runsOf<T>(
  items: AsyncIterable<T> | Iterable<T>,
  size: number
): AsyncGenerator<T[]> {
  let run: T[] = [];
  try {
    for await (const item of items) {
      run.push(item);
      if (run.length === size) {
        yield run;
        run = [];
      }
    }
  } catch (error) {
    if (run.length > 0) yield run;
    throw error;
  }
  if (run.length > 0) yield run;
}

/**
 * Takes a pack's verified records into a repo,
 * {@link OBJECT_LOCKS_PER_TRANSACTION} to a transaction, so a push of
 * thousands of objects costs tens of transactions and flushes its new files a
 * group at a time rather than one by one. Answers how many objects this call
 * created and how many the hub already had the bytes of.
 *
 * A pack that fails part way keeps the records before the failure: a failure
 * of `records` itself (a record that does not verify, a body cut short) comes
 * after the group read before it is taken, and a storage cap's refusal comes
 * after the records of its group before the refused one are.
 */
export async function acceptObjects(
  repoId: number,
  pushedBy: string,
  records: AsyncIterable<PackRecord> | Iterable<PackRecord>
): Promise<ObjectsUploaded> {
  const link = { repoId, pushedBy };
  const total = { stored: 0, known: 0 };
  for await (const group of runsOf(records, OBJECT_LOCKS_PER_TRANSACTION)) {
    const { counts, refusal } = await acceptGroup(link, group);
    if (refusal) throw refusal;
    total.stored += counts.stored;
    total.known += counts.known;
  }
  return total;
}

/**
 * Removes each object's file unless an `objects` row names it, checked under
 * the object's lock so no push can be between storing the file and committing
 * its row. Answers the hashes no row names whose file is gone, one that never
 * had a file included and one whose unlink failed left out, in the order
 * given. The
 * objects are locked, checked and removed {@link OBJECT_LOCKS_PER_TRANSACTION}
 * to a transaction, so the reap of a deleted project's thousands of objects
 * costs tens of round trips rather than thousands. The reap and the storage
 * audit both remove object files only through this.
 */
export async function removeUnnamedObjectFiles(
  hashes: string[]
): Promise<string[]> {
  const removed: string[] = [];
  for (
    let start = 0;
    start < hashes.length;
    start += OBJECT_LOCKS_PER_TRANSACTION
  ) {
    const group = hashes.slice(start, start + OBJECT_LOCKS_PER_TRANSACTION);
    const unnamed = await db.transaction(async (tx) => {
      await lockObjects(tx, group);
      const named = await tx
        .select({ hash: objects.hash })
        .from(objects)
        .where(inArray(objects.hash, group));
      const kept = new Set(named.map((row) => row.hash));
      const gone = group.filter((hash) => !kept.has(hash));
      const results = await Promise.all(
        gone.map((hash) => removeStoredFile(objectKey(hash)))
      );
      return gone.filter((_, index) => results[index]);
    });
    removed.push(...unnamed);
  }
  return removed;
}
