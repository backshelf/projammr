import { describe, expect, test } from "bun:test";
import {
  SPECTRUM_LAYOUT,
  SPECTRUM_WINDOW_FALLBACK,
  spectrumBandCentres,
  spectrumEnvelope,
  spectrumWindow,
} from "./spectrum";

describe("spectrumBandCentres", () => {
  test("reports one log-spaced centre per band, from lowHz to highHz", () => {
    const centres = spectrumBandCentres(SPECTRUM_LAYOUT);

    expect(centres).toHaveLength(SPECTRUM_LAYOUT.bands);
    expect(centres[0]).toBe(SPECTRUM_LAYOUT.lowHz);
    expect(centres[centres.length - 1]).toBe(SPECTRUM_LAYOUT.highHz);
    for (let b = 1; b < centres.length; b++) {
      expect(centres[b]!).toBeGreaterThan(centres[b - 1]!);
    }
    const ratio = centres[1]! / centres[0]!;
    for (let b = 2; b < centres.length; b++) {
      expect(centres[b]! / centres[b - 1]!).toBeCloseTo(ratio, 1);
    }
  });
});

describe("spectrumWindow", () => {
  test("rounds the ceiling up to a multiple of 6 with a decibel of headroom", () => {
    expect(spectrumWindow([[-40, -31.2, -50]])).toEqual([-78, -30]);
  });

  test("lifts a ceiling that already sits on a multiple of 6", () => {
    expect(spectrumWindow([[-30]])).toEqual([-72, -24]);
  });

  test("falls back when no curve has a level to anchor on", () => {
    expect(spectrumWindow([])).toEqual(SPECTRUM_WINDOW_FALLBACK);
    expect(spectrumWindow([], [-90, -30])).toEqual([-90, -30]);
  });
});

describe("spectrumEnvelope", () => {
  test("averages in the power domain, not in decibels", () => {
    const envelope = spectrumEnvelope([
      { hz: [1000], db: [0] },
      { hz: [1000], db: [-20] },
    ])!;

    expect(envelope.mean).toEqual([-3]);
  });

  test("reports the quietest and loudest curve per band", () => {
    const envelope = spectrumEnvelope([
      { hz: [100, 1000], db: [-40, -10] },
      { hz: [100, 1000], db: [-30, -25] },
      { hz: [100, 1000], db: [-35, -18] },
    ])!;

    expect(envelope.hz).toEqual([100, 1000]);
    expect(envelope.min).toEqual([-40, -25]);
    expect(envelope.max).toEqual([-30, -10]);
  });

  test("skips a curve measured on a different band count", () => {
    const envelope = spectrumEnvelope([
      { hz: [1000], db: [0] },
      { hz: [500, 1000], db: [-60, -60] },
    ])!;

    expect(envelope.mean).toEqual([0]);
    expect(envelope.min).toEqual([0]);
  });

  test("has no envelope without a curve", () => {
    expect(spectrumEnvelope([])).toBeNull();
  });
});
