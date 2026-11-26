import { describe, expect, it } from "bun:test";
import type { Status } from "../schema/statuses.js";
import { calculateStatus } from "./statuses.js";

const at = (percentage: number): { status: Status } => ({
  status: { percentage } as Status,
});

describe("calculateStatus", () => {
  it("averages the children's percentages", () => {
    expect(calculateStatus([at(50), at(100)])).toBe(75);
  });

  it("reports a lone child's own percentage", () => {
    expect(calculateStatus([at(37)])).toBe(37);
  });

  it("reports zero for a parent with no children", () => {
    // A collection with no tracks is 0% done, not NaN — the divisor guard is
    // what keeps an empty list from dividing by zero.
    expect(calculateStatus([])).toBe(0);
  });

  it("counts a child with no status as zero rather than skipping it", () => {
    expect(calculateStatus([at(100), { status: null }])).toBe(50);
    expect(calculateStatus([at(100), {}])).toBe(50);
  });

  it("lands between two evenly split groups rather than rounding to one", () => {
    expect(calculateStatus([at(0), at(0), at(100), at(100)])).toBe(50);
    expect(calculateStatus([at(25), at(50)])).toBe(37.5);
  });
});
