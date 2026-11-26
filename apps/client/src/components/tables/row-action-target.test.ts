import { describe, expect, it } from "bun:test";

import { rowActionTargetIds } from "./row-action-target";

describe("rowActionTargetIds", () => {
  it("acts on the whole selection when the row is one of several ticked", () => {
    expect(rowActionTargetIds(2, [1, 2, 3])).toEqual([1, 2, 3]);
    expect(rowActionTargetIds(1, [1, 2])).toEqual([1, 2]);
  });

  it("returns the selection itself, not a copy of the row", () => {
    const selected = [4, 5];
    expect(rowActionTargetIds(5, selected)).toBe(selected);
  });

  it("acts on the row alone when it is outside the selection", () => {
    expect(rowActionTargetIds(9, [1, 2, 3])).toEqual([9]);
  });

  it("treats a selection of exactly one as a single-row action", () => {
    expect(rowActionTargetIds(7, [7])).toEqual([7]);
    expect(rowActionTargetIds(8, [7])).toEqual([8]);
  });

  it("acts on the row alone with nothing selected", () => {
    expect(rowActionTargetIds(3, [])).toEqual([3]);
  });
});
