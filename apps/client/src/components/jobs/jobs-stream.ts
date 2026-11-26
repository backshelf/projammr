import {
  applyEvent,
  fallbackDelay,
  isActive,
  lingerUntil,
  pruneLingering,
  type JobsEvent,
} from "@/components/jobs/jobs-poll";
import type { Job } from "@workspace/api/api";

/** How often a dropped stream tries to reconnect. */
const STREAM_RETRY_MS = 30_000;

/** The slice of `EventSource` the controller needs, so a test can hand it a
 *  stand-in with no network and no DOM. */
export type EventSourceLike = {
  addEventListener(
    type: string,
    listener: (event: { data?: unknown }) => void
  ): void;
  close(): void;
};

export type TimerHandle = ReturnType<typeof setTimeout>;

export type JobsStreamDeps = {
  /** Opens one attempt at the transport; called again on every retry and
   *  every time the tab comes back into view. */
  createEventSource: () => EventSourceLike;
  /** The collapsed read used while the stream is down. Rejects on failure. */
  fetchJobs: () => Promise<Job[]>;
  /** Called with the map after every change: a stream event, a fallback
   *  read, or a linger expiring. */
  onUpdate: (jobs: ReadonlyMap<number, Job>) => void;
  setTimeout: (run: () => void, ms: number) => TimerHandle;
  clearTimeout: (handle: TimerHandle) => void;
  now: () => number;
};

/**
 * Keeps one project's job map current: its event stream while the stream is
 * up, a timed poll of the collapsed read while it is not, and the linger that
 * lets a finished row sit in view for a few seconds before it leaves the map.
 *
 * Every side effect — the transport, the fallback fetch, the clock — is
 * injected, so the whole state machine runs under a fake clock in a test with
 * no DOM and no network.
 */
export function createJobsStream(deps: JobsStreamDeps) {
  let jobs = new Map<number, Job>();
  let source: EventSourceLike | null = null;
  let fallbackTimer: TimerHandle | null = null;
  let retryTimer: TimerHandle | null = null;
  let lingerTimer: TimerHandle | null = null;
  let visible = true;
  let running = false;
  let loaded = false;
  // Bumped every time a stream attempt opens, so a fallback read started
  // against an earlier attempt can tell it is stale once it resolves —
  // a hide/show or a 30 s retry can reconnect the stream while an in-flight
  // fallback fetch from before is still pending, and that fetch's snapshot
  // must not overwrite whatever the reconnected stream has since reported.
  let epoch = 0;

  const cancel = (timer: TimerHandle | null) => {
    if (timer != null) deps.clearTimeout(timer);
  };

  const scheduleLinger = () => {
    cancel(lingerTimer);
    lingerTimer = null;
    let next: number | null = null;
    for (const job of jobs.values()) {
      const until = lingerUntil(job);
      if (until != null && (next == null || until < next)) next = until;
    }
    if (next == null) return;
    const delay = Math.max(0, next - deps.now());
    lingerTimer = deps.setTimeout(() => {
      jobs = pruneLingering(jobs, deps.now());
      deps.onUpdate(jobs);
      scheduleLinger();
    }, delay);
  };

  const apply = (event: JobsEvent) => {
    loaded = true;
    jobs = pruneLingering(applyEvent(jobs, event), deps.now());
    deps.onUpdate(jobs);
    scheduleLinger();
  };

  const scheduleFallback = () => {
    cancel(fallbackTimer);
    fallbackTimer = null;
    const delay = fallbackDelay({
      visible,
      active: [...jobs.values()].some(isActive),
    });
    if (delay == null) return;
    fallbackTimer = deps.setTimeout(() => void pollFallback(), delay);
  };

  const pollFallback = async () => {
    const readEpoch = epoch;
    try {
      const rows = await deps.fetchJobs();
      // A stream reconnected while this read was in flight: its own events
      // are now the source of truth, so this stale read is dropped rather
      // than overwriting whatever the stream has since reported.
      if (readEpoch !== epoch) return;
      apply({ type: "snapshot", jobs: rows });
    } catch {
      // The next scheduled read tries again; one miss shows nothing new.
    } finally {
      if (running && readEpoch === epoch) scheduleFallback();
    }
  };

  const scheduleRetry = () => {
    cancel(retryTimer);
    retryTimer = null;
    if (!visible) return;
    retryTimer = deps.setTimeout(openStream, STREAM_RETRY_MS);
  };

  const onError = () => {
    source?.close();
    source = null;
    scheduleFallback();
    scheduleRetry();
  };

  function openStream() {
    if (!running || !visible) return;
    epoch += 1;
    // The new attempt either sends a snapshot or errors, and `onError` starts
    // the fallback again, so a read queued for the old attempt has no place.
    cancel(fallbackTimer);
    fallbackTimer = null;
    source?.close();
    const next = deps.createEventSource();
    next.addEventListener("snapshot", (event) => {
      cancel(fallbackTimer);
      fallbackTimer = null;
      cancel(retryTimer);
      retryTimer = null;
      apply({ type: "snapshot", jobs: JSON.parse(event.data as string) });
    });
    next.addEventListener("job", (event) => {
      apply({ type: "job", job: JSON.parse(event.data as string) });
    });
    next.addEventListener("error", onError);
    source = next;
  }

  return {
    /** Opens the stream. A no-op once already started. */
    start() {
      if (running) return;
      running = true;
      openStream();
    },
    /** Closes everything: the stream and every pending timer. */
    stop() {
      running = false;
      epoch += 1;
      source?.close();
      source = null;
      cancel(fallbackTimer);
      cancel(retryTimer);
      cancel(lingerTimer);
    },
    /** Whether a real read — a stream event or a fallback fetch — has ever
     *  landed. A subscriber that arrives before this is true has nothing to
     *  read yet: the empty map on screen is a placeholder, not a read that
     *  found nothing. */
    hasLoaded() {
      return loaded;
    },
    /** Closes the stream and its fallback while hidden; reopens it on show,
     *  which brings a fresh snapshot that catches up on anything missed. */
    setVisible(next: boolean) {
      if (visible === next) return;
      visible = next;
      if (!running) return;
      if (next) {
        openStream();
      } else {
        source?.close();
        source = null;
        cancel(fallbackTimer);
        fallbackTimer = null;
        cancel(retryTimer);
        retryTimer = null;
      }
    },
    /** Drops rows the server will not announce leaving — a cleared failed
     *  job is a delete, not a status change, so no event follows it. */
    remove(ids: readonly number[]) {
      if (ids.length === 0) return;
      const next = new Map(jobs);
      for (const id of ids) next.delete(id);
      jobs = next;
      deps.onUpdate(jobs);
    },
  };
}
