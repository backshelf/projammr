import { resampleMean } from "@/components/track-audio/strip-bins";
import { formatTimecode } from "@workspace/ui/lib/format";
import { MAX_BARS } from "@workspace/ui/lib/waveform-bars";

/** Sub-threshold change values below this are suppressed as noise. */
const CHANGE_NOISE_GATE = 0.15;

export type ChangeSummary = {
  changedShare: number;
  loudestChange: { startMs: number; endMs: number } | null;
};

export type ChangeHotspot = {
  startMs: number;
  endMs: number;
  energy: number;
};

/**
 * A stored per-second change map resampled onto the shared bar grid, each
 * bar 0 (unchanged or gated below `CHANGE_NOISE_GATE`) to 1 (fully changed).
 */
export function changeBarFractions(
  change: readonly number[],
  barCount: number = MAX_BARS
): number[] {
  return resampleMean(change, barCount).map((value) => {
    const v = value ?? 0;
    return v < CHANGE_NOISE_GATE ? 0 : v;
  });
}

/**
 * Top 2–3 hotspot regions (`>= CHANGE_NOISE_GATE`), merging 1-second gaps so
 * continuous passages group into clean jump targets ordered chronologically.
 */
export function changeHotspots(
  change: readonly number[],
  maxCount = 3
): ChangeHotspot[] {
  if (change.length === 0 || maxCount <= 0) return [];
  const runs: { start: number; end: number; energy: number }[] = [];
  let start = -1;
  let energy = 0;

  for (let i = 0; i < change.length; i++) {
    const v = change[i] ?? 0;
    if (v >= CHANGE_NOISE_GATE) {
      if (start === -1) {
        start = i;
        energy = v;
      } else {
        energy += v;
      }
    } else if (start !== -1) {
      // Allow a 1-second dip if the next second rises back above the gate.
      const next = change[i + 1] ?? 0;
      if (next >= CHANGE_NOISE_GATE) continue;
      runs.push({ start, end: i, energy });
      start = -1;
      energy = 0;
    }
  }
  if (start !== -1) {
    runs.push({ start, end: change.length, energy });
  }

  return runs
    .sort((a, b) => b.energy - a.energy)
    .slice(0, maxCount)
    .sort((a, b) => a.start - b.start)
    .map((run) => ({
      startMs: run.start * 1000,
      endMs: run.end * 1000,
      energy: run.energy,
    }));
}

export function formatAlignmentBadge(
  aligned: boolean | undefined,
  offsetMs: number | null | undefined
): string | null {
  if (!aligned) return null;
  if (offsetMs == null || Math.abs(offsetMs) < 50) return "aligned";
  const sign = offsetMs > 0 ? "+" : "−";
  return `aligned ${sign}${Math.abs(offsetMs / 1000).toFixed(1)}s`;
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
