import { sql } from "drizzle-orm";
import { db, type Tx } from "../db/index.js";

/** How long a case waits for a competing actor to queue behind a held lock. */
const BLOCK_TIMEOUT_MS = 10_000;

/**
 * A transaction left open on a connection of its own, holding whatever locks
 * its opening step took, so a case can start a competing actor, wait for it to
 * queue behind those locks, and only then let the transaction finish.
 */
export type HeldTransaction = {
  /**
   * Resolves once a chain of `depth` connections queues behind this
   * transaction: at 1, one waiting on a lock it holds; at 2, also one waiting
   * on a lock that waiter holds. Throws when nothing queues that deep within
   * {@link BLOCK_TIMEOUT_MS}.
   */
  blocking: (depth?: number) => Promise<void>;
  /**
   * Runs `finish` inside the transaction and commits it. Calling it again, as
   * a `finally` does, waits for the same end.
   */
  commit: (finish?: (tx: Tx) => Promise<void>) => Promise<void>;
};

/** Waits until a chain of `depth` connections is blocked behind `pid`. */
async function blockedBehind(pid: number, depth: number): Promise<void> {
  const deadline = Date.now() + BLOCK_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const { rows } = await db.execute<{ waiting: number }>(
      sql`with recursive queue(pid, depth) as (
            select ${pid}::int, 0
            union
            select a.pid, queue.depth + 1
            from pg_stat_activity a
            join queue on queue.pid = any(pg_blocking_pids(a.pid))
            where queue.depth < ${depth}::int
          )
          select count(*)::int as waiting from queue where depth = ${depth}::int`
    );
    if ((rows[0]?.waiting ?? 0) > 0) return;
    await Bun.sleep(10);
  }
  throw new Error(`nothing queued ${depth} deep behind backend ${pid}`);
}

/** Opens a transaction, runs `open` in it, and holds it until `commit`. */
export async function holdTransaction(
  open: (tx: Tx) => Promise<void>
): Promise<HeldTransaction> {
  let pid = 0;
  let opened!: () => void;
  let failed!: (error: unknown) => void;
  const ready = new Promise<void>((resolve, reject) => {
    opened = resolve;
    failed = reject;
  });
  let finishWith!: (finish: (tx: Tx) => Promise<void>) => void;
  const finishing = new Promise<(tx: Tx) => Promise<void>>(
    (resolve) => (finishWith = resolve)
  );

  const done = db.transaction(async (tx) => {
    await open(tx);
    const { rows } = await tx.execute<{ pid: number }>(
      sql`select pg_backend_pid() as pid`
    );
    pid = rows[0]!.pid;
    opened();
    await (
      await finishing
    )(tx);
  });
  done.catch(failed);
  await ready;

  return {
    blocking: (depth = 1) => blockedBehind(pid, depth),
    commit: async (finish = async () => {}) => {
      finishWith(finish);
      await done;
    },
  };
}
