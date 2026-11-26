import { describe, expect, it } from "bun:test";

import { estimatedItemHeight } from "./GridSections";

describe("estimatedItemHeight", () => {
  it("is the comfortable row's height at the default density", () => {
    expect(estimatedItemHeight(1)).toBe(40);
  });

  it("scales only the cells' padding with --density", () => {
    // The content line holds its height; only the 16px of padding moves.
    expect(estimatedItemHeight(0.5)).toBe(32);
    expect(estimatedItemHeight(1.5)).toBe(48);
  });
});
