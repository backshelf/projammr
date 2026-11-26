import { describe, expect, it } from "bun:test";

import { nextCursor } from "./row-cursor";

const rows = ["4", "9", "2"];
const noMore = { hasMore: false };
const hasMore = { hasMore: true };

describe("nextCursor", () => {
  it("steps down and up through the rows", () => {
    expect(nextCursor(rows, "4", 1, noMore)).toBe("9");
    expect(nextCursor(rows, "2", -1, noMore)).toBe("9");
  });

  it("wraps past the last row to the first, and back, once everything is loaded", () => {
    expect(nextCursor(rows, "2", 1, noMore)).toBe("4");
    expect(nextCursor(rows, "4", -1, noMore)).toBe("2");
  });

  it("loads instead of wrapping forward past the last row while more rows exist", () => {
    expect(nextCursor(rows, "2", 1, hasMore)).toEqual({ load: 3 });
  });

  it("stays put stepping back past the first row while more rows exist", () => {
    expect(nextCursor(rows, "4", -1, hasMore)).toBe("4");
  });

  it("enters from the top going down and the bottom going up", () => {
    expect(nextCursor(rows, null, 1, noMore)).toBe("4");
    expect(nextCursor(rows, null, -1, noMore)).toBe("2");
  });

  it("re-enters when the cursor row is no longer shown", () => {
    expect(nextCursor(rows, "7", 1, noMore)).toBe("4");
    expect(nextCursor(rows, "7", -1, noMore)).toBe("2");
  });

  it("stays on a lone row", () => {
    expect(nextCursor(["5"], "5", 1, noMore)).toBe("5");
  });

  it("has nowhere to go without rows", () => {
    expect(nextCursor([], "4", 1, noMore)).toBeNull();
    expect(nextCursor([], "4", 1, noMore, 5)).toBeNull();
  });
});

describe("nextCursor with a count", () => {
  const five = ["a", "b", "c", "d", "e"];

  it("moves that many rows down and up", () => {
    expect(nextCursor(five, "a", 1, noMore, 3)).toBe("d");
    expect(nextCursor(five, "e", -1, noMore, 3)).toBe("b");
  });

  it("treats a count of one as a single step, wrap rules included", () => {
    expect(nextCursor(five, "e", 1, noMore, 1)).toBe("a");
    expect(nextCursor(five, "a", -1, noMore, 1)).toBe("e");
    expect(nextCursor(five, "e", 1, hasMore, 1)).toEqual({ load: 5 });
    expect(nextCursor(five, "a", -1, hasMore, 1)).toBe("a");
  });

  it("clamps at the last row instead of wrapping once everything is loaded", () => {
    expect(nextCursor(five, "d", 1, noMore, 4)).toBe("e");
    expect(nextCursor(five, "e", 1, noMore, 2)).toBe("e");
  });

  it("clamps at the first row instead of wrapping, whether or not more rows exist", () => {
    expect(nextCursor(five, "b", -1, noMore, 4)).toBe("a");
    expect(nextCursor(five, "a", -1, noMore, 2)).toBe("a");
    expect(nextCursor(five, "b", -1, hasMore, 4)).toBe("a");
  });

  it("asks to load up to the target index when it lies past the loaded rows", () => {
    expect(nextCursor(five, "d", 1, hasMore, 4)).toEqual({ load: 7 });
    expect(nextCursor(five, "a", 1, hasMore, 4)).toBe("e");
  });

  it("continues the count from the side an unset cursor enters", () => {
    expect(nextCursor(five, null, 1, noMore, 3)).toBe("c");
    expect(nextCursor(five, null, -1, noMore, 3)).toBe("c");
    expect(nextCursor(five, "z", 1, noMore, 2)).toBe("b");
  });

  it("clamps a count that overshoots from an unset cursor", () => {
    expect(nextCursor(five, null, 1, noMore, 9)).toBe("e");
    expect(nextCursor(five, null, -1, noMore, 9)).toBe("a");
    expect(nextCursor(five, null, 1, hasMore, 9)).toEqual({ load: 8 });
  });
});
