import { describe, expect, it } from "bun:test";
import { DEFAULT_PLAYBACK } from "./playback";

describe("DEFAULT_PLAYBACK", () => {
  it("is the player as it has always behaved", () => {
    expect(DEFAULT_PLAYBACK).toEqual({
      defaultVolume: 1,
      startMuted: false,
      repeat: "off",
      shuffle: false,
      persistQueue: false,
      seekSmallSeconds: 5,
      seekLargeSeconds: 30,
      previousRestartsAfterSeconds: 3,
      queueEnd: "stop",
      queueingStarts: true,
      rowPlayContext: "collection",
      versionToPlay: "primary",
      noAudioFallback: "attachment",
      analysisOnTouch: false,
      crossfadeSeconds: 0,
    });
  });
});
