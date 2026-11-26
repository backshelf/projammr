import { describe, expect, it } from "bun:test";
import { resampleMean } from "./strip-bins";

describe("resampleMean", () => {
  it("averages each bucket's values", () => {
    expect(resampleMean([0, 2, 4, 6], 2)).toEqual([1, 5]);
  });

  it("ignores null seconds within a bucket rather than treating them as zero", () => {
    expect(resampleMean([0, null, 4, 6], 2)).toEqual([0, 5]);
  });

  it("returns null for a bucket whose every second is null", () => {
    expect(resampleMean([null, null], 2)).toEqual([null, null]);
  });

  it("returns an empty series for an empty input", () => {
    expect(resampleMean([], 4)).toEqual([]);
  });
});
