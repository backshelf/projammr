/**
 * How the audio is drawn: the loudness reference the meters and strips mark,
 * how the live meters move, the track page's waveform, which analysis strips
 * sit under it, and whether the now-playing field and the room around a
 * playing record move with the sound. The defaults are the drawing as it has
 * always been.
 */

import {
  DEFAULT_STRIP_IDS,
  type StripId,
} from "@/components/track-audio/strip-legend";
import type { WaveSize } from "@workspace/ui/components/waveform";
import { BAR_PITCH } from "@workspace/ui/lib/waveform-bars";

export type VisualsPolicy = {
  /**
   * The level the loudness scales and the loudness strip mark with their
   * dotted reference line, in LUFS. The Lab's normalise target is a setting
   * of its own, which starts at the same level.
   */
  loudnessReferenceLufs: number;
  /**
   * How quickly every live meter follows the audio: its rise and fall times
   * are each meter's own, multiplied by this. 1 is each meter's own feel;
   * below it moves faster, above it slower.
   */
  meterBallistics: number;
  /**
   * The width, in pixels, one bar of the track page's waveform takes; a
   * narrower bar fits more of them, so the wave draws in finer detail.
   */
  waveformDetail: number;
  /** The height of the waveform that leads the track page. */
  waveformHeight: WaveSize;
  /** The analysis strips shown under the track page's waveform. */
  strips: readonly StripId[];
  /** Whether the now-playing view's background moves with the audio. */
  lavaField: boolean;
  /** Whether the artwork around a playing record breathes with its level. */
  artBreathes: boolean;
};

export const DEFAULT_VISUALS: VisualsPolicy = {
  loudnessReferenceLufs: -14,
  meterBallistics: 1,
  waveformDetail: BAR_PITCH,
  waveformHeight: "lg",
  strips: DEFAULT_STRIP_IDS,
  lavaField: true,
  artBreathes: true,
};
