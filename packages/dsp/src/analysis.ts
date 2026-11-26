/**
 * The typed wrapper over one `Analysis` session (`analysis_*` in
 * `rust/src/lib.rs`): one interleaved stream, fed once, read back as
 * whichever of peaks, BS.1770 loudness and the long-term average spectrum
 * `flags` named. The server's `analyseTrackAudio`
 * (`apps/server/src/db/queries/track-audios.ts`) is one session per decode,
 * fed by `decodeInto` (`apps/server/src/lib/media.ts`).
 */

import type { Dsp } from "./runtime.js";
import {
  type Spectrum,
  type SpectrumLayout,
  SPECTRUM_LAYOUT,
  spectrumBandCentres,
} from "./spectrum.js";

/** One magnitude per 50 ms of playing time, mono, the extreme sample's magnitude, 0..1. */
export const ANALYSIS_PEAKS = 1 << 0;
/** BS.1770 integrated loudness, loudness range and true peak. */
export const ANALYSIS_LOUDNESS = 1 << 1;
/** The long-term average spectrum on `SPECTRUM_LAYOUT` (or the layout passed to the session). */
export const ANALYSIS_SPECTRUM = 1 << 2;
/** The live readouts `takeLoudness`/`takeSpectrum` poll, once per hop. */
export const ANALYSIS_LIVE = 1 << 3;

export type Loudness = {
  /** Integrated loudness in LUFS; `-Infinity` for silence. */
  lufs: number;
  /** Loudness range in LU. */
  lra: number;
  /** `20·log10(max true peak)` in dBTP; `-Infinity` for silence. */
  truePeakDb: number;
};

/** Momentary LUFS, short-term LUFS and sample peak (dBFS) for one closed 10 ms hop. */
export type LoudnessHop = {
  momentary: number;
  shortTerm: number;
  peak: number;
};

/**
 * One `Analysis` session on `dsp`, at `sampleRate` Hz and `channels`
 * channels, running the analysers `flags` named. `layout` is the band table
 * a spectrum flag measures on; `SPECTRUM_LAYOUT` stays the single source of
 * what a stored curve means, so pass it only to measure on another layout.
 */
export class AnalysisSession {
  readonly dsp: Dsp;
  /** The `analysis_*` handle, for the companion readers in `offline.ts`. */
  readonly handle: number;
  private readonly channels: number;
  private readonly sampleRate: number;
  private readonly layout: SpectrumLayout;
  private freed = false;

  constructor(
    dsp: Dsp,
    sampleRate: number,
    channels: number,
    flags: number,
    layout: SpectrumLayout = SPECTRUM_LAYOUT
  ) {
    this.dsp = dsp;
    this.sampleRate = sampleRate;
    this.channels = channels;
    this.layout = layout;
    this.handle = dsp.nonZero(
      dsp.exports.analysis_new(sampleRate, channels, flags),
      "analysis_new"
    );
    if (flags & ANALYSIS_SPECTRUM) {
      dsp.check(
        dsp.exports.analysis_spectrum_layout(
          this.handle,
          layout.bands,
          layout.lowHz,
          layout.highHz,
          layout.fftSize,
          layout.tiltDbPerOctave,
          layout.floorDb
        ),
        "analysis_spectrum_layout"
      );
    }
  }

  /** Feeds one chunk of interleaved samples (`frames × channels` values). */
  push(interleaved: Float32Array): void {
    const frames = interleaved.length / this.channels;
    if (!Number.isInteger(frames)) {
      throw new RangeError(
        `${interleaved.length} samples is not a multiple of ${this.channels} channels`
      );
    }
    this.dsp.withF32(interleaved.length, (view, ptr) => {
      view.set(interleaved);
      this.dsp.check(
        this.dsp.exports.analysis_push(this.handle, ptr, frames),
        "analysis_push"
      );
    });
  }

  /**
   * Flushes the peaks analyser's trailing partial bin and computes the
   * offline analyses the flags named (`offline.ts`); `spectrum` needs no
   * flush, it is always current.
   */
  finish(): void {
    this.dsp.check(
      this.dsp.exports.analysis_finish(this.handle),
      "analysis_finish"
    );
  }

  /** Frames received so far. */
  get frames(): bigint {
    return this.dsp.exports.analysis_frames(this.handle);
  }

  /** Playing time in milliseconds, rounded. */
  get durationMs(): number {
    return Math.round((Number(this.frames) / this.sampleRate) * 1000);
  }

  /** One magnitude per 50 ms, 0..1; empty without the peaks flag. */
  get peaks(): number[] {
    const ptr = this.dsp.exports.analysis_peaks_ptr(this.handle);
    const len = this.dsp.exports.analysis_peaks_len(this.handle);
    return Array.from(this.dsp.readF32(ptr, len));
  }

  /** Integrated loudness, range and true peak; `-Infinity`/`0` without the loudness flag. */
  get loudness(): Loudness {
    return {
      lufs: this.dsp.exports.analysis_lufs(this.handle),
      lra: this.dsp.exports.analysis_lra(this.handle),
      truePeakDb: this.dsp.exports.analysis_true_peak_db(this.handle),
    };
  }

  /**
   * The long-term average spectrum on `layout`, recomputed fresh from every
   * window fed so far on every read; `null` before the first full window, or
   * without the spectrum flag.
   */
  get spectrum(): Spectrum | null {
    const ptr = this.dsp.exports.analysis_spectrum_ptr(this.handle);
    const len = this.dsp.exports.analysis_spectrum_len(this.handle);
    if (len === 0) return null;
    return {
      hz: spectrumBandCentres(this.layout),
      db: Array.from(this.dsp.readF32(ptr, len)),
    };
  }

  /**
   * The newest closed 10 ms hop's live loudness, or `null` when none has
   * closed since the last call. Requires the live flag.
   */
  takeLoudness(): LoudnessHop | null {
    const ptr = this.dsp.exports.analysis_take_loudness(this.handle);
    if (ptr === 0) return null;
    const [momentary, shortTerm, peak] = this.dsp.readF32(ptr, 3);
    return { momentary: momentary!, shortTerm: shortTerm!, peak: peak! };
  }

  /**
   * The newest spectrum window's band levels, or `null` when none has
   * closed since the last call. Requires both the live and spectrum flags.
   */
  takeSpectrum(): Float32Array | null {
    const ptr = this.dsp.exports.analysis_take_spectrum(this.handle);
    if (ptr === 0) return null;
    return this.dsp.readF32(ptr, this.layout.bands);
  }

  /** Closes the session; the handle is unusable after this. */
  free(): void {
    if (this.freed) return;
    this.freed = true;
    this.dsp.check(
      this.dsp.exports.analysis_free(this.handle),
      "analysis_free"
    );
  }
}
