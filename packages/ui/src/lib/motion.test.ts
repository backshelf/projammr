import {
  FADE,
  LEAVE,
  OPTICAL,
  POP,
  SPRING,
  SURFACE,
} from "@workspace/ui/lib/motion";
import { describe, expect, it } from "bun:test";

describe("SPRING", () => {
  it("never bounces", () => {
    for (const [name, transition] of Object.entries(SPRING)) {
      expect(transition.bounce, name).toBe(0);
    }
  });
});

describe("LEAVE", () => {
  it("is shorter than the matching FADE at every shared duration", () => {
    for (const key of Object.keys(LEAVE) as (keyof typeof LEAVE)[]) {
      expect(LEAVE[key].duration, key).toBeLessThan(FADE[key].duration);
    }
  });
});

describe("SURFACE, POP and OPTICAL", () => {
  it.each([
    ["SURFACE", SURFACE],
    ["POP", POP],
    ["OPTICAL", OPTICAL],
  ])("%s defines hidden, shown and leaving", (_name, variants) => {
    expect(variants).toHaveProperty("hidden");
    expect(variants).toHaveProperty("shown");
    expect(variants).toHaveProperty("leaving");
  });
});
