import {
  SPECTRUM_LAYOUT,
  spectrumBandCentres,
  type Spectrum,
} from "./spectrum";

/**
 * The ISO 1/3-octave centre frequencies the Lab's match EQ reports gains on —
 * the standard 31-band set from 20 Hz to 20 kHz.
 */
export const MATCH_EQ_BANDS = [
  20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630,
  800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500,
  16000, 20000,
] as const;

/** The match never pushes a band harder than this in either direction. */
export const MATCH_EQ_MAX_DB = 12;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/** The 1/10-octave layout bands whose centre falls within a third of an
 *  octave either side of `hz`, or its single nearest band if none do — every
 *  ISO centre this layout's density serves always finds at least one. */
function bandsNear(centres: readonly number[], hz: number): number[] {
  const THIRD_OCTAVE = Math.pow(2, 1 / 6);
  const lo = hz / THIRD_OCTAVE;
  const hi = hz * THIRD_OCTAVE;
  const within = centres.reduce<number[]>((indices, centre, i) => {
    if (centre >= lo && centre <= hi) indices.push(i);
    return indices;
  }, []);
  if (within.length > 0) return within;

  let nearest = 0;
  let nearestDistance = Infinity;
  centres.forEach((centre, i) => {
    const distance = Math.abs(Math.log(centre / hz));
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = i;
    }
  });
  return [nearest];
}

/**
 * The 31-band match-EQ curve that brings `mine` toward `reference`'s tone:
 * the two curves' difference, smoothed from `SPECTRUM_LAYOUT`'s 1/10-octave
 * bands to a third of an octave by averaging the bands under each ISO centre,
 * with the mean removed (so the match changes shape rather than level) and
 * clamped to ±{@link MATCH_EQ_MAX_DB} dB.
 *
 * Both curves carry the layout's frequency tilt equally, so it cancels out of
 * the difference without being undone first.
 */
export function matchEqGains(reference: Spectrum, mine: Spectrum): number[] {
  const centres = spectrumBandCentres(SPECTRUM_LAYOUT);
  const diffs = MATCH_EQ_BANDS.map((hz) => {
    const indices = bandsNear(centres, hz);
    const sum = indices.reduce(
      (total, i) => total + (reference.db[i]! - mine.db[i]!),
      0
    );
    return sum / indices.length;
  });
  const mean = diffs.reduce((total, value) => total + value, 0) / diffs.length;
  return diffs.map((value) =>
    clamp(value - mean, -MATCH_EQ_MAX_DB, MATCH_EQ_MAX_DB)
  );
}
