import type { Job, JobKind } from "@workspace/api/api";

/** How long a finished row sits in the tray before it disappears. */
export const LINGER_MS = 4000;

/** How often the fallback poll reads the collapsed endpoint while the queue
 *  is moving. */
export const FALLBACK_POLL_MS = 2000;

/** How often the fallback poll reads it once idle: about once a minute. */
export const IDLE_POLL_MS = 60_000;

/** How long the tray's indicator shows its tick right after a job finishes. */
export const DRAIN_TICK_MS = 1000;

/** The most failed jobs the tray lists; the server keeps every one until
 *  cleared, newest first. */
export const FAILED_LIMIT = 20;

/** How far back a read keeps a finished row, matching the server's own
 *  `/jobs/events` snapshot window so the stream and its fallback agree. */
export const RECENT_WINDOW_MS = 10_000;

export type JobsEvent =
  { type: "snapshot"; jobs: readonly Job[] } | { type: "job"; job: Job };

/**
 * Applies one server-sent event to the project's job map: a `snapshot`
 * replaces it outright (it is the whole truth as of the read), a `job` event
 * upserts the one row it names. Both return a new map, so the result can go
 * straight into `setState` or another `onUpdate`.
 */
export function applyEvent(
  jobs: ReadonlyMap<number, Job>,
  event: JobsEvent
): Map<number, Job> {
  if (event.type === "snapshot") {
    return new Map(event.jobs.map((job) => [job.id, job] as const));
  }
  const next = new Map(jobs);
  next.set(event.job.id, event.job);
  return next;
}

/**
 * When a finished row should leave the map, or `null` if it should stay: a
 * row still moving, or a failed one, which stays until the reader clears it.
 */
export function lingerUntil(job: Job): number | null {
  if (job.status !== "done" && job.status !== "cancelled") return null;
  if (!job.finishedAt) return null;
  return new Date(job.finishedAt).getTime() + LINGER_MS;
}

/** Drops every row whose linger has passed as of `now`. */
export function pruneLingering(
  jobs: ReadonlyMap<number, Job>,
  now: number
): Map<number, Job> {
  const next = new Map(jobs);
  for (const [id, job] of jobs) {
    const until = lingerUntil(job);
    if (until != null && until <= now) next.delete(id);
  }
  return next;
}

export type FallbackState = {
  /** Whether the tab is on screen (`document.visibilityState`). */
  visible: boolean;
  /** Whether the map most recently held anything queued or running. */
  active: boolean;
};

/**
 * The wait before the fallback poll's next read, or `null` to stop until the
 * tab is shown again — nobody is watching a hidden tab, and showing it again
 * reopens the stream, which resyncs everything the poll would have caught.
 */
export function fallbackDelay(state: FallbackState): number | null {
  if (!state.visible) return null;
  return state.active ? FALLBACK_POLL_MS : IDLE_POLL_MS;
}

/** A row still moving: what a drain watcher and the tray's badge count. */
export function isActive(job: Job): boolean {
  return job.status === "running" || job.status === "queued";
}

const STATUS_RANK: Record<Job["status"], number> = {
  running: 0,
  queued: 1,
  done: 2,
  cancelled: 2,
  failed: 3,
};

/**
 * The tray's row order: running first, then queued rows by their place in
 * line, then rows lingering after they finished or were cancelled, then
 * failed rows last.
 */
export function orderJobs(jobs: readonly Job[]): Job[] {
  return [...jobs].sort((a, b) => {
    const rank = STATUS_RANK[a.status] - STATUS_RANK[b.status];
    if (rank !== 0) return rank;
    if (a.status === "queued" && b.status === "queued") {
      return (a.queuePosition ?? 0) - (b.queuePosition ?? 0);
    }
    // Newest first within a rank, matching the server's own ordering.
    return b.id - a.id;
  });
}

/**
 * Watches one set of kinds across successive updates of the queue and calls
 * `onDrain` when none of them is running or queued any more.
 *
 * The first read counts: a page mounts its watcher because the server said a
 * figure is still being measured, and a short job can finish before that read,
 * so finding nothing then is a drain too. After that only a watched kind going
 * from present to absent fires, so a figure that can never be measured costs
 * one refresh rather than one per update. Nothing fires before the first read.
 */
export function createDrainWatch(
  kinds: ReadonlySet<JobKind>,
  onDrain: () => void
): (jobs: readonly Job[]) => void {
  let wasPresent: boolean | null = null;

  return (jobs) => {
    const present = jobs.some((job) => isActive(job) && kinds.has(job.kind));
    const drained = !present && wasPresent !== false;
    wasPresent = present;
    if (drained) onDrain();
  };
}

/**
 * Watches one set of kinds across successive updates of the queue and calls
 * `onFinish` whenever a job of theirs that was running or queued in the
 * previous read is not any more: once per update, however many finished in
 * it.
 *
 * Unlike a drain, this does not wait for the rest of the queue. A reader
 * waiting on one audio's analysis hears its job finish while a project
 * backfill or another version's job is still going. The first read only
 * records what is active, so nothing fires before a job has been seen.
 */
export function createFinishWatch(
  kinds: ReadonlySet<JobKind>,
  onFinish: () => void
): (jobs: readonly Job[]) => void {
  let activeIds: ReadonlySet<number> = new Set();

  return (jobs) => {
    const next = new Set(
      jobs
        .filter((job) => isActive(job) && kinds.has(job.kind))
        .map((job) => job.id)
    );
    const finished = [...activeIds].some((id) => !next.has(id));
    activeIds = next;
    if (finished) onFinish();
  };
}

export type TrayIndicator = "running" | "drained" | "failed" | "hidden";

/**
 * What the tray's button shows: a spinner while anything runs, a tick for the
 * one second right after a job finishes, a warning while failed jobs wait for
 * a retry, and nothing otherwise. A cancelled row never counts as running,
 * and it drives no tick — only a `done` row does.
 */
export function trayIndicator({
  jobs,
  now,
}: {
  jobs: readonly Job[];
  now: number;
}): TrayIndicator {
  if (jobs.some((job) => job.status === "running")) return "running";
  if (
    jobs.some(
      (job) =>
        job.status === "done" &&
        job.finishedAt != null &&
        now - new Date(job.finishedAt).getTime() < DRAIN_TICK_MS
    )
  )
    return "drained";
  if (jobs.some((job) => job.status === "failed")) return "failed";
  return "hidden";
}

/** A running job's time so far, as `42s` or `3m`. */
export function elapsedLabel(startedAt: string | Date, now: number): string {
  const seconds = Math.max(
    0,
    Math.round((now - new Date(startedAt).getTime()) / 1000)
  );
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m`;
}
