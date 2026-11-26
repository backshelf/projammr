import { describe, expect, it } from "bun:test";

import { LOUDNESS_UNIT_COPY } from "./loudness-unit-copy";

describe("LOUDNESS_UNIT_COPY", () => {
  it("has an explanation for every unit LoudnessUnit can render", () => {
    for (const unit of ["LUFS", "TP", "M", "S"] as const) {
      expect(LOUDNESS_UNIT_COPY[unit].length).toBeGreaterThan(0);
    }
  });

  it("never repeats an explanation across units", () => {
    const explanations = Object.values(LOUDNESS_UNIT_COPY);
    expect(new Set(explanations).size).toBe(explanations.length);
  });

  it("names the window each live reading averages over", () => {
    expect(LOUDNESS_UNIT_COPY.M).toContain("0.4 seconds");
    expect(LOUDNESS_UNIT_COPY.S).toContain("3 seconds");
  });
});
