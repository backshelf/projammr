import { describe, expect, it } from "bun:test";
import { canonicalCombo, isValidCombo, parseCombo } from "./keymap.js";

describe("canonicalCombo", () => {
  it("names a bare letter by its lowercase character", () => {
    expect(canonicalCombo({ key: "d" })).toBe("d");
  });

  it("names an uppercase letter shift plus its lowercase", () => {
    expect(canonicalCombo({ key: "J", shiftKey: true })).toBe("shift+j");
  });

  it("reads the case from the key value, so Caps Lock J is shift+j too", () => {
    expect(canonicalCombo({ key: "J", shiftKey: false })).toBe("shift+j");
    expect(canonicalCombo({ key: "j", shiftKey: true })).toBe("j");
  });

  it("follows the layout's key value, never the physical key", () => {
    const azertyA = { key: "a", code: "KeyQ" };
    expect(canonicalCombo(azertyA)).toBe("a");
    expect(canonicalCombo({ key: "Ĵ", shiftKey: true })).toBe("shift+ĵ");
  });

  it("names ⌘ and Ctrl alike as mod", () => {
    expect(canonicalCombo({ key: "k", metaKey: true })).toBe("mod+k");
    expect(canonicalCombo({ key: "k", ctrlKey: true })).toBe("mod+k");
  });

  it("folds a letter's case under mod and takes shift from the modifier", () => {
    expect(canonicalCombo({ key: "z", metaKey: true })).toBe("mod+z");
    expect(canonicalCombo({ key: "Z", ctrlKey: true })).toBe("mod+z");
    expect(canonicalCombo({ key: "z", metaKey: true, shiftKey: true })).toBe(
      "mod+shift+z"
    );
  });

  it("names the space bar as space", () => {
    expect(canonicalCombo({ key: " " })).toBe("space");
    expect(canonicalCombo({ key: " ", shiftKey: true })).toBe("space");
  });

  it("reports shift on a named key, which cannot show it any other way", () => {
    expect(canonicalCombo({ key: "ArrowRight", shiftKey: true })).toBe(
      "shift+ArrowRight"
    );
  });

  it("leaves shift off a printable character, which already carries it", () => {
    expect(canonicalCombo({ key: "?", shiftKey: true })).toBe("?");
    expect(canonicalCombo({ key: "<", shiftKey: true })).toBe("<");
    expect(canonicalCombo({ key: "{", shiftKey: true })).toBe("{");
    expect(canonicalCombo({ key: ":", shiftKey: true })).toBe(":");
  });

  it("orders modifiers mod, shift, alt", () => {
    expect(
      canonicalCombo({
        key: "Enter",
        metaKey: true,
        shiftKey: true,
        altKey: true,
      })
    ).toBe("mod+shift+alt+Enter");
  });

  it("names the arrows, Enter and Escape by the browser's key names", () => {
    expect(canonicalCombo({ key: "ArrowDown" })).toBe("ArrowDown");
    expect(canonicalCombo({ key: "Enter" })).toBe("Enter");
    expect(canonicalCombo({ key: "Escape" })).toBe("Escape");
    expect(canonicalCombo({ key: "F5" })).toBe("F5");
  });

  it("skips a bare modifier and a key the grammar cannot name", () => {
    expect(canonicalCombo({ key: "Shift", shiftKey: true })).toBeNull();
    expect(canonicalCombo({ key: "Meta", metaKey: true })).toBeNull();
    expect(canonicalCombo({ key: "CapsLock" })).toBeNull();
    expect(canonicalCombo({ key: "Dead" })).toBeNull();
    expect(canonicalCombo({ key: "Process" })).toBeNull();
    expect(canonicalCombo({ key: "AudioVolumeUp" })).toBeNull();
  });

  it("names every key it reports in a form parseCombo gives back unchanged", () => {
    const events = [
      { key: "j" },
      { key: "J" },
      { key: "?" },
      { key: "+" },
      { key: "+", metaKey: true },
      { key: "ArrowUp", shiftKey: true },
      { key: "k", metaKey: true, shiftKey: true, altKey: true },
      { key: "∆", altKey: true },
      { key: " ", ctrlKey: true },
      { key: "5" },
    ];

    for (const event of events) {
      const combo = canonicalCombo(event);
      expect(combo).not.toBeNull();
      expect(parseCombo(combo ?? "")).toBe(combo);
    }
  });
});

describe("parseCombo", () => {
  it("keeps a canonical combo as it is", () => {
    for (const combo of [
      "j",
      "shift+j",
      "mod+k",
      "space",
      "?",
      "g t",
      "mod+shift+alt+Enter",
      "shift+ArrowRight",
      "5",
    ]) {
      expect(parseCombo(combo)).toBe(combo);
    }
  });

  it("reads the catalogue's spelling of named keys as the browser's", () => {
    expect(parseCombo("down")).toBe("ArrowDown");
    expect(parseCombo("up")).toBe("ArrowUp");
    expect(parseCombo("left")).toBe("ArrowLeft");
    expect(parseCombo("right")).toBe("ArrowRight");
    expect(parseCombo("enter")).toBe("Enter");
    expect(parseCombo("escape")).toBe("Escape");
    expect(parseCombo("SPACE")).toBe("space");
    expect(parseCombo("pagedown")).toBe("PageDown");
    expect(parseCombo("f12")).toBe("F12");
  });

  it("reads an uppercase letter as shift plus its lowercase", () => {
    expect(parseCombo("J")).toBe("shift+j");
    expect(parseCombo("shift+J")).toBe("shift+j");
    expect(parseCombo("g G")).toBe("g shift+g");
  });

  it("puts modifiers in canonical order, whatever order they come in", () => {
    expect(parseCombo("alt+shift+mod+Enter")).toBe("mod+shift+alt+Enter");
    expect(parseCombo("Shift+Mod+k")).toBe("mod+shift+k");
  });

  it("reads the plus key on its own and under a modifier", () => {
    expect(parseCombo("+")).toBe("+");
    expect(parseCombo("mod++")).toBe("mod++");
  });

  it("allows a chord of two presses opening on a bare letter", () => {
    expect(parseCombo("g g")).toBe("g g");
    expect(parseCombo("  n   t ")).toBe("n t");
    expect(parseCombo("g ArrowDown")).toBe("g ArrowDown");
  });

  it("refuses a chord that opens on anything but a bare a to z", () => {
    expect(parseCombo("G t")).toBeNull();
    expect(parseCombo("mod+g t")).toBeNull();
    expect(parseCombo("5 j")).toBeNull();
    expect(parseCombo("ArrowDown j")).toBeNull();
  });

  it("refuses a chord of three presses", () => {
    expect(parseCombo("g t t")).toBeNull();
  });

  it("refuses a shift the browser would already have applied", () => {
    expect(parseCombo("shift+1")).toBeNull();
    expect(parseCombo("shift+?")).toBeNull();
    expect(parseCombo("shift+space")).toBeNull();
  });

  it("refuses empty text, a lone modifier, unknown names and repeats", () => {
    expect(parseCombo("")).toBeNull();
    expect(parseCombo("   ")).toBeNull();
    expect(parseCombo("mod")).toBeNull();
    expect(parseCombo("mod+")).toBeNull();
    expect(parseCombo("ctrl+k")).toBeNull();
    expect(parseCombo("banana")).toBeNull();
    expect(parseCombo("mod+mod+k")).toBeNull();
    expect(parseCombo("Shift")).toBeNull();
  });
});

describe("isValidCombo", () => {
  it("accepts what parseCombo reads and refuses what it does not", () => {
    expect(isValidCombo("mod+k")).toBe(true);
    expect(isValidCombo("down")).toBe(true);
    expect(isValidCombo("g t")).toBe(true);
    expect(isValidCombo("g t t")).toBe(false);
    expect(isValidCombo("shift+1")).toBe(false);
  });
});
