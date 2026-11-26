import { describe, expect, it } from "bun:test";

import { gridToTsv, tsvToGrid } from "./tsv";

describe("gridToTsv", () => {
  it("joins a grid with tabs and newlines", () => {
    expect(
      gridToTsv([
        ["a", "b"],
        ["c", "d"],
      ])
    ).toBe("a\tb\nc\td");
  });

  it("renders null and undefined as empty fields", () => {
    expect(gridToTsv([[null, undefined, "x"]])).toBe("\t\tx");
  });

  it("quotes a field containing a tab", () => {
    expect(gridToTsv([["a\tb", "c"]])).toBe('"a\tb"\tc');
  });

  it("quotes a field containing a newline", () => {
    expect(gridToTsv([["a\nb"]])).toBe('"a\nb"');
  });

  it("quotes and doubles inner quotes", () => {
    expect(gridToTsv([['say "hi"']])).toBe('"say ""hi"""');
  });

  it("stringifies numbers", () => {
    expect(gridToTsv([[1, 2.5]])).toBe("1\t2.5");
  });

  it("joins a list value with a comma and a space", () => {
    expect(gridToTsv([[["Ana", "Ben"], "x"]])).toBe("Ana, Ben\tx");
  });
});

describe("tsvToGrid", () => {
  it("splits on tabs and newlines", () => {
    expect(tsvToGrid("a\tb\nc\td")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("handles CRLF row breaks", () => {
    expect(tsvToGrid("a\tb\r\nc\td")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("unwraps a quoted field with an embedded tab", () => {
    expect(tsvToGrid('"a\tb"\tc')).toEqual([["a\tb", "c"]]);
  });

  it("unwraps a quoted field with an embedded newline", () => {
    expect(tsvToGrid('"a\nb"\tc')).toEqual([["a\nb", "c"]]);
  });

  it("collapses doubled inner quotes", () => {
    expect(tsvToGrid('"say ""hi"""')).toEqual([['say "hi"']]);
  });

  it("preserves empty fields", () => {
    expect(tsvToGrid("\t\tx")).toEqual([["", "", "x"]]);
  });

  it("round-trips a grid with awkward values", () => {
    const grid = [
      ["plain", "with\ttab", ""],
      ['with "quote"', "with\nnewline", "42"],
    ];
    expect(tsvToGrid(gridToTsv(grid))).toEqual(grid);
  });
});
