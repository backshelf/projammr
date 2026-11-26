import { describe, expect, test } from "bun:test";
import { SPECTRUM_LAYOUT, spectrumBandCentres } from "./spectrum";
import { MATCH_EQ_BANDS, MATCH_EQ_MAX_DB, matchEqGains } from "./match-eq";

const centres = spectrumBandCentres(SPECTRUM_LAYOUT);
const flat = (db: number) => ({ hz: centres, db: centres.map(() => db) });

describe("matchEqGains", () => {
  test("reports one gain per ISO band", () => {
    expect(matchEqGains(flat(-20), flat(-20))).toHaveLength(
      MATCH_EQ_BANDS.length
    );
  });

  test("is all zero for identical curves", () => {
    const gains = matchEqGains(flat(-18), flat(-18));
    for (const gain of gains) expect(gain).toBeCloseTo(0, 5);
  });

  test("is all zero when both curves sit at a different, but equal, level", () => {
    const gains = matchEqGains(flat(-6), flat(-6));
    for (const gain of gains) expect(gain).toBeCloseTo(0, 5);
  });

  test("preserves a shelf's shape after the mean is removed", () => {
    // The reference is 6 dB louder above 2 kHz than `mine`, which is flat.
    // Mean-removal only recentres the curve, so the gap between the shelf's
    // two halves survives exactly, wherever the mean happens to land it.
    const shelfHz = 2000;
    const reference = {
      hz: centres,
      db: centres.map((hz) => (hz >= shelfHz ? -14 : -20)),
    };
    const gains = matchEqGains(reference, flat(-20));

    const above = MATCH_EQ_BANDS.map((hz, i) =>
      hz >= shelfHz ? gains[i]! : null
    ).filter((v): v is number => v !== null);
    const below = MATCH_EQ_BANDS.map((hz, i) =>
      hz < shelfHz ? gains[i]! : null
    ).filter((v): v is number => v !== null);
    const meanAbove = above.reduce((a, b) => a + b, 0) / above.length;
    const meanBelow = below.reduce((a, b) => a + b, 0) / below.length;

    expect(meanAbove - meanBelow).toBeCloseTo(6, 0);
    const overallMean = gains.reduce((a, b) => a + b, 0) / gains.length;
    expect(overallMean).toBeCloseTo(0, 1);
  });

  test("clamps a uniform difference to zero, since the mean absorbs it", () => {
    // A flat offset is the same at every band, so removing the mean cancels
    // it exactly — this shows the clamp never has to fire for a flat
    // difference, not that it works; see the shelf case below for that.
    const gains = matchEqGains(flat(0), flat(-40));
    for (const gain of gains) expect(gain).toBeCloseTo(0, 5);
  });

  test("clamps a shape whose mean-removed gains exceed the limit", () => {
    // A 60 dB shelf leaves both halves — high and low — well past ±12 dB
    // once the mean is removed, so the clamp actually has to fire on both
    // sides; deleting it would push these gains to roughly +21 and −39.
    const shelfHz = 2000;
    const reference = {
      hz: centres,
      db: centres.map((hz) => (hz >= shelfHz ? 0 : 60)),
    };
    const gains = matchEqGains(reference, flat(0));

    for (const gain of gains) {
      expect(gain).toBeLessThanOrEqual(MATCH_EQ_MAX_DB);
      expect(gain).toBeGreaterThanOrEqual(-MATCH_EQ_MAX_DB);
    }
    expect(Math.max(...gains)).toBeCloseTo(MATCH_EQ_MAX_DB, 5);
    expect(Math.min(...gains)).toBeCloseTo(-MATCH_EQ_MAX_DB, 5);
  });
});
