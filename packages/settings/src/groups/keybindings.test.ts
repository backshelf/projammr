import { describe, expect, it } from "bun:test";
import { settings } from "./keybindings";

describe("keybindings settings", () => {
  for (const setting of settings) {
    describe(setting.key, () => {
      it("accepts canonical combos, a chord and an unbound command", () => {
        expect(
          setting.schema.safeParse({
            search: ["mod+k", "g g"],
            gone: [],
            stale: ["shift+j"],
          }).success
        ).toBe(true);
        expect(setting.schema.safeParse(setting.default).success).toBe(true);
      });

      it("refuses shift+1, an uppercase letter and a chord opening on a digit", () => {
        for (const combo of ["shift+1", "J", "1 g"]) {
          expect(setting.schema.safeParse({ search: [combo] }).success).toBe(
            false
          );
        }
      });

      it("refuses more than four combos and an empty command id", () => {
        expect(
          setting.schema.safeParse({ a: ["a", "b", "c", "d", "e"] }).success
        ).toBe(false);
        expect(setting.schema.safeParse({ "": ["a"] }).success).toBe(false);
      });
    });
  }
});
