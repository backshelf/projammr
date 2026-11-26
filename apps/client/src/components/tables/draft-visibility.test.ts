import { describe, expect, it } from "bun:test";

import { siblingsToSettle, type SectionedRow } from "./draft-visibility";

const rows: SectionedRow[] = [
  { id: "1", sectionKey: "mixing" },
  { id: "2", sectionKey: "mixing" },
  { id: "3", sectionKey: "mastering" },
  { id: "4", sectionKey: "mastering" },
];

describe("siblingsToSettle", () => {
  it("settles the rows of the draft's own section", () => {
    expect([...siblingsToSettle(rows, 0, "mixing")]).toEqual(["1", "2"]);
  });

  it("leaves the rows of every other section alone", () => {
    const settling = siblingsToSettle(rows, 2, "mastering");

    expect(settling.has("3")).toBe(true);
    expect(settling.has("4")).toBe(true);
    expect(settling.has("1")).toBe(false);
    expect(settling.has("2")).toBe(false);
  });

  it("settles nothing below a draft that closes the table", () => {
    expect(siblingsToSettle(rows, rows.length, "mastering").size).toBe(0);
  });

  it("settles nothing when the draft's section holds no rows", () => {
    expect(siblingsToSettle(rows, -1, "recording").size).toBe(0);
  });
});
