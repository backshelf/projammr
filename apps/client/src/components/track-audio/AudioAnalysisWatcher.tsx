"use client";

import { useJobsDrain, useJobsFinish } from "@/components/jobs/JobsProvider";
import { ANALYSIS_KINDS } from "@/components/track-audio/analysis-kinds";
import { useRouter } from "next/navigation";

/**
 * Refreshes the page once the project's audio analysis has drained, and with
 * `eachJob`, also whenever one analysis job finishes.
 *
 * Duration, peaks, loudness, spectrum, detected key and tempo and the
 * spectrogram image are measured in a job outside the request that queued
 * it, so a page rendered mid-analysis learns its figures are final by
 * watching the queue. `useJobsDrain` counts a first read that finds nothing,
 * because a short job can finish before it. `router.refresh` keeps this
 * component mounted, so a figure that can never be measured costs one refresh
 * rather than a loop.
 *
 * A drain can wait on a project backfill long after the one version a track
 * page shows is done, so that page passes `eachJob`. A collection page, whose
 * figures span every track, keeps to one refresh per drain rather than one
 * per job.
 *
 * Mount it only while the server says a figure is still incomplete.
 */
export function AudioAnalysisWatcher({
  eachJob = false,
}: {
  eachJob?: boolean;
}) {
  const router = useRouter();
  useJobsDrain(ANALYSIS_KINDS, () => router.refresh());
  useJobsFinish(ANALYSIS_KINDS, () => {
    if (eachJob) router.refresh();
  });
  return null;
}
