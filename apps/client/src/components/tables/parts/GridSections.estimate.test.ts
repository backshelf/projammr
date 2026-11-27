import { describe, expect, it } from "bun:test";

import { estimatedItemHeight } from "./GridSections";

describe("estimatedItemHeight", () => {
  it("matches --table-row-h (44px) plus the 1px border at default density", () => {
    expect(estimatedItemHeight(1)).toBe(45);
  });

  it("scales --table-row-h with --density and rounds before adding the 1px border", () => {
    expect(estimatedItemHeight(0.5)).toBe(23);
    expect(estimatedItemHeight(0.75)).toBe(34);
    expect(estimatedItemHeight(1.3)).toBe(58);
    expect(estimatedItemHeight(1.5)).toBe(67);
  });
});
