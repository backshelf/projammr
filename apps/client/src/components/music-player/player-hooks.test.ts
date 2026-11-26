import { showsRoutedNotice } from "@/components/music-player/player-hooks";
import { describe, expect, it } from "bun:test";

describe("showsRoutedNotice", () => {
  it("shows once audio is routed on a coarse pointer", () => {
    expect(showsRoutedNotice(true, true)).toBe(true);
  });

  it("stays hidden on a fine pointer even while routed", () => {
    expect(showsRoutedNotice(true, false)).toBe(false);
  });

  it("stays hidden on a coarse pointer while nothing is routed", () => {
    expect(showsRoutedNotice(false, true)).toBe(false);
  });
});
