import { describe, expect, it } from "bun:test";
import { comboKeys, comboLabel } from "./combo-format";

describe("comboKeys", () => {
  it("splits a plain combo into one chord half of held-together keys", () => {
    expect(comboKeys("mod+k", false)).toEqual([["Ctrl", "K"]]);
    expect(comboKeys("mod+k", true)).toEqual([["⌘", "K"]]);
  });

  it("splits a chord into one array per half", () => {
    expect(comboKeys("g t", false)).toEqual([["G"], ["T"]]);
  });

  it("names a named key rather than uppercasing it", () => {
    expect(comboKeys("shift+ArrowRight", false)).toEqual([["⇧", "→"]]);
  });

  it("uppercases a bare letter it doesn't otherwise name", () => {
    expect(comboKeys("d", false)).toEqual([["D"]]);
  });
});

describe("comboLabel", () => {
  it("joins a chord's held keys with + and its halves with a space", () => {
    expect(comboLabel("g t", false)).toBe("G T");
    expect(comboLabel("mod+k", true)).toBe("⌘+K");
  });

  it("reads a single key as itself", () => {
    expect(comboLabel("?", false)).toBe("?");
  });
});
