import { describe, expect, it } from "bun:test";
import {
  formatLufs,
  formatSignedDecimal,
  formatTruePeak,
  loudnessMeasuredLabel,
} from "./loudness";

describe("formatSignedDecimal", () => {
  it("rounds to one decimal place", () => {
    expect(formatSignedDecimal(-12.34)).toBe("−12.3");
    expect(formatSignedDecimal(1.26)).toBe("+1.3");
    expect(formatSignedDecimal(-9)).toBe("−9.0");
  });

  it("uses a typographic minus, not a hyphen", () => {
    expect(formatSignedDecimal(-1)).not.toContain("-");
  });

  it("drops the sign on a value that rounds to zero", () => {
    expect(formatSignedDecimal(0.04)).toBe("0.0");
    expect(formatSignedDecimal(-0.04)).toBe("0.0");
  });
});

describe("formatLufs", () => {
  it("reads as a negative figure with no plus on a positive one", () => {
    expect(formatLufs(-12.3)).toBe("−12.3");
    expect(formatLufs(0.5)).toBe("0.5");
  });
});

describe("formatTruePeak", () => {
  it("prefixes TP and carries an explicit sign", () => {
    expect(formatTruePeak(1.2)).toBe("TP +1.2 dB");
    expect(formatTruePeak(-3.04)).toBe("TP −3.0 dB");
  });
});

describe("loudnessMeasuredLabel", () => {
  it("counts only tracks with audio, not the collection's full track count", () => {
    // A three-track collection where only one track has audio: `total` is
    // that one track, not three, so the label never reads as if the
    // collection itself had only one track.
    expect(loudnessMeasuredLabel(1, 1)).toBe("1 measured");
  });

  it("reads as measured, not as a track count, once every track with audio is measured", () => {
    expect(loudnessMeasuredLabel(3, 3)).toBe("3 measured");
  });

  it("shows the total still pending while analysis is incomplete", () => {
    expect(loudnessMeasuredLabel(1, 3)).toBe("1 of 3 measured");
  });
});
