import type { JobKind } from "@workspace/api/api";

/** The jobs that produce an audio's duration, peaks, loudness and spectrum. */
export const ANALYSIS_KINDS: ReadonlySet<JobKind> = new Set([
  "audio_analysis",
  "audio_backfill",
]);
