import { describe, expect, test } from "bun:test";

import { captureShortcut, NEEDS_A_MODIFIER, shortcutCaps } from "./accelerator";

type Press = Parameters<typeof captureShortcut>[0];

function press(code: string, held: Partial<Press> = {}): Press {
  return {
    code,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...held,
  };
}

describe("captureShortcut", () => {
  test("names Alt+Shift+D in the order the app registers", () => {
    expect(
      captureShortcut(press("KeyD", { altKey: true, shiftKey: true }))
    ).toEqual({
      accelerator: "Alt+Shift+D",
    });
  });

  test("orders every modifier Ctrl, Alt, Shift, Super", () => {
    const all = press("Space", {
      metaKey: true,
      shiftKey: true,
      altKey: true,
      ctrlKey: true,
    });

    expect(captureShortcut(all)).toEqual({
      accelerator: "Ctrl+Alt+Shift+Super+Space",
    });
  });

  test.each([
    ["Digit1", "1"],
    ["F5", "F5"],
    ["ArrowUp", "Up"],
    ["Comma", "Comma"],
  ])("names the physical key %s as %s", (code, key) => {
    expect(captureShortcut(press(code, { metaKey: true }))).toEqual({
      accelerator: `Super+${key}`,
    });
  });

  test("refuses a bare letter, and Shift alone, which is only a capital", () => {
    expect(captureShortcut(press("KeyD"))).toEqual({
      refusal: NEEDS_A_MODIFIER,
    });
    expect(captureShortcut(press("KeyD", { shiftKey: true }))).toEqual({
      refusal: NEEDS_A_MODIFIER,
    });
  });

  test("waits while only a modifier, or a key with no name, is down", () => {
    expect(captureShortcut(press("AltLeft", { altKey: true }))).toBeNull();
    expect(captureShortcut(press("Numpad5", { altKey: true }))).toBeNull();
  });
});

describe("shortcutCaps", () => {
  test("prints modifiers as their glyphs and keys as their caps", () => {
    expect(shortcutCaps("Alt+Shift+D")).toEqual(["⌥", "⇧", "D"]);
    expect(shortcutCaps("Ctrl+Super+Up")).toEqual(["⌃", "⌘", "↑"]);
  });
});
