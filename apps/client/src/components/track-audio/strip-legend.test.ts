import { describe, expect, it } from "bun:test";
import { DEFAULT_VISUALS } from "@/lib/policies/visuals";
import { DEFAULT_STRIP_IDS, knownStrips, toggleStrip } from "./strip-legend";

describe("knownStrips", () => {
  it("defaults to empty under the default visuals policy", () => {
    expect(DEFAULT_VISUALS.strips).toEqual([]);
    expect(knownStrips(DEFAULT_VISUALS.strips)).toEqual([...DEFAULT_STRIP_IDS]);
  });

  it("keeps a chosen list as it is", () => {
    expect(knownStrips(["change"])).toEqual(["change"]);
  });

  it("drops an id that no longer names a strip", () => {
    expect(knownStrips(["loudness", "reverb"])).toEqual(["loudness"]);
  });

  it("falls back to the defaults when every id names a retired strip", () => {
    expect(knownStrips(["sections", "pitch"])).toEqual([...DEFAULT_STRIP_IDS]);
  });

  it("keeps a choice to hide every strip", () => {
    expect(knownStrips([])).toEqual([]);
  });
});

describe("toggleStrip", () => {
  it("adds an id that was not chosen", () => {
    expect(toggleStrip(["loudness"], "change")).toEqual(["loudness", "change"]);
  });

  it("removes an id that was already chosen", () => {
    expect(toggleStrip(["loudness", "change"], "loudness")).toEqual(["change"]);
  });
});
