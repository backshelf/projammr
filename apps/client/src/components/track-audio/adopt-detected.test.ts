import { describe, expect, it } from "bun:test";
import { adoptKeyPatches, adoptTempoPatch } from "./adopt-detected";

describe("adoptKeyPatches", () => {
  it("splits a detected key into a rootNote and a scale patch on the main session", () => {
    expect(adoptKeyPatches(42, "F♯ minor")).toEqual([
      {
        entityType: "session",
        entityId: 42,
        fieldName: "rootNote",
        value: "F♯",
      },
      {
        entityType: "session",
        entityId: 42,
        fieldName: "scale",
        value: "minor",
      },
    ]);
  });

  it("returns null for a key string with no recognisable mode", () => {
    expect(adoptKeyPatches(42, "F♯")).toBeNull();
  });
});

describe("adoptTempoPatch", () => {
  it("writes the detected tempo as a string, matching the session's own field", () => {
    expect(adoptTempoPatch(42, 128.4)).toEqual({
      entityType: "session",
      entityId: 42,
      fieldName: "tempo",
      value: "128.4",
    });
  });
});
