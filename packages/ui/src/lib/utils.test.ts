import { describe, expect, it } from "bun:test";

import { cn } from "./utils";

describe("cn", () => {
  it("keeps a type-scale size beside a text colour", () => {
    expect(cn("text-small", "text-ink")).toBe("text-small text-ink");
  });

  it("keeps a lift token beside a shadow colour", () => {
    expect(cn("shadow-menu", "shadow-art")).toBe("shadow-menu shadow-art");
  });

  it("lets a later lift override an earlier one", () => {
    expect(cn("shadow-overlay", "shadow-none")).toBe("shadow-none");
    expect(cn("shadow-sm", "shadow-menu")).toBe("shadow-menu");
  });
});
