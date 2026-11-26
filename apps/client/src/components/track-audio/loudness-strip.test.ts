import { describe, expect, it } from "bun:test";
import { DEFAULT_VISUALS } from "@/lib/policies/visuals";
import {
  loudnessStripFractions,
  loudnessStripReference,
} from "./loudness-strip";

describe("loudnessStripFractions", () => {
  it("maps the ruler's floor and ceiling to 0 and 1", () => {
    expect(loudnessStripFractions([-28, 0], 2)).toEqual([0, 1]);
  });

  it("maps the midpoint to one half", () => {
    expect(loudnessStripFractions([-14], 1)).toEqual([0.5]);
  });

  it("carries a bucket with no reading through as null", () => {
    expect(loudnessStripFractions([null, null], 2)).toEqual([null, null]);
  });
});

describe("loudnessStripReference", () => {
  it("sits at the half-way point for the default −14 LUFS reference", () => {
    expect(loudnessStripReference(DEFAULT_VISUALS.loudnessReferenceLufs)).toBe(
      0.5
    );
  });

  it("follows the visuals policy's reference", () => {
    expect(loudnessStripReference(-7)).toBe(0.75);
  });
});
