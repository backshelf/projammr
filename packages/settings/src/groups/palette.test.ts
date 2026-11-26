import { describe, expect, it } from "bun:test";
import { PALETTE_PREFIX_COMMANDS, settings } from "./palette";

const aliases = settings.find((each) => each.key === "palette.aliases")!;

describe("palette.aliases", () => {
  it("accepts an alias for each prefix command", () => {
    for (const id of PALETTE_PREFIX_COMMANDS) {
      expect(aliases.schema.safeParse({ x: id }).success).toBe(true);
    }
  });

  it("refuses an alias for a command the palette does not have", () => {
    expect(aliases.schema.safeParse({ x: "gone" }).success).toBe(false);
    expect(aliases.schema.safeParse({ x: "" }).success).toBe(false);
  });
});
