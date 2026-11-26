import { isLive } from "@/components/music-player/use-side-frames";
import { describe, expect, it } from "bun:test";

describe("isLive", () => {
  it("is live only once a surface asked and the engine is routed", () => {
    expect(isLive(true, true)).toBe(true);
  });

  it("is not live while nothing has asked, even if something else routed", () => {
    expect(isLive(false, true)).toBe(false);
  });

  it("is not live while unrouted, even if a surface asked", () => {
    expect(isLive(true, false)).toBe(false);
  });

  it("is not live with neither", () => {
    expect(isLive(false, false)).toBe(false);
  });
});
