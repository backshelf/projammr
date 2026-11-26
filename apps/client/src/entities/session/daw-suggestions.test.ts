import { describe, expect, it } from "bun:test";
import { dawSuggestions } from "@/entities/session/daw-suggestions";

describe("dawSuggestions", () => {
  it("offers each distinct name once, and no raw id for a DAW with no name", () => {
    expect(
      dawSuggestions([
        { daw: "ableton", dawName: "Ableton Live" },
        { daw: "manual", dawName: "Ableton Live" },
        { daw: "manual", dawName: null },
        { daw: "reaper", dawName: "REAPER" },
      ])
    ).toEqual(["Ableton Live", "REAPER"]);
  });
});
