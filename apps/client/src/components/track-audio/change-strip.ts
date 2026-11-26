import { resampleMean } from "@/components/track-audio/strip-bins";
import { formatTimecode } from "@workspace/ui/lib/format";
import { MAX_BARS } from "@workspace/ui/lib/waveform-bars";

export type ChangeSummary = {
  changedShare: number;
  loudestChange: { startMs: number; endMs: number } | null;
};

/**
 * A stored per-second change map resampled onto the shared bar grid, each
 * bar 0 (unchanged) to 1 (fully changed, or past the shorter version's end).
 */
export function changeBarFractions(
  change: readonly number[],
  barCount: number = MAX_BARS
): number[] {
  return resampleMean(change, barCount).map((value) => value ?? 0);
}

/**
 * "38% changed · most in 1:32–2:10" — the summary line under `ChangeStrip`.
 * The range is omitted when nothing in particular stands out (no loudest
 * stretch, or nothing changed at all).
 */
export function changeSummaryLine(summary: ChangeSummary): string {
  const percent = Math.round(summary.changedShare * 100);
  if (!summary.loudestChange) return `${percent}% changed`;
  const { startMs, endMs } = summary.loudestChange;
  return `${percent}% changed · most in ${formatTimecode(startMs)}–${formatTimecode(endMs)}`;
}
