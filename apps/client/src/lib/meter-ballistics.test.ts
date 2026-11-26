import { describe, expect, it } from "bun:test";

import {
  follow,
  holdPeak,
  meterFraction,
  meterStep,
  roomEnergy,
} from "./meter-ballistics";

const BALLISTICS = { attackMs: 10, releaseMs: 300 };

describe("follow", () => {
  it("rises faster than it falls", () => {
    const risen = follow(0, 1, 16, BALLISTICS);
    const fallen = 1 - follow(1, 0, 16, BALLISTICS);
    expect(risen).toBeGreaterThan(fallen);
  });

  it("holds still when no time has passed", () => {
    expect(follow(0.3, 1, 0, BALLISTICS)).toBe(0.3);
  });

  it("converges on the target", () => {
    expect(follow(0, 1, 5000, BALLISTICS)).toBeCloseTo(1, 5);
  });
});

describe("meterStep", () => {
  it("eases toward the target normally", () => {
    expect(meterStep(0, 1, 16, BALLISTICS, false)).toBe(
      follow(0, 1, 16, BALLISTICS)
    );
  });

  it("jumps straight to the target under reduced motion, rather than staying put", () => {
    expect(meterStep(0, 1, 16, BALLISTICS, true)).toBe(1);
    expect(meterStep(0.7, 0, 16, BALLISTICS, true)).toBe(0);
  });
});

describe("holdPeak", () => {
  const OPTIONS = { holdMs: 1000, fallPerSecond: 10 };

  it("jumps to a new high and restarts the hold", () => {
    expect(holdPeak({ value: -10, heldMs: 900 }, -5, 16, OPTIONS)).toEqual({
      value: -5,
      heldMs: 0,
    });
  });

  it("stays put inside the hold", () => {
    expect(holdPeak({ value: -5, heldMs: 0 }, -20, 500, OPTIONS).value).toBe(
      -5
    );
  });

  it("falls once the hold runs out, but never below the reading", () => {
    const falling = holdPeak({ value: -5, heldMs: 1000 }, -20, 100, OPTIONS);
    expect(falling.value).toBeCloseTo(-6, 5);
    expect(
      holdPeak({ value: -5, heldMs: 5000 }, -5.5, 1000, OPTIONS).value
    ).toBe(-5.5);
  });
});

describe("meterFraction", () => {
  it("maps the −28…0 LUFS ruler onto 0…1 and clamps outside it", () => {
    expect(meterFraction(-14)).toBe(0.5);
    expect(meterFraction(-40)).toBe(0);
    expect(meterFraction(3)).toBe(1);
    expect(meterFraction(-Infinity)).toBe(0);
  });
});

describe("roomEnergy", () => {
  it("is dark in silence and near full on a loud hit", () => {
    expect(roomEnergy(-Infinity, -Infinity)).toBe(0);
    expect(roomEnergy(-4, -9)).toBeGreaterThan(0.85);
  });

  it("lifts when the momentary level jumps above the passage", () => {
    expect(roomEnergy(-12, -18)).toBeGreaterThan(roomEnergy(-18, -18));
  });
});
