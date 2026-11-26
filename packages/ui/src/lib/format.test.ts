import { describe, expect, it } from "bun:test";

import { formatSeconds, formatTimecode } from "./format";

describe("formatTimecode", () => {
  it("reads milliseconds as minutes and zero-padded seconds", () => {
    expect(formatTimecode(92_000)).toBe("1:32");
    expect(formatTimecode(5_999)).toBe("0:05");
  });

  it("clamps a negative position to the start", () => {
    expect(formatTimecode(-1_000)).toBe("0:00");
  });
});

describe("formatSeconds", () => {
  it("reads seconds on the same clock as formatTimecode", () => {
    expect(formatSeconds(92)).toBe(formatTimecode(92_000));
    expect(formatSeconds(3_600)).toBe("60:00");
  });
});
