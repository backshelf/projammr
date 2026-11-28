import { describe, expect, it } from "bun:test";
import {
  changeBarFractions,
  changeHotspots,
  changeSummaryLine,
  formatAlignmentBadge,
} from "./change-strip";

describe("changeBarFractions", () => {
  it("averages the per-second change map into each bar", () => {
    expect(changeBarFractions([0, 1], 2)).toEqual([0, 1]);
  });

  it("suppresses sub-threshold noise below 0.15", () => {
    expect(changeBarFractions([0.05, 0.14, 0.15, 0.6], 4)).toEqual([
      0, 0, 0.15, 0.6,
    ]);
  });

  it("treats a bucket with no seconds as unchanged", () => {
    expect(changeBarFractions([], 2)).toEqual([]);
  });
});

describe("changeHotspots", () => {
  it("extracts up to 3 top hotspot stretches ordered chronologically", () => {
    const change = [
      0, 0.4, 0.5, 0, 0, 0, 0.2, 0, 0, 0, 0.8, 0.9, 0.7, 0, 0, 0.6, 0.6,
    ];
    const spots = changeHotspots(change, 3);
    expect(spots).toHaveLength(3);
    expect(spots.map((s) => [s.startMs, s.endMs])).toEqual([
      [1000, 3000],
      [10_000, 13_000],
      [15_000, 17_000],
    ]);
  });
});

describe("formatAlignmentBadge", () => {
  it("formats alignment offsets cleanly", () => {
    expect(formatAlignmentBadge(false, 1200)).toBeNull();
    expect(formatAlignmentBadge(true, 0)).toBe("aligned");
    expect(formatAlignmentBadge(true, 1200)).toBe("aligned +1.2s");
    expect(formatAlignmentBadge(true, -500)).toBe("aligned −0.5s");
  });
});

describe("changeSummaryLine", () => {
  it("formats the changed share and the loudest stretch", () => {
    expect(
      changeSummaryLine({
        changedShare: 0.381,
        loudestChange: { startMs: 92_000, endMs: 130_000 },
      })
    ).toBe("38% changed · most in 1:32–2:10");
  });

  it("omits the range when nothing stands out", () => {
    expect(changeSummaryLine({ changedShare: 0, loudestChange: null })).toBe(
      "0% changed"
    );
  });
});
