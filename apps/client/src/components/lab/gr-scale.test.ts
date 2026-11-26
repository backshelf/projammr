import { describe, expect, it } from "bun:test";

import { GR_RULER, grFraction, grLabel } from "@/components/lab/gr-scale";
import { positionOf } from "@workspace/ui/lib/ruler-scale";

describe("grFraction", () => {
  it("rests at zero with no reduction", () => {
    expect(grFraction(0)).toBe(0);
  });

  it("travels with the chain's reduction, which reads in positive dB", () => {
    expect(grFraction(6)).toBeCloseTo(0.25);
    expect(grFraction(12)).toBeCloseTo(0.5);
  });

  it("pins at full travel past the floor", () => {
    expect(grFraction(40)).toBe(1);
  });

  it("rests at zero on a reading the chain could not take", () => {
    expect(grFraction(Number.NaN)).toBe(0);
  });

  it("travels as far from the ruler's 0 dB end as the cut sits on the ruler", () => {
    const cut = 6;
    const fromRight = 100 - positionOf(-cut, GR_RULER.min, GR_RULER.max);
    expect(grFraction(cut) * 100).toBeCloseTo(fromRight);
  });
});

describe("grLabel", () => {
  it("shows a reduction as a cut in dB, with the loudness figures' minus", () => {
    expect(grLabel(4.5)).toBe("−4.5 dB");
  });

  it("shows zero below a tenth of a dB", () => {
    expect(grLabel(0)).toBe("0.0 dB");
    expect(grLabel(0.04)).toBe("0.0 dB");
    expect(grLabel(Number.NaN)).toBe("0.0 dB");
  });
});

describe("GR_RULER", () => {
  it("runs from the deepest cut the bar shows up to no reduction", () => {
    expect(GR_RULER.min).toBe(-24);
    expect(GR_RULER.max).toBe(0);
    expect(GR_RULER.format(-12)).toBe("−12");
    expect(GR_RULER.format(0)).toBe("0");
  });
});
