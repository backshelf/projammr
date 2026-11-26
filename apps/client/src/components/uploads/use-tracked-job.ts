"use client";

import { useJob, useJobsLoaded } from "@/components/jobs/JobsProvider";
import { lingerUntil } from "@/components/jobs/jobs-poll";
import { clientGetJob } from "@/lib/client-api";
import { isActionError } from "@workspace/api/lib/action-result";
import type { Job } from "@workspace/api/api";
import { useEffect, useState } from "react";

/**
 * Whether a tracked job that has never shown up live is worth reading
 * directly: only once the project's map has done its first real read — a job
 * just queued may simply not have reached the stream's first frame yet — and
 * only while nothing has resolved it already. Without this, a job the server
 * handed back already done (a repeat request reusing one whose output still
 * survives) or one whose whole queued-to-done life fell between two fallback
 * polls never appears on the map at all, and a caller keyed on `hasTrackedJob`
 * alone waits on it forever.
 */
export function shouldFetchTrackedJob({
  jobId,
  job,
  hasTrackedJob,
  loaded,
}: {
  jobId: number | undefined;
  job: Job | undefined;
  hasTrackedJob: boolean;
  loaded: boolean;
}): boolean {
  return jobId != null && job == null && !hasTrackedJob && loaded;
}

/**
 * The job a follower shows: the live row whenever the map has one, otherwise
 * what the one direct read found. A finished job from that read leaves after
 * its linger, as the tray's row would, and a failed one stays.
 */
export function presentedTrackedJob({
  liveJob,
  fetchedJob,
  now,
}: {
  liveJob: Job | undefined;
  fetchedJob: Job | undefined;
  now: number;
}): Job | undefined {
  if (liveJob) return liveJob;
  if (!fetchedJob) return undefined;
  const until = lingerUntil(fetchedJob);
  return until != null && until <= now ? undefined : fetchedJob;
}

/**
 * Follows one job across its life. `useJob` alone cannot tell "not queued
 * yet" apart from "already lingered out" — both read as `undefined` — so
 * this also remembers whether the job has ever been seen, reset each time the
 * caller starts following a different id so a stale "already seen" from a
 * previous job cannot mislabel a fresh one that has not shown up yet. When
 * the live map never carries the id at all, one direct read resolves it
 * (`shouldFetchTrackedJob`) instead of waiting on a map update that will
 * never come.
 *
 * `resetKey` restarts that tracking even when `jobId` does not change: a
 * caller whose own request can hand back the very same job id as before (a
 * server that reuses a conversion already done) passes something unique to
 * each request, so a later one always re-checks the job's current status
 * rather than reusing whatever the id last resolved to.
 */
export function useTrackedJob(
  jobId: number | undefined,
  resetKey?: unknown
): {
  job: Job | undefined;
  hasTrackedJob: boolean;
} {
  // `useJob` needs a number; -1 never matches a real job, so a caller with
  // nothing to follow yet still calls the hook unconditionally.
  const liveJob = useJob(jobId ?? -1);
  const loaded = useJobsLoaded();
  const [tracked, setTracked] = useState<{
    jobId: number | undefined;
    resetKey: unknown;
    hasTrackedJob: boolean;
    fetchedJob: Job | undefined;
  }>({ jobId, resetKey, hasTrackedJob: false, fetchedJob: undefined });

  if (tracked.jobId !== jobId || tracked.resetKey !== resetKey) {
    setTracked({
      jobId,
      resetKey,
      hasTrackedJob: liveJob != null,
      fetchedJob: undefined,
    });
  } else if (liveJob && (!tracked.hasTrackedJob || tracked.fetchedJob)) {
    // Once the map carries the job, the direct read is out of date for good.
    setTracked({ jobId, resetKey, hasTrackedJob: true, fetchedJob: undefined });
  }

  useEffect(() => {
    if (
      jobId == null ||
      !shouldFetchTrackedJob({
        jobId,
        job: liveJob,
        hasTrackedJob: tracked.hasTrackedJob,
        loaded,
      })
    ) {
      return;
    }
    let cancelled = false;
    void clientGetJob(jobId).then((result) => {
      if (cancelled) return;
      // A failed read still counts as "seen": a transient network error must
      // not leave the row waiting on a retry that never comes, only on
      // whatever result its next real update (a click, a remount) brings.
      const fetchedJob = isActionError(result) ? undefined : result;
      setTracked((prev) =>
        prev.jobId === jobId && prev.resetKey === resetKey
          ? { jobId, resetKey, hasTrackedJob: true, fetchedJob }
          : prev
      );
    });
    return () => {
      cancelled = true;
    };
  }, [jobId, resetKey, liveJob, tracked.hasTrackedJob, loaded]);

  // Re-renders when a finished job from the direct read lingers out, which
  // no map update will announce.
  const [now, setNow] = useState(() => Date.now());
  const fetchedUntil = tracked.fetchedJob
    ? lingerUntil(tracked.fetchedJob)
    : null;
  useEffect(() => {
    if (fetchedUntil == null) return;
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.max(0, fetchedUntil - Date.now())
    );
    return () => clearTimeout(timer);
  }, [fetchedUntil]);

  return {
    job:
      jobId == null
        ? undefined
        : presentedTrackedJob({
            liveJob,
            fetchedJob: tracked.fetchedJob,
            now,
          }),
    hasTrackedJob: tracked.hasTrackedJob,
  };
}
