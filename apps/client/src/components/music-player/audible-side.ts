import type { CompareState } from "@/components/music-player/player-store";
import type { PlayerSide } from "@/lib/dsp/processor-protocol";

/**
 * The side a meter shows as what is heard. A ready comparison reads each
 * source before its chain, so a loudness-matched A/B still shows the two
 * masters' real difference; the live Lab without one reads its output,
 * `"mix"`, since that is what the listener hears; plain playback reads the
 * element's own tap.
 */
export function audibleSide(
  compare: Pick<CompareState, "active" | "phase"> | null,
  labLive: boolean
): PlayerSide {
  if (compare?.phase === "ready") return compare.active;
  return labLive ? "mix" : "a";
}

/** The other source of a ready comparison, drawn faintly behind the audible one. */
export function comparedSide(
  compare: Pick<CompareState, "active" | "phase"> | null
): PlayerSide | null {
  if (compare?.phase !== "ready") return null;
  return compare.active === "a" ? "b" : "a";
}
