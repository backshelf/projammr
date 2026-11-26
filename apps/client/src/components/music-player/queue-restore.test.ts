import { describe, expect, it, mock } from "bun:test";
import { partial } from "@workspace/test/fixture";
import type { Asset, PlayableTrackAudio } from "@workspace/api/api";
import type { StoredQueueEntry } from "./player-storage";
import { resolveStoredQueue, type QueueReads } from "./queue-restore";

const version = (trackId: number, id: number) =>
  partial<PlayableTrackAudio>({
    id,
    version: id,
    isPrimary: false,
    asset: partial<Asset>({
      id: 1000 + id,
      name: `v${id}.wav`,
      assetPath: `./v${id}.wav`,
    }),
    owner: null,
  });

/** Reads over a fixed catalogue: track 1 has versions 11 and 12, file 30 exists. */
function catalogue(): QueueReads & {
  trackAudios: ReturnType<typeof mock>;
} {
  const trackAudios = mock(async (trackId: number) =>
    trackId === 1 ? [version(1, 11), version(1, 12)] : []
  );
  return {
    trackAudios,
    asset: async (assetId) =>
      assetId === 30
        ? { id: 30, name: "memo.m4a", assetPath: "./memo.m4a", projectId: 4 }
        : null,
  };
}

describe("resolveStoredQueue", () => {
  it("fetches each entry afresh, a version from its track and a file as itself", async () => {
    const entries: StoredQueueEntry[] = [
      { kind: "version", trackId: 1, trackAudioId: 12 },
      { kind: "asset", ownerType: "session", ownerId: 3, assetId: 30 },
    ];

    const [track, file] = await resolveStoredQueue(entries, catalogue());

    expect(track).toMatchObject({
      ownerType: "track",
      ownerId: 1,
      asset: { id: 1012 },
      trackAudio: { id: 12 },
    });
    expect(file).toEqual({
      asset: { id: 30, name: "memo.m4a", assetPath: "./memo.m4a" },
      ownerType: "session",
      ownerId: 3,
      projectId: 4,
    });
  });

  it("resolves a deleted version, a deleted file and a failed read to null", async () => {
    const reads = catalogue();
    const entries: StoredQueueEntry[] = [
      { kind: "version", trackId: 1, trackAudioId: 99 },
      { kind: "asset", ownerType: "project", ownerId: 4, assetId: 31 },
      { kind: "version", trackId: 2, trackAudioId: 21 },
    ];

    expect(await resolveStoredQueue(entries, reads)).toEqual([
      null,
      null,
      null,
    ]);

    const failing: QueueReads = {
      trackAudios: () => Promise.reject(new Error("offline")),
      asset: () => Promise.reject(new Error("offline")),
    };
    expect(await resolveStoredQueue(entries, failing)).toEqual([
      null,
      null,
      null,
    ]);
  });

  it("reads a track's versions once however many of them are queued", async () => {
    const reads = catalogue();

    await resolveStoredQueue(
      [
        { kind: "version", trackId: 1, trackAudioId: 11 },
        { kind: "version", trackId: 1, trackAudioId: 12 },
      ],
      reads
    );

    expect(reads.trackAudios).toHaveBeenCalledTimes(1);
  });
});
