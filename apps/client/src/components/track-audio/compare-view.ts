/**
 * The A/B comparison's derived view state, framework-free so it is testable
 * under `bun test`'s no-DOM environment: what the compare controls show in
 * each phase, what they announce, and the props the change strip under the
 * waveforms takes.
 */

import type { CompareState } from "@/components/music-player/player-store";
import type { ChangeSummary } from "@/components/track-audio/change-strip";

/** What the compare controls render in place of the A·B pill. */
export type CompareControlsView =
  | { kind: "preparing"; label: string; percent: number; line: string }
  | { kind: "ready" }
  | { kind: "unavailable"; line: string };

const PREPARING_LABEL = "Preparing comparison";

/**
 * The controls' state for a comparison against version `bVersion`, e.g.
 * "Preparing comparison · v4 62%" while both sources are prepared.
 */
export function compareControlsView(
  compare: Pick<CompareState, "phase" | "reason">,
  bVersion: number | undefined,
  fraction: number
): CompareControlsView {
  switch (compare.phase) {
    case "preparing": {
      const percent = Math.max(0, Math.min(100, Math.round(fraction * 100)));
      const version = bVersion == null ? "" : ` · v${bVersion}`;
      return {
        kind: "preparing",
        label: PREPARING_LABEL,
        percent,
        line: `${PREPARING_LABEL}${version} ${percent}%`,
      };
    }
    case "unavailable":
      return {
        kind: "unavailable",
        line: compare.reason ?? "The comparison could not start here",
      };
    case "ready":
      return { kind: "ready" };
  }
}

/**
 * What a screen reader hears as the comparison moves through its phases:
 * once per phase, never per percent.
 */
export function compareAnnouncement(
  compare: Pick<CompareState, "phase" | "reason">
): string {
  switch (compare.phase) {
    case "preparing":
      return PREPARING_LABEL;
    case "ready":
      return "Comparison ready";
    case "unavailable":
      return `Comparison unavailable: ${compare.reason ?? "it could not start here"}`;
  }
}

/** Whether both versions carry a loudness figure to match on. */
export const loudnessMatchable = (
  lufsA: number | null | undefined,
  lufsB: number | null | undefined
) => lufsA != null && lufsB != null;

/**
 * What an unmatched comparison says in place of the match toggle: there is
 * no gain stage to even the two versions out, so the label names which side
 * is louder and by how much instead, from each version's stored LUFS. Only
 * the bare label when either version has none.
 */
export function unmatchedCompareLine(
  lufsA: number | null | undefined,
  lufsB: number | null | undefined
): string {
  if (lufsA == null || lufsB == null) return "Levels not matched";
  const delta = lufsB - lufsA;
  const louder = delta >= 0 ? "B" : "A";
  return `Levels not matched · ${louder} is +${Math.abs(delta).toFixed(1)} LU`;
}

/** The accessible name of each side of the A·B pill. */
export const hearSideLabel = (side: "a" | "b", version: number | undefined) =>
  `Hear ${side.toUpperCase()}, v${version ?? "?"}`;

export type CompareStripProps = {
  label: string;
  vsVersion: number | null;
  aligned: boolean;
  offsetMs: number | null;
  change: readonly number[];
  loudnessDelta: readonly number[];
  summary: ChangeSummary;
};

/**
 * The change strip's props under the two waveforms, or null while the pair
 * has no diff: the change map runs per second of the A side, so it shares
 * A's waveform geometry.
 */
export function compareStripProps(
  compare: Pick<CompareState, "diff" | "b"> | null
): CompareStripProps | null {
  const diff = compare?.diff;
  if (!diff || diff.change.length === 0) return null;
  const version = compare.b.trackAudio?.version ?? null;
  return {
    label: "Change",
    vsVersion: version,
    aligned: diff.aligned,
    offsetMs: diff.offsetMs,
    change: diff.change,
    loudnessDelta: diff.loudnessDelta,
    summary: diff.summary,
  };
}
