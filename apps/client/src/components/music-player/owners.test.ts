import { describe, expect, it } from "bun:test";

import { ownerRoute } from "@/components/music-player/owners";
import type {
  MusicPlayerOwnerType,
  MusicPlayerTrack,
} from "@/components/music-player/types";

function track(
  ownerType: MusicPlayerOwnerType,
  ownerId: number,
  collectionId?: number
): MusicPlayerTrack {
  return {
    ownerType,
    ownerId,
    collectionId,
    asset: { id: 1, name: "asset", assetPath: "a" },
  };
}

describe("ownerRoute", () => {
  it("links each owner kind to its own page", () => {
    expect(ownerRoute(track("track", 1))).toEqual({
      kind: "track",
      trackId: 1,
      collectionId: undefined,
    });
    expect(ownerRoute(track("session", 2))).toEqual({
      kind: "session",
      sessionId: 2,
      trackId: undefined,
      collectionId: undefined,
    });
    expect(ownerRoute(track("collection", 3))).toEqual({
      kind: "collection",
      collectionId: 3,
    });
    expect(ownerRoute(track("project", 4))).toEqual({ kind: "project" });
  });

  it("keeps the collection a track or session was reached through", () => {
    expect(ownerRoute(track("track", 1, 9))).toEqual({
      kind: "track",
      trackId: 1,
      collectionId: 9,
    });
    expect(ownerRoute(track("session", 2, 9))).toEqual({
      kind: "session",
      sessionId: 2,
      trackId: undefined,
      collectionId: 9,
    });
  });
});
