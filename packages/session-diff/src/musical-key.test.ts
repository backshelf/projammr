import { describe, expect, it } from "bun:test";
import {
  circleOfFifthsPosition,
  keyParts,
  parseMusicalKey,
  spellKey,
  spokeLabel,
} from "./musical-key.js";

describe("keyParts", () => {
  it("splits a key into its tonic and scale exactly as written", () => {
    expect(keyParts("C# Major")).toEqual({ tonic: "C#", scale: "Major" });
    expect(keyParts("F♯ minor")).toEqual({ tonic: "F♯", scale: "minor" });
    expect(keyParts("D Harmonic Minor")).toEqual({
      tonic: "D",
      scale: "Harmonic Minor",
    });
  });

  it("reads a lone tonic, and nothing from an empty string", () => {
    expect(keyParts("E")).toEqual({ tonic: "E", scale: null });
    expect(keyParts("")).toEqual({ tonic: null, scale: null });
  });
});

describe("spellKey", () => {
  it("writes the key as it was written in sharps", () => {
    expect(spellKey("C#", "Major", "sharps")).toBe("C# Major");
    expect(spellKey("F♯", "minor", "sharps")).toBe("F♯ minor");
    expect(spellKey("D", "Dorian", "sharps")).toBe("D Dorian");
  });

  it("keeps whichever half there is, and has nothing for neither", () => {
    expect(spellKey("E", null, "sharps")).toBe("E");
    expect(spellKey(null, "Phrygian", "flats")).toBe("Phrygian");
    expect(spellKey(null, null, "camelot")).toBeNull();
    expect(spellKey("", undefined, "openkey")).toBeNull();
  });

  it("renames a sharp tonic in flats, whichever sharp sign it carries", () => {
    expect(spellKey("C#", "Major", "flats")).toBe("D♭ Major");
    expect(spellKey("A♯", "minor", "flats")).toBe("B♭ minor");
    expect(spellKey("F#", "Lydian", "flats")).toBe("G♭ Lydian");
  });

  it("leaves a tonic with no flat name alone in flats", () => {
    expect(spellKey("C", "Major", "flats")).toBe("C Major");
    expect(spellKey("F", "minor", "flats")).toBe("F minor");
  });

  it("numbers a major key B and a minor key A on the Camelot wheel", () => {
    expect(spellKey("C", "Major", "camelot")).toBe("8B");
    expect(spellKey("A", "minor", "camelot")).toBe("8A");
    expect(spellKey("B", "major", "camelot")).toBe("1B");
    expect(spellKey("C#", "Major", "camelot")).toBe("3B");
    expect(spellKey("F", "Minor", "camelot")).toBe("4A");
    expect(spellKey("F", "Major", "camelot")).toBe("7B");
  });

  it("numbers a major key d and a minor key m in Open Key", () => {
    expect(spellKey("C", "Major", "openkey")).toBe("1d");
    expect(spellKey("A", "Minor", "openkey")).toBe("1m");
    expect(spellKey("F", "major", "openkey")).toBe("12d");
    expect(spellKey("F♯", "minor", "openkey")).toBe("4m");
  });

  it("writes a key the wheel does not carry plainly rather than numbering it", () => {
    expect(spellKey("D", "Dorian", "camelot")).toBe("D Dorian");
    expect(spellKey("C#", null, "openkey")).toBe("C#");
    expect(spellKey("H", "major", "camelot")).toBe("H major");
  });
});

describe("spokeLabel", () => {
  it("labels the major ring's spokes in each notation", () => {
    expect([0, 7].map((i) => spokeLabel(i, "sharps"))).toEqual(["C", "C♯"]);
    expect([0, 7].map((i) => spokeLabel(i, "flats"))).toEqual(["C", "D♭"]);
    expect([0, 7].map((i) => spokeLabel(i, "camelot"))).toEqual(["8B", "3B"]);
    expect([0, 7].map((i) => spokeLabel(i, "openkey"))).toEqual(["1d", "8d"]);
  });
});

describe("parseMusicalKey", () => {
  it("splits a detected key into its tonic and mode", () => {
    expect(parseMusicalKey("F♯ minor")).toEqual({
      tonic: "F♯",
      scale: "minor",
    });
    expect(parseMusicalKey("C major")).toEqual({ tonic: "C", scale: "major" });
  });

  it("reads a session's own spelling of the same key", () => {
    expect(parseMusicalKey("C# Major")).toEqual({
      tonic: "C♯",
      scale: "major",
    });
    expect(parseMusicalKey("C Major")).toEqual({ tonic: "C", scale: "major" });
    expect(parseMusicalKey("A# Minor")).toEqual({
      tonic: "A♯",
      scale: "minor",
    });
  });

  it("rejects a string that carries no recognised mode", () => {
    expect(parseMusicalKey("C")).toBeNull();
    expect(parseMusicalKey("C dorian")).toBeNull();
    expect(parseMusicalKey("")).toBeNull();
  });
});

describe("circleOfFifthsPosition", () => {
  it("places a major key on the outer ring at its own spoke", () => {
    expect(circleOfFifthsPosition({ tonic: "C", scale: "major" })).toEqual({
      index: 0,
      ring: "outer",
    });
    expect(circleOfFifthsPosition({ tonic: "F♯", scale: "major" })).toEqual({
      index: 6,
      ring: "outer",
    });
  });

  it("places a minor key on the inner ring at its relative major's spoke", () => {
    // A minor is the relative minor of C major, so it shares C's spoke.
    expect(circleOfFifthsPosition({ tonic: "A", scale: "minor" })).toEqual({
      index: 0,
      ring: "inner",
    });
    // F♯ minor is the relative minor of A major.
    expect(circleOfFifthsPosition({ tonic: "F♯", scale: "minor" })).toEqual({
      index: 3,
      ring: "inner",
    });
  });

  it("returns null for a tonic the circle does not carry", () => {
    expect(
      circleOfFifthsPosition({ tonic: "H", scale: "major" } as never)
    ).toBeNull();
  });
});
