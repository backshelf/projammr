import { describe, expect, it } from "bun:test";
import { pluralizeCount } from "./format";

describe("pluralizeCount", () => {
  it("keeps the noun singular for exactly one", () => {
    expect(pluralizeCount(1, "track")).toBe("1 track");
  });

  it("adds an s for none and for many", () => {
    expect(pluralizeCount(0, "track")).toBe("0 tracks");
    expect(pluralizeCount(12, "track")).toBe("12 tracks");
  });
});
