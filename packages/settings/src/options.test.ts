import { describe, expect, it } from "bun:test";
import { completeArrangedList } from "./options.js";

const DEFAULTS = [
  { id: "a", shown: true, collapsed: false },
  { id: "b", shown: true, collapsed: false },
  { id: "c", shown: true, collapsed: false },
];

describe("completeArrangedList", () => {
  it("returns a full stored list unchanged", () => {
    const stored = [
      { id: "c", shown: false, collapsed: true },
      { id: "a", shown: true, collapsed: false },
      { id: "b", shown: true, collapsed: true },
    ];
    expect(completeArrangedList(stored, DEFAULTS)).toEqual(stored);
  });

  it("appends the default's row for each id the stored list leaves out, in default order", () => {
    const stored = [{ id: "b", shown: false, collapsed: true }];
    expect(completeArrangedList(stored, DEFAULTS)).toEqual([
      { id: "b", shown: false, collapsed: true },
      { id: "a", shown: true, collapsed: false },
      { id: "c", shown: true, collapsed: false },
    ]);
  });

  it("drops stored ids the default does not name and repeats of an id", () => {
    const stored = [
      { id: "gone", shown: true, collapsed: false },
      { id: "b", shown: false, collapsed: false },
      { id: "b", shown: true, collapsed: true },
    ];
    expect(completeArrangedList(stored, DEFAULTS).map((row) => row.id)).toEqual(
      ["b", "a", "c"]
    );
    expect(completeArrangedList(stored, DEFAULTS)[0]).toEqual({
      id: "b",
      shown: false,
      collapsed: false,
    });
  });

  it("returns the default for an empty stored list", () => {
    expect(completeArrangedList([], DEFAULTS)).toEqual(DEFAULTS);
  });
});
