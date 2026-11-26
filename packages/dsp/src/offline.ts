/**
 * The offline analyses: flag bits 4 to 12 of an `AnalysisSession`, computed
 * by its `finish()` because each needs the whole file, read back through
 * `OfflineAnalyses`; and the comparison of two versions from their stored
 * feature buffers (`FeatureSet`, `alignFeatures`, `diffFeatures`), which
 * needs no decode. `rust/src/analysis/offline/` holds the maths.
 */

import type { AnalysisSession } from "./analysis.js";
import type { Dsp } from "./runtime.js";

/** The onset envelope, per-second log-mel means and chroma fingerprint, quantised. */
export const ANALYSIS_FEATURES = 1 << 4;
/** BPM, the first beat and a confidence. */
export const ANALYSIS_TEMPO = 1 << 5;
/** The musical key and a confidence. */
export const ANALYSIS_KEY = 1 << 6;
/** Sections with repeat groups. */
export const ANALYSIS_SECTIONS = 1 << 7;
/** The 128-band spectrogram tile, one column per 100 ms. */
export const ANALYSIS_SPECTROGRAM = 1 << 8;
/** Short-term loudness and L/R correlation per second. */
export const ANALYSIS_CURVES = 1 << 9;
/** Clipped 50 ms bins. */
export const ANALYSIS_CLIPPING = 1 << 10;
/** Leading and trailing silence. */
export const ANALYSIS_SILENCE = 1 << 11;
/** The dominant pitch per 50 ms. */
export const ANALYSIS_PITCH = 1 << 12;
/** Every offline analysis. */
export const ANALYSIS_OFFLINE =
  ANALYSIS_FEATURES |
  ANALYSIS_TEMPO |
  ANALYSIS_KEY |
  ANALYSIS_SECTIONS |
  ANALYSIS_SPECTROGRAM |
  ANALYSIS_CURVES |
  ANALYSIS_CLIPPING |
  ANALYSIS_SILENCE |
  ANALYSIS_PITCH;

/** Onset strengths per second in the stored envelope. */
export const ONSET_RATE_HZ = 100;
export const MEL_BANDS = 40;
export const CHROMA_BINS = 12;
export const SPECTROGRAM_BANDS = 128;
/** Milliseconds per spectrogram column. */
export const SPECTROGRAM_COLUMN_MS = 100;

const PITCH_CLASSES = [
  "C",
  "C♯",
  "D",
  "D♯",
  "E",
  "F",
  "F♯",
  "G",
  "G♯",
  "A",
  "A♯",
  "B",
] as const;

/** The stored series, numbered as the `analysis_feature_*` and `offline_features_set` exports number them. */
const SERIES = { onset: 0, mel: 1, chroma: 2 } as const;
type SeriesName = keyof typeof SERIES;

export type Tempo = {
  /** One decimal. */
  bpm: number;
  /** The first beat of the grid, `0 ≤ beatOffsetMs < 60000 / bpm`. */
  beatOffsetMs: number;
  /** 0..1. */
  bpmConfidence: number;
};

export type MusicalKey = {
  /** `"F♯ minor"`, sharps throughout. */
  musicalKey: string;
  /** 0..1, the winner's margin over the runner-up. */
  keyConfidence: number;
};

export type Section = {
  startMs: number;
  endMs: number;
  /** `"A"`, `"B"`, …, in order of first appearance; repeats share a letter. */
  group: string;
};

export type Spectrogram = {
  columns: number;
  /** Column-major: `SPECTROGRAM_BANDS` bytes per column, lowest band first, 0 = −90 dBFS, 255 = 0 dBFS. */
  bytes: Uint8Array;
};

export type ClippedBin = {
  /** Index of the 50 ms bin, as the peaks count them. */
  binIndex: number;
  /** Frames in runs of at least three at full scale. */
  samples: number;
  /** The bin's true peak passed 0 dBTP. */
  over: boolean;
};

export type Silence = { leadMs: number; tailMs: number };

/** One series quantised to bytes over `[min, max]` (byte 0 and byte 255). */
export type QuantisedSeries = { bytes: Uint8Array; min: number; max: number };

export type Features = {
  /** Onset strength at `ONSET_RATE_HZ`. */
  onset: QuantisedSeries;
  /** `MEL_BANDS` log-mel means per second. */
  mel: QuantisedSeries;
  /** `CHROMA_BINS` chroma values per second: the fingerprint. */
  chroma: QuantisedSeries;
};

export type Diff = {
  /** Per second of the first version, 0..1; 1 where the second has no counterpart. */
  change: number[];
  /** Per second, LU; empty unless both sets carried a loudness curve. */
  loudnessDelta: number[];
  summary: {
    /** Seconds changed more than 0.15. */
    changedSeconds: number;
    changedShare: number;
    /** The longest run of seconds changed more than 0.3. */
    loudestChange: { startMs: number; endMs: number } | null;
  };
  /**
   * Mean cosine of the aligned chroma fingerprints (two silent seconds count
   * as 1), or `null` without both.
   */
  fingerprintSimilarity: number | null;
};

/** `"A"`…`"Z"`, then `"AA"`, `"AB"`, … */
export function sectionGroupLetter(index: number): string {
  let letters = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  }
  return letters;
}

/**
 * An `f32` the module rounded to `places` decimals, as that decimal:
 * `-6.1` arrives as `-6.099999904632568`.
 */
function decimal(value: number, places: number): number {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

/** A gated second's `-Infinity` as `null`, so a curve serialises to JSON. */
function lufsOrNull(value: number): number | null {
  return Number.isFinite(value) ? decimal(value, 1) : null;
}

function triples(values: Float32Array): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i + 2 < values.length; i += 3) {
    out.push([values[i]!, values[i + 1]!, values[i + 2]!]);
  }
  return out;
}

/**
 * Typed getters over the offline results of one `AnalysisSession`, valid
 * after its `finish()`. A getter whose flag the session was not opened with
 * reads `null` or empty.
 */
export class OfflineAnalyses {
  private readonly dsp: Dsp;
  private readonly handle: number;

  constructor(session: AnalysisSession) {
    this.dsp = session.dsp;
    this.handle = session.handle;
  }

  get tempo(): Tempo | null {
    const ptr = this.dsp.exports.analysis_tempo(this.handle);
    if (ptr === 0) return null;
    const [bpm, beatOffsetMs, bpmConfidence] = this.dsp.readF32(ptr, 3);
    return {
      bpm: decimal(bpm!, 1),
      beatOffsetMs: beatOffsetMs!,
      bpmConfidence: decimal(bpmConfidence!, 2),
    };
  }

  get key(): MusicalKey | null {
    const ptr = this.dsp.exports.analysis_key(this.handle);
    if (ptr === 0) return null;
    const [tonic, minor, keyConfidence] = this.dsp.readF32(ptr, 3);
    return {
      musicalKey: `${PITCH_CLASSES[tonic!]} ${minor ? "minor" : "major"}`,
      keyConfidence: decimal(keyConfidence!, 2),
    };
  }

  get sections(): Section[] {
    return triples(
      this.f32(
        this.dsp.exports.analysis_sections_ptr,
        this.dsp.exports.analysis_sections_len
      )
    ).map(([startMs, endMs, group]) => ({
      startMs,
      endMs,
      group: sectionGroupLetter(group),
    }));
  }

  get spectrogram(): Spectrogram {
    const len = this.dsp.exports.analysis_spectrogram_len(this.handle);
    const bytes = this.dsp.readU8(
      this.dsp.exports.analysis_spectrogram_ptr(this.handle),
      len
    );
    return { columns: len / SPECTROGRAM_BANDS, bytes };
  }

  /** Short-term LUFS per second, one decimal, `null` where gated. */
  get loudnessCurve(): (number | null)[] {
    return Array.from(
      this.f32(
        this.dsp.exports.analysis_loudness_curve_ptr,
        this.dsp.exports.analysis_loudness_curve_len
      ),
      lufsOrNull
    );
  }

  /** L/R correlation per second, −1..1, two decimals. */
  get correlationCurve(): number[] {
    return Array.from(
      this.f32(
        this.dsp.exports.analysis_correlation_curve_ptr,
        this.dsp.exports.analysis_correlation_curve_len
      ),
      (value) => decimal(value, 2)
    );
  }

  get clipping(): ClippedBin[] {
    return triples(
      this.f32(
        this.dsp.exports.analysis_clipping_ptr,
        this.dsp.exports.analysis_clipping_len
      )
    ).map(([binIndex, samples, over]) => ({
      binIndex,
      samples,
      over: over === 1,
    }));
  }

  get silence(): Silence | null {
    const ptr = this.dsp.exports.analysis_silence(this.handle);
    if (ptr === 0) return null;
    const [leadMs, tailMs] = this.dsp.readF32(ptr, 2);
    return { leadMs: leadMs!, tailMs: tailMs! };
  }

  /** Hz per 50 ms, one decimal, 0 where unvoiced. */
  get pitchTrack(): number[] {
    return Array.from(
      this.f32(
        this.dsp.exports.analysis_pitch_track_ptr,
        this.dsp.exports.analysis_pitch_track_len
      ),
      (hz) => decimal(hz, 1)
    );
  }

  /** The stored feature buffers, or `null` without the features flag. */
  get features(): Features | null {
    const read = (name: SeriesName): QuantisedSeries | null => {
      const series = SERIES[name];
      const { exports } = this.dsp;
      const len = exports.analysis_feature_len(this.handle, series);
      const dataPtr = exports.analysis_feature_ptr(this.handle, series);
      const rangePtr = exports.analysis_feature_range(this.handle, series);
      if (len === 0 || dataPtr === 0 || rangePtr === 0) return null;
      const bytes = this.dsp.readU8(dataPtr, len);
      const [min, max] = this.dsp.readF32(rangePtr, 2);
      return { bytes, min: min!, max: max! };
    };
    const onset = read("onset");
    if (!onset) return null;
    const mel = read("mel");
    const chroma = read("chroma");
    if (!mel || !chroma) return null;
    return { onset, mel, chroma };
  }

  private f32(
    ptr: (handle: number) => number,
    len: (handle: number) => number
  ): Float32Array {
    const length = len(this.handle);
    return this.dsp.readF32(ptr(this.handle), length);
  }
}

/**
 * One version's stored features loaded back into the module, for
 * `alignFeatures` and `diffFeatures`. `loudnessCurve` (the version's
 * short-term LUFS per second) is what the loudness delta reads.
 */
export class FeatureSet {
  readonly dsp: Dsp;
  readonly handle: number;
  private freed = false;

  constructor(
    dsp: Dsp,
    features: Features,
    loudnessCurve?: readonly (number | null)[]
  ) {
    this.dsp = dsp;
    this.handle = dsp.nonZero(
      dsp.exports.offline_features_new(),
      "offline_features_new"
    );
    try {
      for (const name of Object.keys(SERIES) as SeriesName[]) {
        const { bytes, min, max } = features[name];
        dsp.withU8(bytes.length, (view, ptr) => {
          view.set(bytes);
          dsp.check(
            dsp.exports.offline_features_set(
              this.handle,
              SERIES[name],
              ptr,
              bytes.length,
              min,
              max
            ),
            "offline_features_set"
          );
        });
      }
      if (loudnessCurve) {
        dsp.withF32(loudnessCurve.length, (view, ptr) => {
          view.set(loudnessCurve.map((lufs) => lufs ?? -Infinity));
          dsp.check(
            dsp.exports.offline_features_set_loudness(
              this.handle,
              ptr,
              loudnessCurve.length
            ),
            "offline_features_set_loudness"
          );
        });
      }
    } catch (error) {
      this.free();
      throw error;
    }
  }

  /** Releases the set; the handle is unusable after this. */
  free(): void {
    if (this.freed) return;
    this.freed = true;
    this.dsp.check(
      this.dsp.exports.offline_features_free(this.handle),
      "offline_features_free"
    );
  }
}

/**
 * The offset in ms at which `b` best matches `a` by their onset envelopes
 * (positive when `b` plays the same material later), or `null` when nothing
 * within ±30 s correlates well enough to call them aligned.
 */
export function alignFeatures(a: FeatureSet, b: FeatureSet): number | null {
  if (a.dsp !== b.dsp) {
    throw new RangeError(
      "alignFeatures requires both FeatureSets to belong to the same Dsp instance"
    );
  }
  const offset = a.dsp.exports.offline_align(a.handle, b.handle);
  return offset === -(2 ** 31) ? null : offset;
}

/** Compares `a` with `b` placed `offsetMs` later, per second of `a`. */
export function diffFeatures(
  a: FeatureSet,
  b: FeatureSet,
  offsetMs: number
): Diff {
  if (a.dsp !== b.dsp) {
    throw new RangeError(
      "diffFeatures requires both FeatureSets to belong to the same Dsp instance"
    );
  }
  const { dsp } = a;
  const { exports } = dsp;
  const handle = dsp.nonZero(
    exports.offline_diff_new(a.handle, b.handle, offsetMs),
    "offline_diff_new"
  );
  try {
    const changeLen = exports.offline_diff_change_len(handle);
    const changePtr = exports.offline_diff_change_ptr(handle);
    const change =
      changeLen === 0 || changePtr === 0
        ? []
        : Array.from(dsp.readF32(changePtr, changeLen), (value) =>
            decimal(value, 2)
          );
    const loudnessLen = exports.offline_diff_loudness_len(handle);
    const loudnessPtr = exports.offline_diff_loudness_ptr(handle);
    const loudnessDelta =
      loudnessLen === 0 || loudnessPtr === 0
        ? []
        : Array.from(dsp.readF32(loudnessPtr, loudnessLen), (lu) =>
            decimal(lu, 1)
          );
    const summaryPtr = dsp.nonZero(
      exports.offline_diff_summary(handle),
      "offline_diff_summary"
    );
    const [changedSeconds, changedShare, startMs, endMs, similarity] =
      dsp.readF32(summaryPtr, 5);
    return {
      change,
      loudnessDelta,
      summary: {
        changedSeconds: changedSeconds!,
        changedShare: decimal(changedShare!, 2),
        loudestChange:
          startMs! < 0 ? null : { startMs: startMs!, endMs: endMs! },
      },
      fingerprintSimilarity: Number.isNaN(similarity!)
        ? null
        : decimal(similarity!, 3),
    };
  } finally {
    dsp.check(exports.offline_diff_free(handle), "offline_diff_free");
  }
}
