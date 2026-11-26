import { and, gt, inArray, lt } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import { instancePolicy } from "../../lib/instance-policy.js";
import { errorFields, log } from "../../lib/log.js";
import { startPolicyTimer } from "../../lib/policy-timer.js";
import { db } from "../index.js";
import { activity } from "../schema/activity.js";

const logger = log("retention");

const DAY_MS = 24 * 60 * 60 * 1000;

/** How often the sweeper runs while a retention is set. */
const SWEEP_INTERVAL_MS = DAY_MS;

/** The most rows one statement deletes, so a first sweep over years of history never holds one long lock. */
const SWEEP_BATCH = 1000;

export type RetentionSweep = { activity: number };

/**
 * Deletes the rows of `table` whose `age` is before `cutoff`, `batchSize` at a
 * time. Each batch is one statement over a bounded set of ids, found by
 * walking the primary key upward from where the last batch stopped, so the
 * sweep reads the table once however many batches it takes. Returns how many
 * rows went.
 */
async function deleteBefore(
  table: PgTable,
  id: AnyPgColumn,
  age: AnyPgColumn,
  cutoff: Date,
  batchSize: number
): Promise<number> {
  let after = 0;
  let deleted = 0;

  for (;;) {
    const batch = db
      .select({ id })
      .from(table)
      .where(and(gt(id, after), lt(age, cutoff)))
      .orderBy(id)
      .limit(batchSize);
    const rows = (await db
      .delete(table)
      .where(inArray(id, batch))
      .returning({ id })) as { id: number }[];

    deleted += rows.length;
    if (rows.length < batchSize) return deleted;
    after = Math.max(...rows.map((row) => row.id));
  }
}

/**
 * Deletes activity rows older than the instance's
 * `jobs.activityRetentionDays`, in bounded batches; null when no retention is
 * set, which keeps them forever. Saves are not touched: their content is
 * dropped by `sweepSaveContent`, and the rows stay.
 */
export async function sweepRetention(
  batchSize = SWEEP_BATCH
): Promise<RetentionSweep | null> {
  const days = instancePolicy().jobs.activityRetentionDays;
  if (days == null) return null;

  const cutoff = new Date(Date.now() - days * DAY_MS);
  return {
    activity: await deleteBefore(
      activity,
      activity.id,
      activity.createdAt,
      cutoff,
      batchSize
    ),
  };
}

/**
 * Sweeps once at boot, then once a day and again at once when the instance
 * changes the retention, for as long as the process lives. `sweep` is the
 * sweeping step, which a test replaces. Returns the stop.
 */
export function startRetentionSweeper(
  sweep: () => Promise<RetentionSweep | null> = sweepRetention
): () => void {
  const run = () =>
    void sweep()
      .then((swept) => {
        if (swept && swept.activity > 0) {
          logger.info("pruned activity past its retention", swept);
        }
      })
      .catch((error: unknown) =>
        logger.error("retention sweep failed", errorFields(error))
      );

  run();
  return startPolicyTimer(run, {
    intervalMs: () => SWEEP_INTERVAL_MS,
    runAgainOn: (policy) => policy.jobs.activityRetentionDays,
  });
}
