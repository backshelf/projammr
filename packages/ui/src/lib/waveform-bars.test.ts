import { describe, expect, it } from "bun:test";
import { barCountFor, bucketOf, peakCeiling, toBars } from "./waveform-bars";

describe("barCountFor", () => {
  it("derives the bar count from the available width", () => {
    expect(barCountFor(316)).toBe(79);
  });

  it("clamps to a minimum of 24 bars on a very narrow wave", () => {
    expect(barCountFor(0)).toBe(24);
    expect(barCountFor(50)).toBe(24);
  });

  it("clamps to a maximum of 160 bars on a wide wave", () => {
    expect(barCountFor(1000)).toBe(160);
    expect(barCountFor(640)).toBe(160);
  });

  it("fits more bars at a narrower pitch and fewer at a wider one", () => {
    expect(barCountFor(316, 2)).toBe(158);
    expect(barCountFor(316, 6)).toBe(52);
  });
});

describe("toBars", () => {
  it("fills a quiet series to the top against its own loudest peak", () => {
    // A −28 LUFS demo never gets near 1; the ceiling must track its own
    // peak, not an absolute floor, or the wave draws nearly flat.
    expect(toBars([0.1, 0.2], 2)).toEqual([0.5, 1]);
  });

  it("draws all-zero peaks without dividing by zero", () => {
    expect(toBars([0, 0, 0], 3)).toEqual([0, 0, 0]);
  });

  it("keeps a -6 dB series at half height against a shared scale", () => {
    const loud = [0.2, 0.8, 0.4, 0.8];
    const quiet = loud.map((peak) => peak * 10 ** (-6 / 20));
    const scale = peakCeiling(loud, quiet);

    const loudBars = toBars(loud, 4, scale);
    const quietBars = toBars(quiet, 4, scale);

    expect(Math.max(...loudBars)).toBeCloseTo(1, 2);
    quietBars.forEach((bar, i) =>
      expect(bar / loudBars[i]!).toBeCloseTo(0.5, 2)
    );
    expect(Math.max(...quietBars)).toBeCloseTo(0.5, 2);
  });
});

describe("bucketOf", () => {
  it("lands a section boundary on the bar its moment falls in", () => {
    // A section at 60-90s of a 180s track lands at bars 53-80 of 160.
    expect(bucketOf(60, 180, 160)).toBe(53);
    expect(bucketOf(90, 180, 160)).toBe(80);
  });

  it("clamps the final instant to the last bar rather than one past it", () => {
    expect(bucketOf(180, 180, 160)).toBe(159);
  });

  it("clamps a moment past the end to the last bar", () => {
    expect(bucketOf(200, 180, 160)).toBe(159);
  });

  it("clamps a negative moment to the first bar", () => {
    expect(bucketOf(-5, 180, 160)).toBe(0);
  });

  it("returns -1 for a duration that is not yet known", () => {
    expect(bucketOf(10, 0, 160)).toBe(-1);
    expect(bucketOf(10, Number.NaN, 160)).toBe(-1);
  });
});

describe("peakCeiling", () => {
  it("scales to the loudest peak across every series", () => {
    expect(peakCeiling([0.2, 0.4], [0.9])).toBe(0.9);
    expect(peakCeiling([3], [], [7, 2])).toBe(7);
  });

  it("returns 1 for an all-zero series so nothing divides by zero", () => {
    expect(peakCeiling([0, 0, 0])).toBe(1);
    expect(peakCeiling([], [])).toBe(1);
  });

  it("shares one ceiling across an A/B compare so both series stay comparable", () => {
    const a = [0.1, 0.2, 0.3];
    const b = [0.05, 0.6, 0.1];
    expect(peakCeiling(a, b)).toBe(0.6);
  });
});
