/**
 * Live meters for the audio thread, backed by one `AnalysisSession` per
 * meter (flag bit 3). Both expose the same `process`/`take` shape, so
 * wiring one into a host is a call-site change, not a redesign.
 */

import {
  ANALYSIS_LIVE,
  ANALYSIS_SPECTRUM,
  AnalysisSession,
  type LoudnessHop,
} from "./analysis.js";
import type { Dsp } from "./runtime.js";
import { SPECTRUM_LAYOUT, type SpectrumLayout } from "./spectrum.js";

export type LiveLoudnessMeter = {
  /** Feeds one render quantum, one `Float32Array` per channel. */
  process: (channels: Float32Array[]) => void;
  /** The newest closed 10 ms hop, or `null` since the last call closed none. */
  take: () => LoudnessHop | null;
  /** Closes the underlying session; the meter is unusable after this. */
  free: () => void;
};

/**
 * A momentary/short-term LUFS and sample-peak meter for the audio thread,
 * its arithmetic run once in Rust.
 *
 * Opens the live flag alone: the readout only ever calls `takeLoudness`,
 * which is `LiveReadouts`' own short-term meter (bit 3), independent of the
 * integrated-loudness flag. Adding that flag here would run its 4× true-peak
 * resampler and unbounded gating history on the audio thread for a figure
 * nothing reads.
 */
export function createLiveLoudnessMeter(
  dsp: Dsp,
  sampleRate: number,
  channels: number
): LiveLoudnessMeter {
  const session = new AnalysisSession(dsp, sampleRate, channels, ANALYSIS_LIVE);
  return {
    process(frames) {
      session.push(interleave(frames, channels));
    },
    take() {
      return session.takeLoudness();
    },
    free() {
      session.free();
    },
  };
}

export type LiveSpectrumMeter = {
  /** Feeds one render quantum, one `Float32Array` per channel. */
  process: (channels: Float32Array[]) => void;
  /** The newest window's band levels, once per hop; `null` until one lands. */
  take: () => Float32Array | null;
  /** Closes the underlying session; the meter is unusable after this. */
  free: () => void;
};

/**
 * A long-term average spectrum meter for the audio thread, its arithmetic
 * run once in Rust.
 */
export function createLiveSpectrumMeter(
  dsp: Dsp,
  sampleRate: number,
  channels: number,
  layout: SpectrumLayout = SPECTRUM_LAYOUT
): LiveSpectrumMeter {
  const session = new AnalysisSession(
    dsp,
    sampleRate,
    channels,
    ANALYSIS_SPECTRUM | ANALYSIS_LIVE,
    layout
  );
  return {
    process(frames) {
      session.push(interleave(frames, channels));
    },
    take() {
      return session.takeSpectrum();
    },
    free() {
      session.free();
    },
  };
}

/** Interleaves planar render-quantum channels the way every session expects. */
function interleave(channels: Float32Array[], count: number): Float32Array {
  if (count === 0) return new Float32Array(0);
  const length = channels[0]?.length ?? 0;
  const out = new Float32Array(length * count);
  for (let i = 0; i < length; i++) {
    for (let c = 0; c < count; c++) {
      out[i * count + c] = channels[c]?.[i] ?? 0;
    }
  }
  return out;
}
