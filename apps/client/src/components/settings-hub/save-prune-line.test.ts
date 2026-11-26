import { describe, expect, it } from "bun:test";
import { savePruneLine } from "./save-prune-line";

const format = {
  relative: (value: string | number | Date) => `at ${String(value)}`,
  bytes: (value: number) => `${value} B`,
};

describe("savePruneLine", () => {
  it("says so before the first run", () => {
    expect(savePruneLine(null, format)).toBe("Not pruned yet");
  });

  it("names the time and what was freed after a run", () => {
    expect(
      savePruneLine(
        { finishedAt: "2026-10-20T01:00:00Z", status: "done", bytesFreed: 412 },
        format
      )
    ).toBe("Last pruned at 2026-10-20T01:00:00Z · 412 B freed");
  });

  it("names a failed run without a figure", () => {
    expect(
      savePruneLine(
        { finishedAt: "2026-10-20T01:00:00Z", status: "failed", bytesFreed: 0 },
        format
      )
    ).toBe("Last prune failed at 2026-10-20T01:00:00Z");
  });
});
