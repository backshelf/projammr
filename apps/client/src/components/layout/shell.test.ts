import { describe, expect, it } from "bun:test";

import { CANVAS } from "@/components/layout/shell";

describe("CANVAS", () => {
  // The canvas scrolls, so its own height is one viewport. With an `auto`
  // masthead row, a body taller than that leaves no free space and the row
  // stops at the masthead's `min-height`, so a tall masthead (a track with
  // its audio strips on) spills over the first section below it.
  it("sizes the masthead row to its content, not to its minimum", () => {
    const classes = CANVAS.split(/\s+/);

    expect(classes).toContain("grid-rows-[max-content_1fr]");
    expect(classes).not.toContain("grid-rows-[auto_1fr]");
  });

  it("reserves max-content rows for head and rail when stacked", () => {
    const classes = CANVAS.split(/\s+/);

    expect(classes).toContain("stack:grid-rows-[max-content_max-content_1fr]");
    expect(classes).not.toContain("stack:grid-rows-none");
  });
});
