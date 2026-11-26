import {
  and,
  eq,
  gt,
  inArray,
  lt,
  notExists,
  type SQL,
  sql,
} from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { instancePolicy } from "../../lib/instance-policy.js";
import { db } from "../index.js";
import { objects, repoObjects, saveObjects } from "../schema/objects.js";
import { commits } from "../schema/repos.js";
import { saves } from "../schema/saves.js";
import {
  enqueueInstanceJob,
  lastInstanceJob,
  registerJobHandler,
  startInstanceJobs,
} from "./jobs.js";
import { removeUnnamedObjectFiles } from "./objects.js";
import {
  holdersOf,
  projectScope,
  recomputeUsage,
  type UsageScope,
  userScope,
} from "./storage-usage.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** How often the sweeper runs. */
const SWEEP_INTERVAL_MS = DAY_MS;

/** The most rows one statement touches, so a first sweep never holds one long lock. */
const SWEEP_BATCH = 1000;

/**
 * The most keys one statement of a {@link keyWalk} visits, so a long run of
 * keys with nothing to take stays a series of short statements.
 */
const WALK_SPAN = 10_000;

/**
 * How long a repo's link to an object is left alone after it was pushed. A
 * pack lands its objects before the commit that names them, so a link younger
 * than this may belong to a push still in flight.
 */
const PUSH_GRACE_MS = DAY_MS;

/** A step a test runs between the sweep's statements, to force an interleaving. */
export type SaveContentSweepHooks = {
  /** After a batch's `objects` rows are deleted and committed, before their files go. */
  afterObjectRowsDeleted?: (hashes: string[]) => Promise<void>;
};

export type SaveContentSweep = {
  /** Saves whose content was dropped. */
  pruned: number;
  /** `repo_objects` links removed. */
  unlinked: number;
  /** `objects` rows, and their files, removed. */
  reaped: number;
  /** The bytes of the objects reaped. */
  bytesFreed: number;
};

/**
 * Drops the content of every stored save older than `cutoff` that no commit
 * names as its own: its `save_objects` go and it becomes `pruned`. The row, its
 * meta and its place in history stay. A save's age is when the file was saved
 * (`fileUpdatedAt`). Batches walk the id upward.
 */
async function pruneSaves(cutoff: Date, batchSize: number): Promise<number> {
  const uncommitted = (id: typeof saves.id) =>
    notExists(
      db
        .select({ one: sql`1` })
        .from(commits)
        .where(eq(commits.saveId, id))
    );
  let after = 0;
  let pruned = 0;

  for (;;) {
    const batch = await db
      .select({ id: saves.id })
      .from(saves)
      .where(
        and(
          gt(saves.id, after),
          eq(saves.contentState, "stored"),
          lt(saves.fileUpdatedAt, cutoff),
          uncommitted(saves.id)
        )
      )
      .orderBy(saves.id)
      .limit(batchSize);
    if (batch.length === 0) return pruned;
    const ids = batch.map((row) => row.id);

    // The conditions are checked again in the update, so a commit that landed
    // since the select keeps its save's content.
    const done = await db.transaction(async (tx) => {
      const flipped = await tx
        .update(saves)
        .set({ contentState: "pruned" })
        .where(
          and(
            inArray(saves.id, ids),
            eq(saves.contentState, "stored"),
            uncommitted(saves.id)
          )
        )
        .returning({ id: saves.id });
      if (flipped.length > 0) {
        await tx.delete(saveObjects).where(
          inArray(
            saveObjects.saveId,
            flipped.map((row) => row.id)
          )
        );
      }
      return flipped.length;
    });

    pruned += done;
    if (batch.length < batchSize) return pruned;
    after = Math.max(...ids);
  }
}

/** A primary-key column of a {@link keyWalk}, and the value the walk starts past. */
type WalkKey = { column: PgColumn; after: string | number };

/**
 * The `walk` term of a `with` statement, read as `walk w`: the rows of `table`
 * past the keys' `after` values, in primary-key order, each with its `tid`,
 * its place in the walk, how many rows before it `take` holds for, and whether
 * it holds for this one. The walk ends at the row that brings the rows taken
 * to `limit`, or after {@link WALK_SPAN} rows. `take` reads the row through
 * the column reference it is handed. {@link lastWalked} is where the next
 * batch starts.
 *
 * The rows come from one range read of the primary key, `take` tests each row
 * alone, and the plan reads each row past `after` once at most whatever the
 * statistics say. On fresh statistics the range is an index scan of its own
 * rows. Once they put the table at a few hundred rows it is a scan and sort
 * of the whole table, and at a handful, as a vacuum of a table all but
 * emptied leaves them until the next analyse, a bitmap of every key past
 * `after` and a sort: one pass over the rest of the table per statement, some
 * 0.4 s at a million rows against 50 ms on fresh statistics. A walk that
 * looked up each next key with a range read of its own would make that pass
 * once per key. The single statement `… where not exists (…) order by key
 * limit n` is planned under such statistics as a scan of every link the rows
 * are checked against.
 */
function keyWalk(
  table: PgTable,
  key: WalkKey[],
  take: (row: (column: PgColumn) => SQL) => SQL,
  limit: number
): SQL {
  const column = (alias: string) => (keyColumn: PgColumn) =>
    sql`${sql.identifier(alias)}.${sql.identifier(keyColumn.name)}`;
  const columns = (alias: string) =>
    sql.join(
      key.map((part) => column(alias)(part.column)),
      sql`, `
    );
  const names = sql.join(
    key.map((part) => sql.identifier(part.column.name)),
    sql`, `
  );
  const start = sql.join(
    key.map((part) => sql`${part.after}::${sql.raw(part.column.getSQLType())}`),
    sql`, `
  );

  // `offset 0` keeps `t` a subquery of its own, so `take` runs once per row
  // rather than once for each place `t.take` appears. A row stays in the walk
  // while fewer than `limit` rows before it were taken. That count only grows
  // along the walk, so the window stops at the first row past the limit (its
  // plan shows a Run Condition) rather than testing `take` for every row the
  // range holds.
  return sql`walk(${names}, tid, walked, taken, take) as materialized (
    select s.*
      from (
        select ${columns("k")}, k.tid,
               row_number() over keys,
               count(*) filter (where t.take) over (keys rows between unbounded preceding and 1 preceding),
               t.take
          from (
            select x.ctid as tid, x.* from ${table} x
             where (${columns("x")}) > (${start})
             order by ${columns("x")}
             limit ${WALK_SPAN}
          ) k
          cross join lateral (select ${take(column("k"))} as take offset 0) t
        window keys as (order by ${columns("k")})
      ) s(${names}, tid, walked, taken, take)
     where s.taken < ${limit}
  )`;
}

/**
 * The last row of `walk w`, which the next batch starts past. There is none
 * once no key is left past where the walk started.
 */
const lastWalked = sql`w.walked = (select max(walked) from walk)`;

/** `values` as one SQL array of `type`. */
const sqlArray = (values: string[], type: "text" | "tid") =>
  sql`array[${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `
  )}]::${sql.raw(type)}[]`;

/**
 * Whether no repo holds, no save rebuilds from and no commit's save lists as a
 * sample the object `hash` names. As
 * a bare `where` condition it becomes an anti-join, which the planner may run
 * against a scan of every link; inside a select list or a scalar subquery it
 * stays two index probes per row.
 */
const unreferenced = (hash: SQL) => sql`
  not exists (select 1 from repo_objects ro where ro.object_hash = ${hash})
  and not exists (select 1 from save_objects so where so.object_hash = ${hash})
  and not exists (select 1 from save_sample_objects sso where sso.object_hash = ${hash})`;

/**
 * One batch of the unlink: walks `repo_objects` past `after` and deletes the
 * links it takes, found by their `tid` so the delete is a TID scan whatever
 * the statistics say. Returns every link the delete removed, then the last
 * link walked with `unlinked` false. A link another transaction removed since
 * the walk read it is not among them.
 *
 * A link is taken once no save of a session in its repo rebuilds from its
 * object, lists it as a sample (`save_sample_objects`, probed the same way),
 * or names it as a lineage object (`commits.hash` or `saves.hash`):
 * the saves that do are found by the object's hash, then each one's
 * session by a primary-key probe of `saves` and of `sessions` in turn. Written
 * as a join, the planner may reach the saves through the repo's sessions,
 * reading every save of a session for each link, or walk the key of `saves` or
 * `sessions` from its start for each one, as a merge join or a nested loop
 * that filters the join; nested scalar lookups leave it no join to choose.
 */
const unlinkBatch = (
  after: { repoId: number; hash: string },
  graceCutoff: Date,
  limit: number
) => sql`
  with ${keyWalk(
    repoObjects,
    [
      { column: repoObjects.repoId, after: after.repoId },
      { column: repoObjects.objectHash, after: after.hash },
    ],
    (row) => sql`
      ${row(repoObjects.pushedAt)} < ${graceCutoff.toISOString()}::timestamp
      and not exists (
        select 1
          from save_objects so
         where so.object_hash = ${row(repoObjects.objectHash)}
           and (select se.repo_id
                  from sessions se
                 where se.id = (select s.session_id
                                  from saves s
                                 where s.id = so.save_id)) = ${row(repoObjects.repoId)}
      )
      and not exists (
        select 1
          from save_sample_objects sso
         where sso.object_hash = ${row(repoObjects.objectHash)}
           and (select se.repo_id
                  from sessions se
                 where se.id = (select s.session_id
                                  from saves s
                                 where s.id = sso.save_id)) = ${row(repoObjects.repoId)}
      )
      and not exists (
        select 1
          from commits c
         where c.repo_id = ${row(repoObjects.repoId)}
           and c.hash = ${row(repoObjects.objectHash)}
      )
      and not exists (
        select 1
          from saves s
         where s.hash = ${row(repoObjects.objectHash)}
           and (select se.repo_id
                  from sessions se
                 where se.id = s.session_id) = ${row(repoObjects.repoId)}
      )`,
    limit
  )}, gone as (
    delete from repo_objects ro
     where ro.ctid = any(array(select w.tid from walk w where w.take))
    returning ro.repo_id, ro.object_hash, ro.pushed_by
  )
  select g.repo_id, g.object_hash, g.pushed_by, r.project_id, true as unlinked
    from gone g
    join repos r on r.id = g.repo_id
  union all
  select w.repo_id, w.object_hash, null, null, false
    from walk w
   where ${lastWalked}
   order by unlinked desc
`;

/**
 * One batch of the reap's walk: the objects past `after` nothing references,
 * marked `take`, then the last object walked.
 */
const reapBatch = (after: string, limit: number) => sql`
  with ${keyWalk(
    objects,
    [{ column: objects.hash, after }],
    (row) => unreferenced(row(objects.hash)),
    limit
  )}
  select w.hash, w.take
    from walk w
   where w.take or ${lastWalked}
   order by w.walked
`;

/**
 * Locks the `objects` rows of `hashes`, each found by its own probe of the
 * primary key, and returns their `tid`s.
 */
const lockObjectRows = (hashes: string[]) => sql`
  select l.hash, l.tid
    from unnest(${sqlArray(hashes, "text")}) as h(hash)
    cross join lateral (
      select o.hash, o.ctid as tid from objects o where o.hash = h.hash for update
    ) l
`;

/**
 * Deletes the locked `rows` nothing references. The check runs over `rows`
 * alone and the delete finds them by `tid`, a TID scan whatever the statistics
 * say; the rows are locked, so their `tid`s hold.
 */
const deleteUnreferenced = (rows: { hash: string; tid: string }[]) => sql`
  delete from objects o
   where o.ctid = any(array(
     select k.tid
       from unnest(
         ${sqlArray(
           rows.map((row) => row.tid),
           "tid"
         )},
         ${sqlArray(
           rows.map((row) => row.hash),
           "text"
         )}
       ) as k(tid, hash)
      where (select ${unreferenced(sql`k.hash`)})
   ))
  returning o.hash, o.size
`;

/** The statements the unlink and the reap run, for a test to read their plans. */
export const sweepStatements = {
  unlinkBatch,
  reapBatch,
  lockObjectRows,
  deleteUnreferenced,
};

/** A link a batch removed, or with `unlinked` false the last link it walked. */
type BatchLinkRow = { repo_id: number; object_hash: string } & (
  | { unlinked: true; pushed_by: string | null; project_id: number }
  | { unlinked: false; pushed_by: null; project_id: null }
);

/**
 * Removes each repo's link to an object once no save in a session of that repo
 * rebuilds from it and the link is past {@link PUSH_GRACE_MS}, so a repo pays
 * only for the objects its own saves reference. Batches walk `(repo_id,
 * object_hash)` upward, past every link a batch selected, including one
 * another transaction removed first. Returns how many links went. The scopes
 * whose counters they were part of, and the holders of other links of the
 * same objects, which pay for them now, are re-derived on the way out, whether the
 * walk finished or threw: each batch commits its deletes on its own, and a
 * removed link is not walked again, so a later sweep would never collect them.
 *
 * A commit that checked `repo_objects` for one of these links just before the
 * delete still commits, since `save_objects` has no foreign key to
 * `repo_objects`: its save then holds an object the repo no longer pays for,
 * until a later push lists the object again and `missing` reports it.
 */
async function unlinkRepoObjects(batchSize: number): Promise<number> {
  const graceCutoff = new Date(Date.now() - PUSH_GRACE_MS);
  const scopes = new Map<string, UsageScope>();
  let after = { repoId: 0, hash: "" };
  let unlinked = 0;

  try {
    for (;;) {
      const { rows } = await db.execute<BatchLinkRow>(
        unlinkBatch(after, graceCutoff, batchSize)
      );

      const freed = new Set<string>();
      for (const row of rows) {
        if (!row.unlinked) continue;
        unlinked++;
        freed.add(row.object_hash);
        const project = projectScope(row.project_id);
        scopes.set(`project:${project.id}`, project);
        if (row.pushed_by) {
          const user = userScope(row.pushed_by);
          scopes.set(`user:${user.id}`, user);
        }
      }
      // The earliest link may have been one of these: whoever holds another
      // link of the hash now pays for it.
      for (const scope of await holdersOf([...freed])) {
        scopes.set(`${scope.kind}:${scope.id}`, scope);
      }

      const last = rows.at(-1);
      if (!last) return unlinked;
      after = { repoId: last.repo_id, hash: last.object_hash };
    }
  } finally {
    if (scopes.size > 0) await recomputeUsage([...scopes.values()]);
  }
}

/**
 * Deletes every `objects` row that no repo holds and no save rebuilds from,
 * then removes its file. The rows are locked and the absence of links is
 * checked again inside the transaction that deletes them; the batch's files go
 * after that commits, through {@link removeUnnamedObjectFiles}, which keeps the
 * file of an object a push has stored again since. Dying between the two steps
 * leaves only files no row names, which the storage audit removes. Batches walk
 * the hash upward.
 */
async function reapObjects(
  batchSize: number,
  hooks: SaveContentSweepHooks
): Promise<{ reaped: number; bytesFreed: number }> {
  let after = "";
  let reaped = 0;
  let bytesFreed = 0;

  for (;;) {
    const { rows } = await db.execute<{ hash: string; take: boolean }>(
      reapBatch(after, batchSize)
    );
    const last = rows.at(-1);
    if (!last) return { reaped, bytesFreed };
    after = last.hash;
    const hashes = rows.filter((row) => row.take).map((row) => row.hash);
    if (hashes.length === 0) continue;

    const removed = await db.transaction(async (tx) => {
      const locked = await tx.execute<{ hash: string; tid: string }>(
        lockObjectRows(hashes)
      );
      if (locked.rows.length === 0) return [];
      const deleted = await tx.execute<{ hash: string; size: string | number }>(
        deleteUnreferenced(locked.rows)
      );
      return deleted.rows;
    });

    const removedHashes = removed.map((row) => row.hash);
    await hooks.afterObjectRowsDeleted?.(removedHashes);
    await removeUnnamedObjectFiles(removedHashes);
    reaped += removed.length;
    bytesFreed += removed.reduce((total, row) => total + Number(row.size), 0);
  }
}

/**
 * Drops the content nobody keeps, in three steps: stored saves older than the
 * instance's `jobs.saveContentRetentionDays` that no commit names as its own
 * lose their `save_objects` and become `pruned`; each repo's link to an object
 * its own saves no longer reference is removed; an object nothing references
 * is deleted with its file. The scopes whose links went are re-derived before
 * the reap, so the counters follow the rows whatever the reap does: an object
 * it deletes has no link left, so no counter holds it.
 */
export async function sweepSaveContent(
  batchSize = SWEEP_BATCH,
  hooks: SaveContentSweepHooks = {}
): Promise<SaveContentSweep> {
  const days = instancePolicy().jobs.saveContentRetentionDays;
  const cutoff = new Date(Date.now() - days * DAY_MS);

  const pruned = await pruneSaves(cutoff, batchSize);
  const unlinked = await unlinkRepoObjects(batchSize);
  const { reaped, bytesFreed } = await reapObjects(batchSize, hooks);

  return { pruned, unlinked, reaped, bytesFreed };
}

registerJobHandler(
  "save_content_sweep",
  async () => ({ ...(await sweepSaveContent()) }),
  { label: "Dropping save content nobody keeps" }
);

/** Queues a sweep unless one is already waiting or running. */
export const enqueueSaveContentSweep = () =>
  enqueueInstanceJob("save_content_sweep");

/**
 * The most recent sweep that finished, done or failed, for the instance
 * storage readout and the retention setting's last-run line. Null before the
 * first one has.
 */
export async function lastSaveContentSweep(): Promise<{
  finishedAt: Date | null;
  status: "done" | "failed";
  bytesFreed: number;
} | null> {
  const row = await lastInstanceJob("save_content_sweep", ["done", "failed"]);
  if (!row) return null;

  const freed = row.result?.bytesFreed;
  return {
    finishedAt: row.finishedAt,
    status: row.status === "done" ? "done" : "failed",
    bytesFreed: typeof freed === "number" ? freed : 0,
  };
}

/**
 * Queues a sweep at boot, then once a day and again at once when the instance
 * changes how long uncommitted content is kept, for as long as the process
 * lives. The sweep itself runs as a `save_content_sweep` job, so its time,
 * result or failure is a row. `enqueue` is the queueing step, which a test
 * replaces. Returns the stop.
 */
export function startSaveContentSweeper(
  enqueue: () => Promise<unknown> = enqueueSaveContentSweep
): () => void {
  return startInstanceJobs(enqueue, "could not queue the save content sweep", {
    intervalMs: () => SWEEP_INTERVAL_MS,
    runAgainOn: (policy) => policy.jobs.saveContentRetentionDays,
  });
}
