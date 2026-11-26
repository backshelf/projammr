import { flickCommits } from "@/components/music-player/flick";
import { describe, expect, it } from "bun:test";

/** How far the mini-player's strip can travel before it is at its stop. */
const REACH = 48;

describe("flickCommits", () => {
  it("refuses a short, slow drag", () => {
    expect(flickCommits(20, 0.05, REACH)).toBe(false);
  });

  it("commits a slow drag that reached the stop", () => {
    expect(flickCommits(REACH, 0.05, REACH)).toBe(true);
  });

  it("commits a fast drag past the flick distance", () => {
    expect(flickCommits(44, 1.2, REACH)).toBe(true);
  });

  it("refuses a fast twitch under the flick distance", () => {
    expect(flickCommits(20, 1.2, REACH)).toBe(false);
  });

  it("refuses a drag sitting exactly on both flick thresholds", () => {
    expect(flickCommits(40, 0.6, 400)).toBe(false);
  });
});
