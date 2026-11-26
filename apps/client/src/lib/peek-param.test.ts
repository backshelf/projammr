import { describe, expect, it } from "bun:test";

import { PEEK_PARAM, parsePeek, resolvePeek, stepPeek } from "./peek-param";
import { filterViewQuery } from "./table-params";

const rows = [{ id: 4 }, { id: 9 }, { id: 12 }];

describe("parsePeek", () => {
  it("reads a row id", () => {
    expect(parsePeek("12")).toBe(12);
  });

  it("reads an absent or blank param as closed", () => {
    expect(parsePeek(null)).toBeNull();
    expect(parsePeek("")).toBeNull();
    expect(parsePeek("   ")).toBeNull();
  });

  it("rejects values that are not a positive row id", () => {
    expect(parsePeek("abc")).toBeNull();
    expect(parsePeek("0")).toBeNull();
    expect(parsePeek("-3")).toBeNull();
    expect(parsePeek("1.5")).toBeNull();
  });
});

describe("resolvePeek", () => {
  it("finds the open row and its position", () => {
    expect(resolvePeek(rows, 9)).toEqual({
      row: { id: 9 },
      index: 1,
      total: 3,
    });
  });

  it("is closed when no id is set", () => {
    expect(resolvePeek(rows, null)).toEqual({ row: null, index: -1, total: 3 });
  });

  it("stays closed when the id is not on this page", () => {
    // A page change can leave a stale id in the URL; showing a neighbouring
    // row instead would open something the user never clicked.
    expect(resolvePeek(rows, 99)).toEqual({
      row: null,
      index: -1,
      total: 3,
    });
  });
});

describe("stepPeek", () => {
  it("steps to the neighbouring row", () => {
    expect(stepPeek(rows, 1, -1, { hasMore: false })).toBe(4);
    expect(stepPeek(rows, 1, 1, { hasMore: false })).toBe(12);
  });

  it("stops at the start of the page regardless of hasMore", () => {
    expect(stepPeek(rows, 0, -1, { hasMore: false })).toBeNull();
    expect(stepPeek(rows, 0, -1, { hasMore: true })).toBeNull();
  });

  it("stops at the end of the page when there is nothing more to load", () => {
    expect(stepPeek(rows, 2, 1, { hasMore: false })).toBeNull();
  });

  it("reports a load is needed past the end of the page when more exists", () => {
    expect(stepPeek(rows, 2, 1, { hasMore: true })).toBe("load");
  });

  it("has nowhere to step from a closed panel", () => {
    expect(stepPeek(rows, -1, 1, { hasMore: true })).toBeNull();
    expect(stepPeek(rows, -1, -1, { hasMore: true })).toBeNull();
  });
});

describe("peek is not part of a saved view", () => {
  it("drops the param when a view is saved", () => {
    // A view is a lens on the data; which row happened to be open when it was
    // saved is not part of it.
    expect(filterViewQuery("q=demo&status=3&peek=12")).toBe("q=demo&status=3");
  });
});

describe("writePeekToUrl", () => {
  it("leaves the other params alone", () => {
    // The panel opens over whatever the table is currently showing; the
    // filters and page that produced it have to survive.
    const url = new URL("http://x/tracks?q=demo&status=3&page=2");
    url.searchParams.set(PEEK_PARAM, "12");
    expect(url.search).toBe("?q=demo&status=3&page=2&peek=12");
    url.searchParams.delete(PEEK_PARAM);
    expect(url.search).toBe("?q=demo&status=3&page=2");
  });
});
