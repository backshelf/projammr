import { swapVersion } from "@/components/track-audio/use-version-switch";
import type { MusicPlayerTrack } from "@/components/music-player/types";
import type { TrackAudioWithAsset } from "@workspace/api/api";
import { partial } from "@workspace/test/fixture";
import { describe, expect, it } from "bun:test";

const track: MusicPlayerTrack = {
  title: "Reverie",
  artists: ["Nova"],
  ownerType: "track",
  ownerId: 42,
  projectId: 7,
  collectionId: 3,
  asset: partial<TrackAudioWithAsset["asset"]>({
    id: 100,
    name: "reverie-v1.wav",
    assetPath: "/static/reverie-v1.wav",
    createdAt: "2026-01-01T00:00:00.000Z",
  }),
  trackAudio: { id: 1, version: 1, isPrimary: true },
};

const audio: TrackAudioWithAsset = {
  id: 2,
  version: 2,
  isPrimary: false,
  assetId: 200,
  lufs: null,
  asset: partial<TrackAudioWithAsset["asset"]>({
    id: 200,
    name: "reverie-v2.wav",
    assetPath: "/static/reverie-v2.wav",
    createdAt: "2026-02-01T00:00:00.000Z",
  }),
} as TrackAudioWithAsset;

describe("swapVersion", () => {
  it("keeps the identity fields from the original track", () => {
    const swapped = swapVersion(track, audio);

    expect(swapped.title).toBe(track.title);
    expect(swapped.artists).toBe(track.artists);
    expect(swapped.ownerId).toBe(track.ownerId);
    expect(swapped.projectId).toBe(track.projectId);
    expect(swapped.collectionId).toBe(track.collectionId);
  });

  it("replaces the asset and trackAudio with the target version's", () => {
    const swapped = swapVersion(track, audio);

    expect(swapped.asset).toBe(audio.asset);
    expect(swapped.trackAudio).toEqual({
      id: audio.id,
      version: audio.version,
      isPrimary: audio.isPrimary,
      lufs: null,
    });
  });

  it("copies the loudness value off the audio row when present", () => {
    const loud = { ...audio, lufs: -9.5 };

    expect(swapVersion(track, loud).trackAudio?.lufs).toBe(-9.5);
  });
});
