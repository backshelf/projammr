import { describe, expect, it } from "bun:test";
import { quietMoreLabel, quietSinceLabel } from "./quiet-copy";

const now = new Date("2026-09-26T12:00:00Z");
const daysAgo = (days: number) =>
  new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

describe("quietSinceLabel", () => {
  it("names exactly the threshold", () => {
    expect(quietSinceLabel(daysAgo(30), now, 30)).toBe("30 days");
  });

  it("floors to whole days", () => {
    expect(quietSinceLabel(daysAgo(41.9), now, 30)).toBe("41 days");
  });

  it("counts long stretches", () => {
    expect(quietSinceLabel(daysAgo(400), now, 30)).toBe("400 days");
  });

  it("never reads below the threshold", () => {
    expect(quietSinceLabel(daysAgo(12), now, 30)).toBe("30 days");
  });

  it("reads one day in the singular", () => {
    expect(quietSinceLabel(daysAgo(0.5), now, 1)).toBe("1 day");
  });

  it("follows a non-default threshold", () => {
    expect(quietSinceLabel(daysAgo(12), now, 7)).toBe("12 days");
    expect(quietSinceLabel(daysAgo(3), now, 7)).toBe("7 days");
    expect(quietSinceLabel(daysAgo(12), now, 60)).toBe("60 days");
  });

  it("accepts the ISO string the client receives", () => {
    expect(quietSinceLabel(daysAgo(41).toISOString(), now, 30)).toBe("41 days");
  });
});

describe("quietMoreLabel", () => {
  it("counts the hidden tracks", () => {
    expect(quietMoreLabel(8, 11)).toBe("and 3 more");
  });

  it("is null when every track is shown", () => {
    expect(quietMoreLabel(8, 8)).toBeNull();
    expect(quietMoreLabel(3, 3)).toBeNull();
  });
});
