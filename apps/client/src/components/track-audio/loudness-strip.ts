import {
  LOUDNESS_CEILING,
  LOUDNESS_FLOOR,
} from "@workspace/ui/components/loudness/loudness-scale";
import { positionOf } from "@workspace/ui/lib/ruler-scale";
import { resampleMean } from "@/components/track-audio/strip-bins";
import { MAX_BARS } from "@workspace/ui/lib/waveform-bars";

/** Where `lufs` sits on the loudness ruler, 0 (its floor) to 1 (its ceiling). */
const rulerFraction = (lufs: number) =>
  positionOf(lufs, LOUDNESS_FLOOR, LOUDNESS_CEILING) / 100;

/**
 * The short-term loudness curve resampled onto the shared bar grid, each bar
 * as a 0 (the ruler's floor, −28 LUFS) to 1 (its ceiling, 0 LUFS) fraction —
 * the same vocabulary `LoudnessScale`/`RulerScale` draw sideways as ticks.
 * Null where no second in the bucket had a reading (gated below −70 LUFS).
 */
export function loudnessStripFractions(
  curve: readonly (number | null)[],
  barCount: number = MAX_BARS
): (number | null)[] {
  return resampleMean(curve, barCount).map((value) =>
    value == null ? null : rulerFraction(value)
  );
}

/** The loudness reference line, as the same 0..1 fraction the strip's values
 *  are drawn in. */
export const loudnessStripReference = (referenceLufs: number) =>
  rulerFraction(referenceLufs);
