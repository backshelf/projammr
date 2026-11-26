/** The band layout every spectrum in the product is measured on. Changing it
 *  changes what a stored curve means, so bump `ANALYSIS_VERSION` alongside it. */
export type SpectrumLayout = {
  bands: number;
  lowHz: number;
  highHz: number;
  fftSize: number;
  tiltDbPerOctave: number;
  /** Levels below this read as this, so silence is a number, not −Infinity. */
  floorDb: number;
};

export const SPECTRUM_LAYOUT: SpectrumLayout = {
  /** A tenth of an octave over ten octaves. */
  bands: 96,
  lowHz: 20,
  highHz: 20000,
  /** 5.9 Hz bins at 48 kHz: bands below 80 Hz resolve to their nearest bin. */
  fftSize: 8192,
  tiltDbPerOctave: 4.5,
  floorDb: -120,
};

/** A curve: band centres in Hz and the tilted level per band in dB. */
export type Spectrum = { hz: number[]; db: number[] };

/** The centres a stored spectrum curve reports, for a reader that has a live
 *  frame but no stored row to take them from. */
export function spectrumBandCentres(layout: SpectrumLayout): number[] {
  const ratio = Math.pow(layout.highHz / layout.lowHz, 1 / (layout.bands - 1));
  return Array.from(
    { length: layout.bands },
    (_, b) => Math.round(layout.lowHz * Math.pow(ratio, b) * 10) / 10
  );
}

export const SPECTRUM_WINDOW_DB = 48;
const WINDOW_STEP_DB = 6;
/** What a block draws when it has no curve to anchor on: where a master's tilted levels usually sit. */
export const SPECTRUM_WINDOW_FALLBACK: [number, number] = [-66, -18];

/**
 * The dB window a block draws every one of `curves` on: 48 dB down from the
 * loudest point, with at least 1 dB of headroom, the top rounded up to a
 * multiple of 6 so the window only moves when a curve is added.
 */
export function spectrumWindow(
  curves: readonly ArrayLike<number>[],
  fallback: [number, number] = SPECTRUM_WINDOW_FALLBACK
): [number, number] {
  let top = -Infinity;
  for (const curve of curves) {
    for (let i = 0; i < curve.length; i++) if (curve[i]! > top) top = curve[i]!;
  }
  if (!Number.isFinite(top)) return fallback;
  const ceiling = Math.ceil((top + 1) / WINDOW_STEP_DB) * WINDOW_STEP_DB;
  return [ceiling - SPECTRUM_WINDOW_DB, ceiling];
}

export type SpectrumEnvelope = {
  hz: number[];
  /** Power-domain mean per band, in dB. */
  mean: number[];
  min: number[];
  max: number[];
};

/**
 * The envelope of several curves on one layout. Averaging happens in the
 * power domain — a dB mean is a geometric mean of power, which lets one loud
 * outlier vanish — and converts once at the end. Curves whose band count
 * differs from the first are ignored: they were measured on another layout.
 */
export function spectrumEnvelope(
  curves: readonly Spectrum[]
): SpectrumEnvelope | null {
  const head = curves[0];
  if (!head) return null;
  const same = curves.filter((curve) => curve.db.length === head.hz.length);
  const bands = head.hz.length;
  const mean = new Array<number>(bands);
  const min = new Array<number>(bands);
  const max = new Array<number>(bands);
  for (let b = 0; b < bands; b++) {
    let power = 0;
    let lo = Infinity;
    let hi = -Infinity;
    for (const curve of same) {
      const db = curve.db[b]!;
      power += Math.pow(10, db / 10);
      if (db < lo) lo = db;
      if (db > hi) hi = db;
    }
    mean[b] = Math.round(10 * Math.log10(power / same.length) * 10) / 10;
    min[b] = lo;
    max[b] = hi;
  }
  return { hz: [...head.hz], mean, min, max };
}
