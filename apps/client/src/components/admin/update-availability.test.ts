import { describe, expect, it } from "bun:test";
import { updateAvailability } from "./update-availability";

describe("updateAvailability", () => {
  it("is absent when the instance has turned the update check off", () => {
    expect(updateAvailability(false, "0.0.1", "v0.0.2")).toEqual({
      checked: false,
    });
  });

  it("is absent when no release tag was reachable", () => {
    expect(updateAvailability(true, "0.0.1", null)).toEqual({
      checked: true,
      available: false,
    });
  });

  it("reports nothing new when the latest tag matches the running version", () => {
    expect(updateAvailability(true, "0.0.1", "v0.0.1")).toEqual({
      checked: true,
      available: false,
    });
  });

  it("reports the latest tag once it differs from the running version", () => {
    expect(updateAvailability(true, "0.0.1", "v0.0.2")).toEqual({
      checked: true,
      available: true,
      latest: "v0.0.2",
    });
  });
});
