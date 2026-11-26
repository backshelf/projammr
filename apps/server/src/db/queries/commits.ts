import {
  and,
  asc,
  count,
  countDistinct,
  desc,
  eq,
  exists,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  min,
  notExists,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { createSelectSchema } from "drizzle-orm/zod";
import { alias, type PgColumn } from "drizzle-orm/pg-core";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { instancePolicy } from "../../lib/instance-policy.js";
import { bindParamLimit, chunk } from "../../lib/chunk.js";
import { attributedTo, type PushMachine } from "../../lib/push-machine.js";
import { withChunks } from "../../lib/sample-objects.js";
import { db, type Tx } from "../index.js";
import { rawCommitKindEnum } from "../schema/enums.js";
import { branches, commits, repos } from "../schema/repos.js";
import {
  objects,
  repoObjects,
  saveObjects,
  saveSampleObjects,
} from "../schema/objects.js";
import { type SampleRef, sampleRefSchema } from "../schema/samples.js";
import {
  newSessionRevisionSchema,
  saveSchema,
} from "../schema/save-schemas.js";
import { type Save, saves } from "../schema/saves.js";
import { users } from "../schema/auth.js";
import { type NewSession, epochDate, sessions } from "../schema/sessions.js";
import { isUniqueViolation } from "../unique-violation.js";
import type { ProjectResolution } from "./authorization.js";
import { branchIdOf, branchNameSchema } from "./branches.js";
import { machines, pushedMachineNameSchema } from "../schema/machines.js";
import { withCurrentMachineNames } from "./machines.js";
import {
  linkLineageObjects,
  lockObjects,
  objectHashSchema as hashSchema,
} from "./objects.js";
import { saveMetaFields } from "./saves.js";
import { sessionTimeInSet, timeInSetCoveredBy } from "./segments.js";
import { replaceSessionSamples } from "./session-samples.js";

const ditSetIdSchema = z.string().trim().min(1);

/**
 * One save as dit reports it between commits: the ids of what it rebuilds from
 * and the metadata the hub shows, never its content.
 */
const pushedSaveSchema = z.object({
  hash: hashSchema,
  xmlHash: hashSchema.nullable(),
  tree: hashSchema.nullable(),
  side: hashSchema.nullable(),
  /** The leaf holding the bytes of a save dit could not read; absent otherwise. */
  raw: hashSchema.optional(),
  fileUpdatedAt: epochDate,
  machineName: pushedMachineNameSchema,
  meta: newSessionRevisionSchema.shape.meta,
  viewOnly: z.boolean(),
  unreadable: z.boolean(),
  /** What the save references; a dit that does not report samples omits it. */
  samples: z.array(sampleRefSchema).optional(),
});

export const pushSavesBodySchema = z.object({
  ditSetId: ditSetIdSchema,
  branch: branchNameSchema,
  saves: z.array(pushedSaveSchema).min(1),
});

/** A save a commit covers, with the objects that save rebuilds from. */
const commitSaveSchema = z.object({
  hash: hashSchema,
  objects: z.array(hashSchema),
});

const pushedCommitSchema = z
  .object({
    hash: hashSchema,
    saveHash: hashSchema,
    parentHash: hashSchema.nullable(),
    message: z.string(),
    kind: z.enum(rawCommitKindEnum),
    committedAt: epochDate,
    machineName: pushedMachineNameSchema,
    saves: z.array(commitSaveSchema).min(1),
    /** The leaf ids of the commit's own save's samples, which the hub links for those it holds. */
    sampleObjects: z.array(hashSchema).optional(),
    /**
     * The commit's lineage: its own save and the commit object, which the hub
     * links into the repo so a restore can fetch them back. At most two, the
     * locks one transaction takes.
     */
    lineageObjects: z.array(hashSchema).max(2).optional(),
  })
  .refine((commit) => commit.saves.some((s) => s.hash === commit.saveHash), {
    message: "saveHash is not one of the commit's saves",
    path: ["saveHash"],
  });

export const pushCommitsBodySchema = z.object({
  ditSetId: ditSetIdSchema,
  branch: branchNameSchema,
  commits: z.array(pushedCommitSchema).min(1),
});

export const savesPushedSchema = z.object({ saved: z.number().int() });

export const commitsPushedSchema = z.object({ inserted: z.number().int() });

type PushedSave = z.infer<typeof pushedSaveSchema>;
type PushedCommit = z.infer<typeof pushedCommitSchema>;

/**
 * A commit as a session's history shows it. Its `saves` are the ones the
 * commit covers: those on its branch after the parent commit's save, up to and
 * including its own.
 */
export const sessionCommitSchema = createSelectSchema(commits)
  .pick({
    id: true,
    hash: true,
    message: true,
    kind: true,
    committedAt: true,
    machineName: true,
    machineId: true,
    authorId: true,
  })
  .extend({
    branch: z.string(),
    parentHash: z.string().nullable(),
    saveHash: z.string().nullable(),
    /** The committer's account name; null once the account is gone or for a commit with no author. */
    authorName: z.string().nullable(),
    /** Every sample the commit's own save references, held or not, whatever its kind: what the set needs. */
    samplesReferenced: z.number().int(),
    /** Of those, how many the hub holds the bytes of. */
    samplesHeld: z.number().int(),
    /** The seconds the set was open across the window the commit covers; null when no segment falls in it. */
    timeInSet: z.number().int().nullable(),
    saves: z.array(saveSchema),
  });

export const sessionBranchSchema = z.object({
  name: z.string(),
  headCommitHash: z.string().nullable(),
});

/**
 * What a session's whole history holds, counted over every row rather than the
 * page of commits a reader loaded.
 */
export const sessionHistorySchema = z.object({
  commits: z.number().int(),
  saves: z.number().int(),
  /** The distinct machines that saved the session. */
  machines: z.number().int(),
  /** The oldest save's file time; null before any save. */
  firstSeenAt: z.date().nullable(),
  /** The seconds the set was open: every segment's time, counted once. */
  timeInSet: z.number().int(),
  /** How long the hub keeps the content of a save no commit names: the instance's setting, which every member may know. */
  contentRetentionDays: z.number().int(),
});

export type SessionHistory = z.infer<typeof sessionHistorySchema>;

type SessionCommit = z.infer<typeof sessionCommitSchema>;
type SessionBranch = z.infer<typeof sessionBranchSchema>;

/**
 * How many values a statement can bind in one `inArray`, beside the
 * `fixedBinds` it binds otherwise: a request body can pass Postgres's limit.
 */
const valuesPerStatement = (fixedBinds: number) =>
  Math.max(1, bindParamLimit() - fixedBinds);

/** Rows per `save_objects` insert, which binds two parameters a row. */
const linkRowsPerStatement = () =>
  Math.max(1, Math.floor(bindParamLimit() / 2));

/** Runs `query` over `values` in groups of `valuesPerStatement(fixedBinds)` and joins what it returns. */
async function inChunks<V, R>(
  values: readonly V[],
  fixedBinds: number,
  query: (batch: V[]) => PromiseLike<R[]>
): Promise<R[]> {
  const rows: R[] = [];
  for (const batch of chunk(values, valuesPerStatement(fixedBinds))) {
    rows.push(...(await query(batch)));
  }
  return rows;
}

const notRecorded = () =>
  new HTTPException(409, {
    message: "A save of this set was recorded concurrently",
  });

/**
 * An upsert's value for a content column: the row's own once its content is
 * stored, since the objects it was stored with rebuild exactly those columns.
 */
const keepWhenStored = (column: PgColumn) =>
  sql`case when ${saves.contentState} = 'stored' then ${column} else excluded.${sql.raw(column.name)} end`;

/**
 * A save's `meta` with the references dit reported for it, deduplicated by
 * path (the last wins). Without a `meta` there is no place to keep them, and a
 * save that reported none leaves the references already stored alone.
 */
function withSamples<M extends { samplePaths: string[] | null }>(
  meta: M | null | undefined,
  samples: SampleRef[] | undefined
): M | null {
  if (!meta) return null;
  if (samples === undefined) return meta;
  return {
    ...meta,
    samples: [...new Map(samples.map((ref) => [ref.path, ref])).values()],
  };
}

/**
 * Writes one pushed save. A row the scanner recorded at the same file time
 * with no content is claimed: it takes the save's content columns and keeps its
 * id and source. Any other save is upserted by `(sessionId, hash)`, so a repeat
 * refreshes the metadata dit may have re-read, and never `contentState`; the
 * content columns of a row already stored stay as they are. On both paths a row
 * the scanner recorded keeps its `machineName`, and its `meta` unless that is
 * null; a row dit recorded takes dit's latest.
 */
async function recordSave(
  tx: Tx,
  context: {
    sessionId: number;
    projectId: number;
    branchId: number;
    machine: PushMachine;
  },
  save: PushedSave,
  atTime: Save | undefined
) {
  const { sessionId, projectId, branchId, machine } = context;
  const machineId = attributedTo(machine, save.machineName);
  const meta = withSamples(save.meta, save.samples);
  const content = {
    xmlHash: save.xmlHash,
    tree: save.tree,
    side: save.side,
    raw: save.raw ?? null,
    viewOnly: save.viewOnly,
    unreadable: save.unreadable,
    branchId,
  };

  if (atTime && atTime.hash != null && atTime.hash !== save.hash) {
    throw new HTTPException(409, {
      message: `Save ${atTime.hash} is already recorded at ${save.fileUpdatedAt.toISOString()}`,
    });
  }

  if (atTime && atTime.hash == null) {
    await tx
      .update(saves)
      .set({
        ...content,
        hash: save.hash,
        machineName: atTime.machineName ?? save.machineName,
        // The row keeps the name the scanner gave it, and so the attribution
        // that name earns: none, unless it had no name and takes dit's.
        machineId: atTime.machineName === null ? machineId : atTime.machineId,
        meta: atTime.meta ? withSamples(atTime.meta, save.samples) : meta,
      })
      .where(eq(saves.id, atTime.id));
    return;
  }

  const metadata = {
    ...content,
    machineName: save.machineName,
    machineId,
    meta,
  };
  await tx
    .insert(saves)
    .values({
      ...metadata,
      sessionId,
      projectId,
      fileUpdatedAt: save.fileUpdatedAt,
      source: "dit",
      hash: save.hash,
    })
    .onConflictDoUpdate({
      target: [saves.sessionId, saves.hash],
      targetWhere: sql`${saves.hash} is not null`,
      set: {
        ...metadata,
        xmlHash: keepWhenStored(saves.xmlHash),
        tree: keepWhenStored(saves.tree),
        side: keepWhenStored(saves.side),
        raw: keepWhenStored(saves.raw),
        viewOnly: keepWhenStored(saves.viewOnly),
        unreadable: keepWhenStored(saves.unreadable),
        machineName: sql`case when ${saves.source} = 'dit' then excluded.machine_name else ${saves.machineName} end`,
        machineId: sql`case when ${saves.source} = 'dit' then excluded.machine_id else ${saves.machineId} end`,
        // A row the scanner recorded keeps its meta but takes the references,
        // which only dit reports.
        meta: sql`case when ${saves.source} = 'dit' then excluded.meta when excluded.meta ? 'samples' then coalesce(${saves.meta}, excluded.meta) || jsonb_build_object('samples', excluded.meta->'samples') else coalesce(${saves.meta}, excluded.meta) end`,
      },
    });
}

/** Stamps the repo with the push that just changed it. */
async function recordPush(tx: Tx, repoId: number, machineId: string | null) {
  await tx
    .update(repos)
    .set({ lastPushAt: new Date(), lastPushMachineId: machineId })
    .where(eq(repos.id, repoId));
}

/**
 * Records the saves dit made between commits on a branch of the session, which
 * the first mention of a name creates. The session's current branch becomes
 * that of its newest save, whichever push recorded it, and its DAW facts those
 * of that save when this push recorded it. The scanner's backup-stamped saves
 * that a copy in this push stands for are superseded.
 */
export async function recordSaves(input: {
  repoId: number;
  sessionId: number;
  machine: PushMachine;
  branch: string;
  saves: PushedSave[];
}): Promise<number> {
  const { repoId, sessionId, machine, branch, saves: pushed } = input;

  try {
    return await db.transaction(async (tx) => {
      const [session] = await tx
        .select({ projectId: sessions.projectId })
        .from(sessions)
        .where(eq(sessions.id, sessionId));
      const branchId = await branchIdOf(tx, sessionId, branch);

      const existing = await inChunks(
        pushed.map((save) => save.fileUpdatedAt),
        1,
        (times) =>
          tx
            .select()
            .from(saves)
            .where(
              and(
                eq(saves.sessionId, sessionId),
                inArray(saves.fileUpdatedAt, times)
              )
            )
      );
      const atTime = new Map(
        existing.map((row) => [row.fileUpdatedAt.getTime(), row])
      );

      const context = {
        sessionId,
        projectId: session!.projectId,
        branchId,
        machine,
      };
      for (const save of pushed) {
        await recordSave(
          tx,
          context,
          save,
          atTime.get(save.fileUpdatedAt.getTime())
        );
      }

      await supersedeBackups(
        tx,
        sessionId,
        pushed
          .filter((save) => {
            const stored = atTime.get(save.fileUpdatedAt.getTime());
            return !stored || stored.hash === null;
          })
          .map((save) => save.fileUpdatedAt)
      );

      const newestBranch = tx
        .select({ branchId: saves.branchId })
        .from(saves)
        .where(
          and(
            eq(saves.sessionId, sessionId),
            sql`${saves.branchId} is not null`
          )
        )
        .orderBy(desc(saves.fileUpdatedAt), desc(saves.machineName))
        .limit(1);
      await tx
        .update(sessions)
        .set({
          currentBranchId: sql`(${newestBranch})`,
          ...(await newestFacts(tx, sessionId, pushed)),
        })
        .where(eq(sessions.id, sessionId));

      await mirrorSamples(tx, sessionId, session!.projectId, pushed);

      await recordPush(
        tx,
        repoId,
        attributedTo(machine, pushed.at(-1)!.machineName)
      );
      return pushed.length;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw notRecorded();
    throw error;
  }
}

/**
 * Deletes the content-less saves the scanner stamped at a `Backup/` copy's
 * name time that a copy dit just recorded stands for. Live names a copy by the
 * moment it replaced the file, never by the copy's own file time, so no
 * millisecond meets and the scanner's row would sit beside the copy's save and
 * count twice. Such a row goes when the row just before it in the session is
 * a save that just landed with content: nothing lies between the two, so the
 * copy has nowhere else to be. A row with another row between (a copy deleted
 * from disk, or a save dit has yet to record) stays, and so does one whose
 * predecessor landed in an earlier push, so a repeat push removes nothing more.
 */
async function supersedeBackups(tx: Tx, sessionId: number, landed: Date[]) {
  const stamped = alias(saves, "stamped");
  const copy = alias(saves, "copy");
  const between = alias(saves, "between");

  const rows = await inChunks(landed, 2, (times) =>
    tx
      .select({ id: stamped.id })
      .from(stamped)
      .where(
        and(
          eq(stamped.sessionId, sessionId),
          eq(stamped.source, "backup"),
          isNull(stamped.hash),
          exists(
            tx
              .select({ id: copy.id })
              .from(copy)
              .where(
                and(
                  eq(copy.sessionId, sessionId),
                  isNotNull(copy.hash),
                  inArray(copy.fileUpdatedAt, times),
                  lt(copy.fileUpdatedAt, stamped.fileUpdatedAt),
                  notExists(
                    tx
                      .select({ id: between.id })
                      .from(between)
                      .where(
                        and(
                          eq(between.sessionId, sessionId),
                          gt(between.fileUpdatedAt, copy.fileUpdatedAt),
                          lt(between.fileUpdatedAt, stamped.fileUpdatedAt)
                        )
                      )
                  )
                )
              )
          )
        )
      )
  );
  if (rows.length === 0) return;

  for (const ids of chunk(
    [...new Set(rows.map((row) => row.id))],
    valuesPerStatement(0)
  )) {
    await tx.delete(saves).where(inArray(saves.id, ids));
  }
}

/**
 * The columns that make a session's tempo, key, time signature, structure (and
 * so its plugins), counts and DAW version those of its newest save, when that
 * save is one just pushed: a push is the only thing that knows the file's
 * current state. A newest save with no meta, or not among those pushed,
 * changes nothing.
 */
async function newestFacts(
  tx: Tx,
  sessionId: number,
  pushed: PushedSave[]
): Promise<Partial<NewSession>> {
  const [newest] = await tx
    .select({ fileUpdatedAt: saves.fileUpdatedAt, meta: saves.meta })
    .from(saves)
    .where(eq(saves.sessionId, sessionId))
    .orderBy(desc(saves.fileUpdatedAt))
    .limit(1);
  if (
    !newest?.meta ||
    !pushed.some(
      (save) => save.fileUpdatedAt.getTime() === newest.fileUpdatedAt.getTime()
    )
  ) {
    return {};
  }
  const meta = newest.meta;
  return Object.fromEntries(
    saveMetaFields.map((field) => [field, meta[field] ?? null])
  );
}

/**
 * Makes the session's samples list those of the newest save when that save is
 * among the ones just pushed with references: the Samples section and the
 * project's sample pages read `session_samples`, and an older save pushed
 * later must not put its samples back. A reference with an object is
 * `present`; one dit could not read is `unknown`.
 */
async function mirrorSamples(
  tx: Tx,
  sessionId: number,
  projectId: number,
  pushed: PushedSave[]
): Promise<void> {
  let newest: PushedSave | undefined;
  for (const save of pushed) {
    if (
      save.samples !== undefined &&
      (!newest || save.fileUpdatedAt > newest.fileUpdatedAt)
    ) {
      newest = save;
    }
  }
  if (!newest) return;

  const [latest] = await tx
    .select({ fileUpdatedAt: saves.fileUpdatedAt })
    .from(saves)
    .where(eq(saves.sessionId, sessionId))
    .orderBy(desc(saves.fileUpdatedAt))
    .limit(1);
  if (latest?.fileUpdatedAt.getTime() !== newest.fileUpdatedAt.getTime()) {
    return;
  }

  await replaceSessionSamples(
    tx,
    sessionId,
    projectId,
    newest.samples!.map((ref) => ({
      path: ref.path,
      kind: ref.kind,
      status: ref.object === null ? "unknown" : "present",
    }))
  );
}

const listed = (hashes: string[]) => hashes.join(", ");

/**
 * Records commits on a branch of the session, in order, each one's parent the
 * one before; a branch's first commit may name a commit of the session on
 * another branch, the one it was checked out from, as its parent. A commit the
 * repo already has is a replay and changes nothing.
 * The rest must continue the branch head, name saves the session has recorded
 * and objects this repo holds; each save then takes the objects the commit
 * lists for it and its content is stored. Answers how many commits were
 * written.
 */
export async function recordCommits(input: {
  repoId: number;
  sessionId: number;
  userId: string;
  machine: PushMachine;
  branch: string;
  commits: PushedCommit[];
}): Promise<number> {
  const { repoId, sessionId, userId, machine, branch, commits: pushed } = input;

  const sampleIds = new Map(
    pushed.map((commit) => [commit.hash, commit.sampleObjects])
  );
  const link = { repoId, pushedBy: userId };
  const lineage = new Map(
    pushed.map((commit) => [commit.hash, commit.lineageObjects ?? []])
  );

  return db.transaction(async (tx) => {
    const branchId = await branchIdOf(tx, sessionId, branch);
    const [locked] = await tx
      .select({ headCommitId: branches.headCommitId })
      .from(branches)
      .where(eq(branches.id, branchId))
      .for("update");
    // Every lineage object of the push, replayed commits' and fresh ones, is
    // locked here in one statement; no lock is taken after it.
    await lockObjects(
      tx,
      pushed.flatMap((commit) => commit.lineageObjects ?? [])
    );

    let head: { id: number; hash: string } | null = null;
    if (locked?.headCommitId != null) {
      const [row] = await tx
        .select({ id: commits.id, hash: commits.hash })
        .from(commits)
        .where(eq(commits.id, locked.headCommitId));
      head = row ?? null;
    }

    // Read under the lock, so a push that just committed these commits shows.
    const known = await inChunks(
      pushed.map((commit) => commit.hash),
      1,
      (hashes) =>
        tx
          .select({ hash: commits.hash, saveId: commits.saveId })
          .from(commits)
          .where(and(eq(commits.repoId, repoId), inArray(commits.hash, hashes)))
    );
    const replayed = new Set(known.map((row) => row.hash));
    // A replay is how samples that landed after their commit are linked.
    for (const row of known) {
      await linkSampleObjects(tx, repoId, row.saveId, sampleIds.get(row.hash));
      await linkLineageObjects(tx, link, lineage.get(row.hash) ?? []);
    }
    const fresh = pushed.filter((commit) => !replayed.has(commit.hash));
    if (fresh.length === 0) return 0;

    // dit starts a checked-out branch on the commit it was checked out from,
    // so a branch with no commit yet continues from one of the session's
    // commits on another branch.
    const first = fresh[0]!;
    if (head === null && first.parentHash !== null) {
      head = await sessionCommit(tx, sessionId, first.parentHash);
    }

    for (const commit of fresh) {
      if ((head?.hash ?? null) !== commit.parentHash) {
        throw new HTTPException(409, { message: "not a fast-forward" });
      }

      const covered = await sessionSaves(tx, sessionId, commit);
      assertSavesRebuild(commit, covered);
      await assertObjectsInRepo(tx, repoId, commit);
      await linkLineageObjects(tx, link, commit.lineageObjects ?? []);

      const links = commit.saves.flatMap((save) =>
        [...new Set(save.objects)].map((objectHash) => ({
          saveId: covered.get(save.hash)!.id,
          objectHash,
        }))
      );
      for (const batch of chunk(links, linkRowsPerStatement())) {
        await tx.insert(saveObjects).values(batch).onConflictDoNothing();
      }
      for (const ids of chunk(
        [...covered.values()].map((row) => row.id),
        valuesPerStatement(1)
      )) {
        await tx
          .update(saves)
          .set({ contentState: "stored" })
          .where(inArray(saves.id, ids));
      }

      await linkSampleObjects(
        tx,
        repoId,
        covered.get(commit.saveHash)!.id,
        sampleIds.get(commit.hash)
      );

      const [row] = await tx
        .insert(commits)
        .values({
          repoId,
          sessionId,
          branchId,
          hash: commit.hash,
          saveId: covered.get(commit.saveHash)!.id,
          parentId: head?.id ?? null,
          message: commit.message,
          authorId: userId,
          machineName: commit.machineName,
          machineId: attributedTo(machine, commit.machineName),
          kind: commit.kind,
          committedAt: commit.committedAt,
        })
        .returning({ id: commits.id });
      head = { id: row!.id, hash: commit.hash };
    }

    await tx
      .update(branches)
      .set({ headCommitId: head!.id })
      .where(eq(branches.id, branchId));
    await recordPush(
      tx,
      repoId,
      attributedTo(machine, pushed.at(-1)!.machineName)
    );
    return fresh.length;
  });
}

/**
 * Links the commit's own save to those of `listed` the repo holds, and the
 * chunks of a Chunked one. Only objects the save's own references name are
 * linked, whatever the body lists: a wire list is not trusted to name another
 * project's objects. The commit is whole without them, so a sample not held yet
 * is left for a later push of the same commit.
 */
async function linkSampleObjects(
  tx: Tx,
  repoId: number,
  saveId: number,
  listed: string[] | undefined
): Promise<void> {
  if (!listed?.length) return;
  const [own] = await tx
    .select({ meta: saves.meta })
    .from(saves)
    .where(eq(saves.id, saveId));
  const referenced = new Set(
    (own?.meta?.samples ?? []).flatMap((ref) =>
      ref.object ? [ref.object] : []
    )
  );
  const named = listed.filter((hash) => referenced.has(hash));
  if (named.length === 0) return;
  const hashes = await withChunks(named);
  const held = await inChunks(hashes, 1, (batch) =>
    tx
      .select({ hash: repoObjects.objectHash })
      .from(repoObjects)
      .where(
        and(
          eq(repoObjects.repoId, repoId),
          inArray(repoObjects.objectHash, batch)
        )
      )
  );
  for (const batch of chunk(held, linkRowsPerStatement())) {
    await tx
      .insert(saveSampleObjects)
      .values(batch.map((row) => ({ saveId, objectHash: row.hash })))
      .onConflictDoNothing();
  }
}

/** The session's commit with this hash, on any of its branches. */
async function sessionCommit(
  tx: Tx,
  sessionId: number,
  hash: string
): Promise<{ id: number; hash: string } | null> {
  const [row] = await tx
    .select({ id: commits.id, hash: commits.hash })
    .from(commits)
    .where(and(eq(commits.sessionId, sessionId), eq(commits.hash, hash)));
  return row ?? null;
}

type CoveredSave = {
  id: number;
  tree: string | null;
  side: string | null;
  raw: string | null;
};

/** The session's saves by hash for every save the commit covers; a missing one is a 409. */
async function sessionSaves(
  tx: Tx,
  sessionId: number,
  commit: PushedCommit
): Promise<Map<string, CoveredSave>> {
  const hashes = commit.saves.map((save) => save.hash);
  const rows = await inChunks(hashes, 1, (batch) =>
    tx
      .select({
        id: saves.id,
        hash: saves.hash,
        tree: saves.tree,
        side: saves.side,
        raw: saves.raw,
      })
      .from(saves)
      .where(and(eq(saves.sessionId, sessionId), inArray(saves.hash, batch)))
  );
  const found = new Map(rows.map((row) => [row.hash!, row]));

  const missing = hashes.filter((hash) => !found.has(hash));
  if (missing.length > 0) {
    throw new HTTPException(409, {
      message: `Saves not recorded in this session: ${listed(missing)}`,
    });
  }
  return found;
}

/**
 * Checks every covered save lists the objects it rebuilds from: its tree and
 * side, or its raw leaf when dit could not read it. A save without them would
 * be marked `stored` and could not be materialised or downloaded.
 */
function assertSavesRebuild(
  commit: PushedCommit,
  covered: Map<string, CoveredSave>
): void {
  for (const save of commit.saves) {
    const { tree, side, raw } = covered.get(save.hash)!;
    const listedObjects = new Set(save.objects);
    if (raw !== null) {
      if (!listedObjects.has(raw)) {
        throw new HTTPException(409, {
          message: `Save ${save.hash} does not list its raw object`,
        });
      }
      continue;
    }
    if (
      tree === null ||
      side === null ||
      !listedObjects.has(tree) ||
      !listedObjects.has(side)
    ) {
      throw new HTTPException(409, {
        message: `Save ${save.hash} does not list its tree and side objects`,
      });
    }
  }
}

/** Checks every object the commit lists is held by the repo; the rest are a 409. */
async function assertObjectsInRepo(
  tx: Tx,
  repoId: number,
  commit: PushedCommit
): Promise<void> {
  const wanted = [...new Set(commit.saves.flatMap((save) => save.objects))];
  if (wanted.length === 0) return;

  const rows = await inChunks(wanted, 1, (batch) =>
    tx
      .select({ hash: repoObjects.objectHash })
      .from(repoObjects)
      .where(
        and(
          eq(repoObjects.repoId, repoId),
          inArray(repoObjects.objectHash, batch)
        )
      )
  );
  const held = new Set(rows.map((row) => row.hash));
  const missing = wanted.filter((hash) => !held.has(hash));
  if (missing.length > 0) {
    throw new HTTPException(409, {
      message: `Objects not held by this repo: ${listed(missing)}`,
    });
  }
}

/** The counts of the session's whole history. */
export async function getSessionHistory(
  sessionId: number
): Promise<SessionHistory> {
  const [[savesRow], [commitsRow], timeInSet] = await Promise.all([
    db
      .select({
        saves: count(),
        // A machine counts once however it was renamed or whether a save
        // names it by id: by its current name, else the name saved under.
        machines: countDistinct(
          sql`coalesce(${machines.name}, ${saves.machineName})`
        ),
        firstSeenAt: min(saves.fileUpdatedAt),
      })
      .from(saves)
      .leftJoin(machines, eq(machines.id, saves.machineId))
      .where(eq(saves.sessionId, sessionId)),
    db
      .select({ commits: count() })
      .from(commits)
      .where(eq(commits.sessionId, sessionId)),
    sessionTimeInSet(sessionId),
  ]);
  return {
    commits: commitsRow?.commits ?? 0,
    saves: savesRow?.saves ?? 0,
    machines: savesRow?.machines ?? 0,
    firstSeenAt: savesRow?.firstSeenAt ?? null,
    timeInSet,
    contentRetentionDays: instancePolicy().jobs.saveContentRetentionDays,
  };
}

/** The session's branches in the order they were made, each with its head commit's hash. */
export async function getSessionBranches(
  sessionId: number
): Promise<SessionBranch[]> {
  const rows = await db
    .select({ name: branches.name, headCommitHash: commits.hash })
    .from(branches)
    .leftJoin(commits, eq(commits.id, branches.headCommitId))
    .where(eq(branches.sessionId, sessionId))
    .orderBy(asc(branches.id));
  return rows;
}

/**
 * The saves each given commit covers, in one query: the saves on the commit's
 * branch after its parent's save, up to and including its own. A session's
 * saves are unique by file time, so time alone orders them.
 */
async function savesCoveredBy(
  commitIds: number[]
): Promise<Map<number, Save[]>> {
  const own = alias(saves, "own_save");
  const parent = alias(commits, "parent_commit");
  const parentSave = alias(saves, "parent_save");

  const rows = await db
    .select({ commitId: commits.id, save: saves })
    .from(commits)
    .innerJoin(own, eq(own.id, commits.saveId))
    .leftJoin(parent, eq(parent.id, commits.parentId))
    .leftJoin(parentSave, eq(parentSave.id, parent.saveId))
    .innerJoin(
      saves,
      and(
        eq(saves.branchId, commits.branchId),
        lte(saves.fileUpdatedAt, own.fileUpdatedAt),
        or(isNull(parent.id), gt(saves.fileUpdatedAt, parentSave.fileUpdatedAt))
      )
    )
    .where(inArray(commits.id, commitIds))
    .orderBy(asc(saves.fileUpdatedAt), asc(saves.machineName));

  const named = await withCurrentMachineNames(rows.map(({ save }) => save));
  const byCommit = new Map<number, Save[]>();
  rows.forEach(({ commitId }, index) => {
    byCommit.set(commitId, [...(byCommit.get(commitId) ?? []), named[index]!]);
  });
  return byCommit;
}

/** The sample objects each given save links, one read for the page. */
async function sampleObjectsOf(
  saveIds: number[]
): Promise<Map<number, Set<string>>> {
  const rows = await inChunks(saveIds, 0, (batch) =>
    db
      .select({
        saveId: saveSampleObjects.saveId,
        hash: saveSampleObjects.objectHash,
      })
      .from(saveSampleObjects)
      .where(inArray(saveSampleObjects.saveId, batch))
  );
  const bySave = new Map<number, Set<string>>();
  for (const { saveId, hash } of rows) {
    const set = bySave.get(saveId);
    if (set) set.add(hash);
    else bySave.set(saveId, new Set([hash]));
  }
  return bySave;
}

/** The commits `where` picks, newest first, each with the saves it covers. */
async function commitsWhere(
  where: SQL | undefined,
  limit: number
): Promise<SessionCommit[]> {
  const parent = alias(commits, "parent_commit");
  const rows = await db
    .select({
      id: commits.id,
      hash: commits.hash,
      message: commits.message,
      kind: commits.kind,
      committedAt: commits.committedAt,
      machineName: commits.machineName,
      machineId: commits.machineId,
      authorId: commits.authorId,
      branch: branches.name,
      parentHash: parent.hash,
      saveHash: saves.hash,
      ownSaveId: saves.id,
      ownMeta: saves.meta,
      authorName: users.name,
    })
    .from(commits)
    .innerJoin(branches, eq(branches.id, commits.branchId))
    .innerJoin(saves, eq(saves.id, commits.saveId))
    .leftJoin(parent, eq(parent.id, commits.parentId))
    .leftJoin(users, eq(users.id, commits.authorId))
    .where(where)
    .orderBy(desc(commits.committedAt), desc(commits.id))
    .limit(limit);
  if (rows.length === 0) return [];

  const covered = await savesCoveredBy(rows.map((row) => row.id));
  const held = await sampleObjectsOf(rows.map((row) => row.ownSaveId));
  const timeIn = await timeInSetCoveredBy(rows.map((row) => row.id));
  const named = await withCurrentMachineNames(rows);
  return named.map(({ ownSaveId, ownMeta, ...commit }) => {
    const objectsHeld = held.get(ownSaveId);
    const referenced = ownMeta?.samples ?? [];
    return {
      ...commit,
      saves: covered.get(commit.id) ?? [],
      timeInSet: timeIn.get(commit.id) ?? null,
      samplesReferenced: referenced.length,
      samplesHeld: referenced.filter(
        (ref) => ref.object && objectsHeld?.has(ref.object)
      ).length,
    };
  });
}

/**
 * A session's commits, newest first, each with the saves it covers. `branch`
 * keeps those on the branch of that name (a name the session lacks keeps
 * none); `since` keeps those committed after that instant.
 */
export function getSessionCommits(
  sessionId: number,
  limit: number,
  { branch, since }: { branch?: string; since?: Date } = {}
): Promise<SessionCommit[]> {
  return commitsWhere(
    and(
      eq(commits.sessionId, sessionId),
      branch === undefined ? undefined : eq(branches.name, branch),
      since === undefined ? undefined : gt(commits.committedAt, since)
    ),
    limit
  );
}

/** Resolver for `authorizeProject`: a commit names the project its repo belongs to. */
export async function projectIdForCommit(
  id: number
): Promise<ProjectResolution> {
  const [row] = await db
    .select({ projectId: repos.projectId })
    .from(commits)
    .innerJoin(repos, eq(repos.id, commits.repoId))
    .where(eq(commits.id, id));
  return row?.projectId ?? null;
}

/** Resolver for `authorizeProject`: a save names its project directly. */
export async function projectIdForSave(id: number): Promise<ProjectResolution> {
  const [row] = await db
    .select({ projectId: saves.projectId })
    .from(saves)
    .where(eq(saves.id, id));
  return row?.projectId ?? null;
}

/** What a save's set download needs: the session's name and the save's content state. */
export async function saveDownload(id: number) {
  const [row] = await db
    .select({
      saveId: saves.id,
      sessionName: sessions.name,
      contentState: saves.contentState,
    })
    .from(saves)
    .innerJoin(sessions, eq(sessions.id, saves.sessionId))
    .where(eq(saves.id, id));
  return row;
}

/**
 * What a commit's set download needs: the session it names the file after and
 * its own save's content state.
 */
export async function commitDownload(id: number) {
  const [row] = await db
    .select({
      saveId: commits.saveId,
      sessionName: sessions.name,
      contentState: saves.contentState,
    })
    .from(commits)
    .innerJoin(saves, eq(saves.id, commits.saveId))
    .innerJoin(sessions, eq(sessions.id, commits.sessionId))
    .where(eq(commits.id, id));
  return row;
}

/**
 * What a save rebuilds from: the ids of its tree and side objects, or of its
 * raw leaf when dit could not read it, and every object it links with its
 * kind. Each id is null where the save has none.
 */
export async function saveContent(saveId: number) {
  const [save] = await db
    .select({ tree: saves.tree, side: saves.side, raw: saves.raw })
    .from(saves)
    .where(eq(saves.id, saveId));
  const linked = await db
    .select({ hash: objects.hash, kind: objects.kind })
    .from(saveObjects)
    .innerJoin(objects, eq(objects.hash, saveObjects.objectHash))
    .where(eq(saveObjects.saveId, saveId));
  return {
    tree: save?.tree ?? null,
    side: save?.side ?? null,
    raw: save?.raw ?? null,
    objects: linked,
  };
}

/** One commit with the saves it covers, or undefined when there is none. */
export async function getCommit(
  id: number
): Promise<SessionCommit | undefined> {
  const [commit] = await commitsWhere(eq(commits.id, id), 1);
  return commit;
}

/** One commit's own record: its place in history and the set it belongs to. */
export const commitRecordSchema = z.object({
  id: z.number().int(),
  hash: z.string(),
  parentHash: z.string().nullable(),
  saveHash: z.string().nullable(),
  message: z.string(),
  kind: z.enum(rawCommitKindEnum),
  committedAt: z.date(),
  branch: z.string(),
  ditSetId: z.string().nullable(),
  repoId: z.number().int(),
  sessionId: z.number().int(),
  sessionName: z.string(),
});

/** One commit's own record, or undefined when there is none. */
export async function commitRecord(id: number) {
  const parent = alias(commits, "parent_commit");
  const [row] = await db
    .select({
      id: commits.id,
      hash: commits.hash,
      parentHash: parent.hash,
      saveHash: saves.hash,
      message: commits.message,
      kind: commits.kind,
      committedAt: commits.committedAt,
      branch: branches.name,
      ditSetId: sessions.ditSetId,
      repoId: commits.repoId,
      sessionId: sessions.id,
      sessionName: sessions.name,
    })
    .from(commits)
    .innerJoin(branches, eq(branches.id, commits.branchId))
    .innerJoin(saves, eq(saves.id, commits.saveId))
    .innerJoin(sessions, eq(sessions.id, commits.sessionId))
    .leftJoin(parent, eq(parent.id, commits.parentId))
    .where(eq(commits.id, id));
  return row;
}

/** A state of a session to compare: a save, or the save a commit names. */
export const stateRefSchema = z
  .string()
  .regex(/^(save|commit):[1-9]\d*$/, 'Expected "save:<id>" or "commit:<id>"');

/**
 * The save of `sessionId` a state reference names, with its meta and the
 * session's DAW capabilities; null when the save or commit is not the
 * session's. A commit stands for the save it names.
 */
export async function resolveState(sessionId: number, ref: string) {
  const [kind, rawId] = ref.split(":");
  const id = Number(rawId);
  const [row] =
    kind === "commit"
      ? await db
          .select({ saveId: saves.id, meta: saves.meta })
          .from(commits)
          .innerJoin(saves, eq(saves.id, commits.saveId))
          .where(and(eq(commits.id, id), eq(commits.sessionId, sessionId)))
      : await db
          .select({ saveId: saves.id, meta: saves.meta })
          .from(saves)
          .where(and(eq(saves.id, id), eq(saves.sessionId, sessionId)));
  return row ?? null;
}
