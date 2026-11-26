import { describe, expect, test } from "bun:test";

import {
  activeBandIndices,
  bandReadout,
  EQ_FILTER_ITEMS,
  freeBandIndex,
  hzFigure,
  readoutPlacement,
} from "@/components/lab/eq-bands";
import type { EqBand } from "@/lib/dsp/lab-settings";
import { fillToLevelPath } from "@/components/spectrum/spectrum-geometry";

const band = (patch: Partial<EqBand> = {}): EqBand => ({
  kind: "peaking",
  hz: 1000,
  gainDb: 0,
  q: 0.9,
  ...patch,
});

describe("EQ_FILTER_ITEMS", () => {
  test("labels every filter kind, so a Select trigger never prints a raw value", () => {
    expect(EQ_FILTER_ITEMS).toContainEqual({
      value: "highShelf",
      label: "High shelf",
    });
    expect(EQ_FILTER_ITEMS.every((item) => item.label !== item.value)).toBe(
      true
    );
  });
});

describe("activeBandIndices / freeBandIndex", () => {
  test("lists the slots in use and finds the first one off", () => {
    const bands = [
      band(),
      band({ kind: "off" }),
      band(),
      band({ kind: "off" }),
    ];
    expect(activeBandIndices(bands)).toEqual([0, 2]);
    expect(freeBandIndex(bands)).toBe(1);
  });

  test("has no free slot once every band runs", () => {
    expect(freeBandIndex([band(), band()])).toBeNull();
  });
});

describe("bandReadout", () => {
  test("reads frequency, gain and Q", () => {
    expect(bandReadout(band({ hz: 120, gainDb: -3 }))).toBe(
      "120 Hz · −3.0 dB · Q 0.9"
    );
  });

  test("drops the gain for a pass filter, which has none", () => {
    expect(bandReadout(band({ kind: "highPass", hz: 2500 }))).toBe(
      "2.5 kHz · Q 0.9"
    );
  });

  test("keeps kilohertz short", () => {
    expect(hzFigure(12000)).toBe("12 kHz");
    expect(hzFigure(1250)).toBe("1.25 kHz");
  });
});

describe("readoutPlacement", () => {
  test("sits below a boosted handle and above a cut one", () => {
    expect(readoutPlacement({ x: 0.5, y: 0.2 }).vertical).toBe("below");
    expect(readoutPlacement({ x: 0.5, y: 0.8 }).vertical).toBe("above");
  });

  test("stays inside the drawing near either edge", () => {
    expect(readoutPlacement({ x: 0.05, y: 0.5 }).horizontal).toBe("start");
    expect(readoutPlacement({ x: 0.95, y: 0.5 }).horizontal).toBe("end");
    expect(readoutPlacement({ x: 0.5, y: 0.5 }).horizontal).toBe("center");
  });
});

describe("fillToLevelPath", () => {
  test("closes the curve along the level's own line", () => {
    const d = fillToLevelPath([20, 20000], [6, 6], [-12, 12], 0);
    expect(d.endsWith("L1000.0 50.0L0.0 50.0Z")).toBe(true);
  });
});
