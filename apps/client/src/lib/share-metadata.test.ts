import { describe, expect, it } from "bun:test";
import {
  posterCover,
  shareMetadata,
  SHARE_UNAVAILABLE_METADATA,
} from "./share-metadata";
import type { Sharelink, SharelinkTrack } from "@workspace/api/api";

const track = (
  id: number,
  trackAudio: SharelinkTrack["trackAudio"],
  withArtwork: boolean
): SharelinkTrack => ({
  id,
  title: `Track ${id}`,
  trackAudio,
  artwork: withArtwork
    ? { assetPath: "art.jpg", accentHue: null, accentChroma: null }
    : null,
});

const share = (
  tracks: SharelinkTrack[],
  overrides: Partial<Sharelink> = {}
): Sharelink =>
  ({
    token: "tok",
    entityType: "collection",
    title: "Demo EP",
    tracks,
    ...overrides,
  }) as Sharelink;

describe("shareMetadata", () => {
  const sharelink = share([track(1, { id: 5, assetId: 9 }, true)]);

  it("is noindex, nofollow", () => {
    expect(shareMetadata(sharelink, "https://a.test").robots).toEqual({
      index: false,
      follow: false,
    });
  });

  it("describes the share with its facts line and sets the base URL", () => {
    const metadata = shareMetadata(sharelink, "https://a.test");
    expect(metadata.title).toBe("Demo EP");
    expect(metadata.description).toBeTruthy();
    expect(metadata.openGraph?.description).toBe(metadata.description!);
    expect(String(metadata.metadataBase)).toBe("https://a.test/");
    expect(metadata.twitter).toMatchObject({ card: "summary_large_image" });
  });

  it("carries no images key, so the poster route is picked up", () => {
    const metadata = shareMetadata(sharelink, "https://a.test");
    expect(metadata.openGraph).not.toHaveProperty("images");
    expect(metadata.twitter).not.toHaveProperty("images");
  });

  it("titles an untitled share 'Shared audio'", () => {
    const metadata = shareMetadata(
      share([], { title: undefined }),
      "https://a.test"
    );
    expect(metadata.title).toBe("Shared audio");
  });
});

describe("SHARE_UNAVAILABLE_METADATA", () => {
  it("is a title and noindex, nothing else", () => {
    expect(Object.keys(SHARE_UNAVAILABLE_METADATA).sort()).toEqual([
      "robots",
      "title",
    ]);
  });
});

describe("posterCover", () => {
  it("picks the first playable entry's artwork", () => {
    const sharelink = share([
      track(1, {}, true),
      track(2, { id: 7, assetId: 1 }, true),
      track(3, { id: 8, assetId: 2 }, true),
    ]);
    expect(posterCover(sharelink)).toEqual({ trackAudioId: 7 });
  });

  it("is null when the first playable entry has no artwork, even if a later one does", () => {
    const sharelink = share([
      track(1, { id: 7, assetId: 1 }, false),
      track(2, { id: 8, assetId: 2 }, true),
    ]);
    expect(posterCover(sharelink)).toBeNull();
  });

  it("is null when nothing is playable", () => {
    expect(posterCover(share([track(1, {}, true)]))).toBeNull();
  });
});
