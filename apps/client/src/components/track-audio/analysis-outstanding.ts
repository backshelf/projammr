import { ANALYSIS_VERSION } from "@workspace/dsp/version";

/**
 * Whether a version's stored analysis (loudness, spectrum, detected key and
 * tempo, …) still needs a decode: never analysed, or analysed under an
 * `analysisVersion` the server has since moved past. Mirrors the server's own
 * `isOutstandingAnalysis` (`db/queries/track-audios.ts`), the rule a decode
 * job uses to pick up a stale row.
 *
 * A version can already carry loudness while this is true — an older decode
 * measured it before a newer `ANALYSIS_VERSION` added, say, detected key —
 * so callers that only want to know "is anything still due" should read this
 * rather than a single measured field.
 */
export function analysisOutstanding(audio: {
  analysisVersion: number | null;
}): boolean {
  return (
    audio.analysisVersion == null || audio.analysisVersion < ANALYSIS_VERSION
  );
}
