import { describe, expect, it } from "bun:test";
import { lastSaveLabel } from "./day-label";

describe("lastSaveLabel", () => {
  it("reads today for zero days since", () => {
    expect(lastSaveLabel(0)).toBe("today");
  });

  it("reads yesterday for one day since", () => {
    expect(lastSaveLabel(1)).toBe("yesterday");
  });

  it("reads a count of days for two or more", () => {
    expect(lastSaveLabel(4)).toBe("4 days ago");
  });
});
