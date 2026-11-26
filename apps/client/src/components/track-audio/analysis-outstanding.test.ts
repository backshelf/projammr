import { describe, expect, it } from "bun:test";
import { ANALYSIS_VERSION } from "@workspace/dsp/version";
import { analysisOutstanding } from "./analysis-outstanding";

describe("analysisOutstanding", () => {
  it("is true for a version that has never been analysed", () => {
    expect(analysisOutstanding({ analysisVersion: null })).toBe(true);
  });

  it("is true for a version analysed under an older ANALYSIS_VERSION", () => {
    expect(analysisOutstanding({ analysisVersion: ANALYSIS_VERSION - 1 })).toBe(
      true
    );
  });

  it("is false for a version already analysed under the current ANALYSIS_VERSION", () => {
    expect(analysisOutstanding({ analysisVersion: ANALYSIS_VERSION })).toBe(
      false
    );
  });
});
