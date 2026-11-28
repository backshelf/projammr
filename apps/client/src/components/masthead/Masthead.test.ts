import { describe, expect, it } from "bun:test";

import { mastheadTitle } from "./Masthead";

describe("mastheadTitle", () => {
  it("preserves leading-[1.02] in both default and compact variants", () => {
    const regular = mastheadTitle(false).split(/\s+/);
    const compact = mastheadTitle(true).split(/\s+/);

    expect(regular).toContain("leading-[1.02]");
    expect(regular).toContain("text-display");
    expect(regular).toContain("phone:text-title");

    expect(compact).toContain("leading-[1.02]");
    expect(compact).toContain("text-title");
  });
});
