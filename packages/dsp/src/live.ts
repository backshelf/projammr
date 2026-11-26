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
/** Standard AudioWorklet render quantum size in frames. */
const DEFAULT_QUANTUM_FRAMES = 128;

/**
 * Reusable WASM-side interleaved scratch buffer for live AudioWorklet meters.
 * Pre-allocated at construction so steady-state 128-frame quanta incur zero
 * JS or WASM allocations.
 */
class LiveScratch {
  private readonly dsp: Dsp;
  private readonly channels: number;
  private ptr = 0;
  private capacity = 0;
  private view: Float32Array | null = null;
  private buffer: ArrayBuffer | null = null;

  constructor(dsp: Dsp, channels: number) {
    this.dsp = dsp;
    this.channels = channels;
    if (channels > 0) {
      this.ensure(DEFAULT_QUANTUM_FRAMES * channels);
    }
  }

  private ensure(samples: number): Float32Array {
    if (samples > this.capacity) {
      this.release();
      const bytes = samples * Float32Array.BYTES_PER_ELEMENT;
      this.ptr = this.dsp.nonZero(
        this.dsp.exports.dsp_alloc(bytes),
        "dsp_alloc"
      );
      this.capacity = samples;
      this.buffer = null;
    }
    const currentBuffer = this.dsp.exports.memory.buffer;
    if (this.view === null || this.buffer !== currentBuffer) {
      this.buffer = currentBuffer;
      this.view = new Float32Array(currentBuffer, this.ptr, this.capacity);
    }
    return this.view;
  }

  push(session: AnalysisSession, frames: Float32Array[]): void {
    const count = this.channels;
    if (count === 0) return;
    const length = frames[0]?.length ?? 0;
    if (length === 0) return;
    const view = this.ensure(length * count);
    for (let i = 0; i < length; i++) {
      const base = i * count;
      for (let c = 0; c < count; c++) {
        view[base + c] = frames[c]?.[i] ?? 0;
      }
    }
    this.dsp.check(
      this.dsp.exports.analysis_push(session.handle, this.ptr, length),
      "analysis_push"
    );
  }

  release(): void {
    if (this.ptr !== 0) {
      this.dsp.exports.dsp_free(
        this.ptr,
        this.capacity * Float32Array.BYTES_PER_ELEMENT
      );
      this.ptr = 0;
      this.capacity = 0;
      this.view = null;
      this.buffer = null;
    }
  }
}

export function createLiveLoudnessMeter(
  dsp: Dsp,
  sampleRate: number,
  channels: number
): LiveLoudnessMeter {
  const session = new AnalysisSession(dsp, sampleRate, channels, ANALYSIS_LIVE);
  let scratch: LiveScratch;
  try {
    scratch = new LiveScratch(dsp, channels);
  } catch (error) {
    session.free();
    throw error;
  }
  return {
    process(frames) {
      scratch.push(session, frames);
    },
    take() {
      return session.takeLoudness();
    },
    free() {
      try {
        scratch.release();
      } finally {
        session.free();
      }
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
  let scratch: LiveScratch;
  try {
    scratch = new LiveScratch(dsp, channels);
  } catch (error) {
    session.free();
    throw error;
  }
  return {
    process(frames) {
      scratch.push(session, frames);
    },
    take() {
      return session.takeSpectrum();
    },
    free() {
      try {
        scratch.release();
      } finally {
        session.free();
      }
    },
  };
}
