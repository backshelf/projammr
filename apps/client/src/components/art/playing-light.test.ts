import { describe, expect, it } from "bun:test";
import type { MusicPlayerTrack } from "@/components/music-player/types";
import { belongsTo, playbackState } from "./playing-light";

const track = (overrides: Partial<MusicPlayerTrack>): MusicPlayerTrack => ({
  ownerType: "track",
  ownerId: 1,
  asset: { id: 1, name: "demo.wav", assetPath: "demo.wav" },
  ...overrides,
});

describe("playbackState", () => {
  it("reads playing on a track page whose own track is loaded and playing", () => {
    expect(
      playbackState(track({ ownerId: 42 }), true, { kind: "track", id: 42 })
    ).toBe("playing");
  });

  it("reads paused on a track page whose own track is loaded but paused", () => {
    expect(
      playbackState(track({ ownerId: 42 }), false, { kind: "track", id: 42 })
    ).toBe("paused");
  });

  it("is null on a track page when a different track is loaded", () => {
    expect(
      playbackState(track({ ownerId: 7 }), true, { kind: "track", id: 42 })
    ).toBeNull();
  });

  it("reads playing on a collection page when the loaded track belongs to it", () => {
    expect(
      playbackState(track({ ownerId: 7, collectionId: 9 }), true, {
        kind: "collection",
        id: 9,
      })
    ).toBe("playing");
  });

  it("is null on a collection page when nothing is loaded", () => {
    expect(
      playbackState(null, false, { kind: "collection", id: 9 })
    ).toBeNull();
  });
});

describe("belongsTo", () => {
  it("matches a track owner only by track id, ignoring collection membership", () => {
    expect(
      belongsTo(track({ ownerId: 42, collectionId: 1 }), {
        kind: "track",
        id: 42,
      })
    ).toBe(true);
  });

  it("matches a collection owner by collectionId regardless of the track", () => {
    expect(
      belongsTo(track({ ownerId: 3, collectionId: 9 }), {
        kind: "collection",
        id: 9,
      })
    ).toBe(true);
  });
});
