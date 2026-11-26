import { beforeEach, describe, expect, it, mock } from "bun:test";
import { partial } from "@workspace/test/fixture";
import type {
  Asset,
  CollectionPrimaryAudios,
  PlayableTrackAudio,
} from "@workspace/api/api";
import type { VersionToPlay } from "@/lib/policies/playback";

const getAudios = mock<(trackId: number) => Promise<PlayableTrackAudio[]>>();
const getAttachments = mock<(trackId: number) => Promise<Asset[]>>();
const getCollectionAudios =
  mock<
    (
      collectionId: number,
      version: VersionToPlay
    ) => Promise<CollectionPrimaryAudios>
  >();
const toastError = mock();

mock.module("@/lib/client-api", () => ({
  clientGetTrackAudios: getAudios,
  clientGetTrackAttachments: getAttachments,
  clientGetCollectionPrimaryAudios: getCollectionAudios,
}));
mock.module("sonner", () => ({
  toast: Object.assign(mock(), { error: toastError }),
}));

const { chooseVersion, collectionToPlayable, trackToPlayable } =
  await import("./play-track");
const { DEFAULT_PLAYBACK } = await import("@/lib/policies/playback");

const version = (id: number, n: number, isPrimary = false) =>
  partial<PlayableTrackAudio>({
    id,
    version: n,
    isPrimary,
    asset: partial<Asset>({
      id: 100 + id,
      name: `v${n}.wav`,
      assetPath: `./v${n}.wav`,
    }),
    owner: null,
  });

const attachment = partial<Asset>({
  id: 900,
  name: "bounce.wav",
  assetPath: "./bounce.wav",
  createdAt: "2026-09-01T00:00:00Z",
});

beforeEach(() => {
  getAudios.mockReset();
  getAttachments.mockReset();
  getCollectionAudios.mockReset();
  toastError.mockReset();
});

describe("chooseVersion", () => {
  const audios = [version(1, 1), version(2, 3, true), version(3, 4)];

  it("plays the primary version, by default", () => {
    expect(chooseVersion(audios, DEFAULT_PLAYBACK.versionToPlay).id).toBe(2);
  });

  it("falls back to the highest version when none is primary", () => {
    expect(chooseVersion([version(1, 1), version(3, 4)], "primary").id).toBe(3);
  });

  it("plays the highest version when the policy asks for the latest", () => {
    expect(chooseVersion(audios, "latest").id).toBe(3);
  });
});

describe("collectionToPlayable", () => {
  const row = (trackId: number, audioId: number, n: number) => ({
    ...partial<Asset>({ id: 100 + audioId, name: `v${n}.wav` }),
    trackId,
    trackNumber: trackId,
    trackAudio: { id: audioId, version: n, isPrimary: n === 1 },
    owner: null,
  });

  it.each(["primary", "latest"] as const)(
    "asks for the %s version of each track",
    async (versionToPlay) => {
      getCollectionAudios.mockResolvedValue([row(7, 1, 1)]);

      await collectionToPlayable(3, versionToPlay);

      expect(getCollectionAudios).toHaveBeenCalledWith(3, versionToPlay);
    }
  );

  it("queues the audio the server picked for each track", async () => {
    getCollectionAudios.mockResolvedValue([row(7, 2, 2), row(8, 3, 1)]);

    const items = await collectionToPlayable(3, "latest");

    expect(items?.map((item) => [item.ownerId, item.trackAudio?.id])).toEqual([
      [7, 2],
      [8, 3],
    ]);
  });
});

describe("trackToPlayable", () => {
  it("plays the version the policy picks", async () => {
    getAudios.mockResolvedValue([version(1, 1, true), version(2, 2)]);

    const items = await trackToPlayable(
      7,
      { ...DEFAULT_PLAYBACK, versionToPlay: "latest" },
      "Kindling"
    );

    expect(items?.[0]).toMatchObject({
      ownerType: "track",
      ownerId: 7,
      title: "Kindling",
      trackAudio: { id: 2, version: 2, isPrimary: false },
    });
  });

  it("falls back to the newest audio attachment, by default", async () => {
    getAudios.mockResolvedValue([]);
    getAttachments.mockResolvedValue([attachment]);

    const items = await trackToPlayable(7, DEFAULT_PLAYBACK);

    expect(items?.[0]?.asset).toBe(attachment);
  });

  it("says the track has no audio, and never looks at its attachments, when the policy has no fallback", async () => {
    getAudios.mockResolvedValue([]);

    const items = await trackToPlayable(
      7,
      { ...DEFAULT_PLAYBACK, noAudioFallback: "none" },
      "Kindling"
    );

    expect(items).toBeNull();
    expect(getAttachments).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith("Kindling has no audio");
  });
});
