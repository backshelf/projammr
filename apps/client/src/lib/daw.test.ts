import { describe, expect, it } from "bun:test";
import { dawCanReport, isDawId, structureEmptyLabel } from "./daw";

describe("structureEmptyLabel", () => {
  it("reads as added by hand for a manual session", () => {
    expect(
      structureEmptyLabel({
        daw: "manual",
        dawName: "My favourite tracker",
        dawCapabilities: [],
      })
    ).toBe("Sessions added by hand have no structure to show.");
  });

  it("names the DAW when it never reports structure", () => {
    expect(
      structureEmptyLabel({
        daw: "reaper",
        dawName: "REAPER",
        dawCapabilities: ["tempo"],
      })
    ).toBe("REAPER doesn't report tracks and devices.");
  });

  it("falls back to a generic name when a capable-less DAW carries none", () => {
    expect(
      structureEmptyLabel({ daw: "reaper", dawName: null, dawCapabilities: [] })
    ).toBe("This DAW doesn't report tracks and devices.");
  });

  it("points at dit for a DAW that reports structure but has not been tracked", () => {
    expect(
      structureEmptyLabel({
        daw: "ableton",
        dawName: "Ableton Live",
        dawCapabilities: ["structure"],
      })
    ).toBe("Track this session with dit to read its tracks and devices.");
  });
});

describe("dawCanReport", () => {
  it("reads a capability off the session's claimed list", () => {
    expect(dawCanReport({ dawCapabilities: ["tempo", "key"] }, "tempo")).toBe(
      true
    );
    expect(dawCanReport({ dawCapabilities: ["tempo", "key"] }, "clips")).toBe(
      false
    );
  });

  it("reports nothing for a session with no claimed capabilities", () => {
    expect(dawCanReport({ dawCapabilities: [] }, "structure")).toBe(false);
  });
});

describe("isDawId", () => {
  it("accepts a lowercase, hyphenated module id", () => {
    expect(isDawId("ableton")).toBe(true);
    expect(isDawId("fl-studio")).toBe(true);
    expect(isDawId("manual")).toBe(true);
  });

  it("rejects anything a hand-edited URL could smuggle in", () => {
    expect(isDawId("Ableton")).toBe(false);
    expect(isDawId("")).toBe(false);
    expect(isDawId("a".repeat(33))).toBe(false);
    expect(isDawId("-ableton")).toBe(false);
  });
});
