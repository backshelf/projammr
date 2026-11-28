import { describe, expect, it } from "bun:test";
import type { TodayRender } from "./playable";
import { formatVersionRange, groupTodayRenders } from "./render-groups";

const mkRender = (id: number, trackId: number, version: number) =>
  ({
    id,
    trackId,
    version,
    createdAt: "2026-11-28T00:00:00.000Z",
    asset: { name: `v${version}.wav` },
  }) as unknown as TodayRender;

describe("formatVersionRange", () => {
  it("formats single, contiguous, and non-contiguous versions", () => {
    expect(formatVersionRange([2])).toBe("v2");
    expect(formatVersionRange([4, 3])).toBe("v3–v4");
    expect(formatVersionRange([1, 3, 5])).toBe("v1, v3, v5");
  });
});

describe("groupTodayRenders", () => {
  it("groups repeated versions by track and keeps the newest version playable", () => {
    const grouped = groupTodayRenders([
      mkRender(10, 1, 4),
      mkRender(9, 2, 1),
      mkRender(8, 1, 3),
    ]);
    expect(grouped).toHaveLength(2);
    expect(grouped[0]?.latest.id).toBe(10);
    expect(grouped[0]?.versionLabel).toBe("v3–v4");
    expect(grouped[1]?.latest.id).toBe(9);
    expect(grouped[1]?.versionLabel).toBe("v1");
  });
});
