import { elapsedLabel, isActive } from "@/components/jobs/jobs-poll";
import type { Job } from "@workspace/api/api";

export type JobRowText = {
  /** The kind's name, plus the subject it names when the server sent one:
   *  "Analysing audio · v3 mix.wav". */
  eyebrow: string;
  /** The current step's label, or the kind's name before a run has claimed
   *  the row and written its ladder. */
  title: string;
  /** "Step 2 of 3", or `null` for a one-step ladder — showing "Step 1 of 1"
   *  would tell the reader nothing a single bar does not already. */
  stepLine: string | null;
  /** "Queued · #3" for a queued row with a known position; `null` otherwise.
   *  `queuePosition` is the row's place in the server's process-wide queue
   *  (`apps/server/src/db/schema/jobs.ts`), not the project's, so the line
   *  names the position alone rather than pairing it with a project-scoped
   *  count that would not be the position's own denominator. */
  queueLine: string | null;
  /** Elapsed time for a running row, or "Done"/"Cancelled" once it has
   *  finished; `null` for a queued or failed row, which show no clock. */
  statusLine: string | null;
};

/**
 * The tray row's text, derived once from the job and the clock so the row
 * component stays a thin render of these five strings.
 */
export function describeJobRow(job: Job, now: number): JobRowText {
  const eyebrow = job.subjectLabel
    ? `${job.label} · ${job.subjectLabel}`
    : job.label;

  const currentStep =
    job.stepIndex != null ? job.steps[job.stepIndex] : undefined;
  const title = currentStep?.label ?? job.label;

  const stepLine =
    job.stepIndex != null && job.steps.length > 1
      ? `Step ${job.stepIndex + 1} of ${job.steps.length}`
      : null;

  const queueLine =
    job.status === "queued" && job.queuePosition != null
      ? `Queued · #${job.queuePosition}`
      : null;

  const statusLine =
    job.status === "running" && job.startedAt
      ? elapsedLabel(job.startedAt, now)
      : job.status === "done"
        ? "Done"
        : job.status === "cancelled"
          ? "Cancelled"
          : null;

  return { eyebrow, title, stepLine, queueLine, statusLine };
}

/**
 * What a screen reader should hear about the queue moving from `prev` to
 * `next`, or `null` when nothing worth saying happened: a job that was
 * running or queued has failed, or the last active job has finished. Only a
 * job present in both maps counts, so switching project announces nothing.
 */
export function jobsAnnouncement(
  prev: ReadonlyMap<number, Job>,
  next: ReadonlyMap<number, Job>
): string | null {
  const settled = [...next.values()].filter((job) => {
    const before = prev.get(job.id);
    return before !== undefined && isActive(before) && !isActive(job);
  });
  const failed = settled.filter((job) => job.status === "failed");

  if (failed.length === 1)
    return `${describeJobRow(failed[0]!, 0).eyebrow} failed`;
  if (failed.length > 1) return `${failed.length} background jobs failed`;

  const drained =
    settled.some((job) => job.status === "done") &&
    ![...next.values()].some(isActive);
  return drained ? "Background jobs finished" : null;
}

/** A run of failed jobs that failed the same way: the newest stands for the
 *  group, and `ids` lists every job in it, newest first. */
export type FailureGroup = { job: Job; ids: number[] };

/**
 * Collapses failed jobs that are the same failure — the same kind, about the
 * same subject, stopped at the same step with the same error — into one
 * group each, in the order their newest job arrived. A file that fails the
 * same way on every retry then reads as one row with a count rather than a
 * column of identical rows.
 */
export function groupFailures(failed: readonly Job[]): FailureGroup[] {
  const groups = new Map<string, FailureGroup>();
  for (const job of failed) {
    const key = [
      job.kind,
      job.subjectLabel ?? "",
      job.stepIndex ?? "",
      job.error ?? "",
    ].join("\u0000");
    const group = groups.get(key);
    if (group) group.ids.push(job.id);
    else groups.set(key, { job, ids: [job.id] });
  }
  return [...groups.values()];
}
