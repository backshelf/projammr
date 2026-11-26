import { describe, expect, test } from "bun:test";
import {
  matchEqAvailable,
  matchEqReferenceLabel,
  normaliseAvailable,
  pitchFigure,
  preparingCopy,
  showsPitchSlider,
  showsSpeedSlider,
  slidersReady,
  speedFigure,
  unavailableCopy,
} from "./lab-view-model";

describe("preparingCopy", () => {
  test("names the original file and its rounded percentage", () => {
    expect(preparingCopy({ source: "original", fraction: 0.424 })).toEqual({
      label: "Preparing the Lab",
      percent: 42,
      line: "Preparing the Lab · 42%",
    });
  });

  test("names the 320 kbps copy once the size cap routed to it", () => {
    expect(preparingCopy({ source: "copy", fraction: 0 }).label).toBe(
      "Preparing a 320 kbps copy"
    );
  });

  test("clamps a fraction outside 0..1", () => {
    expect(preparingCopy({ source: "original", fraction: 1.4 }).percent).toBe(
      100
    );
    expect(preparingCopy({ source: "original", fraction: -0.2 }).percent).toBe(
      0
    );
  });
});

describe("unavailableCopy", () => {
  test("carries the engine's reason", () => {
    expect(
      unavailableCopy({ reason: "This format cannot be decoded here" })
    ).toBe("This format cannot be decoded here");
  });

  test("falls back to a generic line with no reason", () => {
    expect(unavailableCopy({ reason: null })).toBe(
      "The Lab could not start here"
    );
  });
});

describe("speedFigure", () => {
  test("formats to two decimals with the multiplication sign", () => {
    expect(speedFigure(0.85)).toBe("0.85×");
    expect(speedFigure(1)).toBe("1.00×");
  });
});

describe("pitchFigure", () => {
  test("reads a whole semitone with no decimal", () => {
    expect(pitchFigure(2)).toBe("+2 st");
    expect(pitchFigure(-3)).toBe("−3 st");
  });

  test("reads a fine semitone with one decimal", () => {
    expect(pitchFigure(2.5)).toBe("+2.5 st");
  });

  test("has no sign at zero", () => {
    expect(pitchFigure(0)).toBe("0 st");
  });
});

describe("showsSpeedSlider / showsPitchSlider", () => {
  test("speed only hides pitch, since it stays held", () => {
    expect(showsSpeedSlider("speed")).toBe(true);
    expect(showsPitchSlider("speed")).toBe(false);
  });

  test("pitch only hides speed, since it stays pinned to 1", () => {
    expect(showsSpeedSlider("pitch")).toBe(false);
    expect(showsPitchSlider("pitch")).toBe(true);
  });

  test("linked hides pitch, since it moves with speed rather than on its own", () => {
    expect(showsSpeedSlider("linked")).toBe(true);
    expect(showsPitchSlider("linked")).toBe(false);
  });

  test("independent shows both", () => {
    expect(showsSpeedSlider("independent")).toBe(true);
    expect(showsPitchSlider("independent")).toBe(true);
  });
});

describe("slidersReady", () => {
  test("gives way to the preparing meter and the unavailable copy", () => {
    expect(slidersReady("preparing")).toBe(false);
    expect(slidersReady("unavailable")).toBe(false);
  });

  test("shows once the Lab is live or not engaged at all", () => {
    expect(slidersReady("live")).toBe(true);
    expect(slidersReady("off")).toBe(true);
  });
});

describe("matchEqReferenceLabel", () => {
  test("reads the file's name and its version", () => {
    expect(
      matchEqReferenceLabel({ version: 3, asset: { name: "mix-final.wav" } })
    ).toBe("mix-final.wav · v3");
  });
});

describe("matchEqAvailable", () => {
  test("is false with no reference", () => {
    expect(matchEqAvailable([])).toBe(false);
  });

  test("is true once a reference exists", () => {
    expect(matchEqAvailable([{ audioId: 1, label: "v1" }])).toBe(true);
  });
});

describe("normaliseAvailable", () => {
  test("needs a stored loudness figure", () => {
    expect(normaliseAvailable(null)).toBe(false);
    expect(normaliseAvailable(-14)).toBe(true);
  });
});
