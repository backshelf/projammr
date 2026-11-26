import { describe, expect, it } from "bun:test";
import { changeBarFractions, changeSummaryLine } from "./change-strip";

describe("changeBarFractions", () => {
  it("averages the per-second change map into each bar", () => {
    expect(changeBarFractions([0, 1], 2)).toEqual([0, 1]);
  });

  it("treats a bucket with no seconds as unchanged", () => {
    expect(changeBarFractions([], 2)).toEqual([]);
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
