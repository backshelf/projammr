import { beforeEach, describe, expect, it, mock } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import type { Artwork, Sharelink } from "@workspace/api/api";

const playNow = mock();
const playAt = mock();
let currentAssetId: number | null = null;
const threadIds: number[] = [];
let artProps: { artwork: Artwork | null; playing?: unknown } | null = null;

const currentAssetIdStub = () => currentAssetId;
const playerActionsStub = () => ({ playNow, playAt });
const commentThreadStub = (trackAudioId: number) => {
  threadIds.push(trackAudioId);
  return {
    comments: [],
    reload: mock(),
    commentMarks: [],
    registerScrollTarget: mock(),
    scrollToComment: mock(),
  };
};

mock.module("@/components/music-player/player-hooks", () => ({
  useCurrentAssetId: currentAssetIdStub,
  usePlayerActions: playerActionsStub,
}));
mock.module("@/components/track-audio/AudioCommentSection", () => ({
  useCommentThread: commentThreadStub,
}));
mock.module("@/components/comments/comment-backend", () => ({
  CommentBackendProvider: ({ children }: PropsWithChildren) => <>{children}</>,
}));
mock.module("@/components/share/share-backend", () => ({
  shareCommentBackend: () => ({}),
}));
mock.module("@/components/art/ArtProvider", () => ({
  ArtProvider: ({
    artwork,
    playing,
    children,
  }: PropsWithChildren<{ artwork: Artwork | null; playing?: unknown }>) => {
    artProps = { artwork, playing };
    return <div>{children}</div>;
  },
}));

const { ShareRoomProvider, useShareRoom } = await import("./ShareRoom");

const artwork = {
  assetPath: "/media/original-cover.jpg",
  accentHue: 200,
  accentChroma: 0.1,
} as Artwork;

const track = (
  id: number,
  audioId: number,
  withArtwork: boolean
): Sharelink["tracks"][number] =>
  ({
    id,
    title: `Track ${id}`,
    artwork: withArtwork ? artwork : null,
    trackAudio: { id: audioId, assetId: audioId + 100, trackId: id },
  }) as Sharelink["tracks"][number];

const sharelink = (tracks: Sharelink["tracks"]) =>
  ({ tracks, entityType: "collection", title: "Demo" }) as Sharelink;

const roomFor = (tracks: Sharelink["tracks"]) =>
  renderHook(() => useShareRoom(), {
    wrapper: ({ children }) => (
      <ShareRoomProvider
        token={"tok"}
        sharelink={sharelink(tracks)}
        viewerId={null}
      >
        {children}
      </ShareRoomProvider>
    ),
  });

beforeEach(() => {
  playNow.mockClear();
  playAt.mockClear();
  currentAssetId = null;
  threadIds.length = 0;
  artProps = null;
});

describe("ShareRoomProvider", () => {
  it("serves the current entry's cover from the share's own route", () => {
    const { result } = roomFor([track(1, 11, true)]);

    expect(result.current.artwork?.assetPath).toBe("/share/tok/cover/11");
    expect(result.current.artwork?.accentHue).toBe(200);
    expect(artProps?.artwork?.assetPath).toBe("/share/tok/cover/11");
    expect(artProps?.playing).toEqual({ kind: "track", id: 1 });
  });

  it("has no artwork when the current entry carries none, whatever the others do", () => {
    const { result } = roomFor([track(1, 11, false), track(2, 12, true)]);

    expect(result.current.artwork).toBeNull();
    expect(artProps?.artwork).toBeNull();
  });

  it("follows the store's current asset over the reader's pick", () => {
    currentAssetId = 112;
    const { result } = roomFor([track(1, 11, true), track(2, 12, false)]);

    expect(result.current.index).toBe(1);
    expect(result.current.entry?.trackAudioId).toBe(12);
    expect(result.current.loaded).toBe(true);
    expect(result.current.artwork).toBeNull();
    expect(threadIds.at(-1)).toBe(12);

    act(() => result.current.select(0));

    expect(result.current.index).toBe(1);
    expect(playNow).toHaveBeenCalledTimes(1);
  });

  it("changes the pick without playing when the share is not loaded", () => {
    const { result } = roomFor([track(1, 11, true), track(2, 12, true)]);

    expect(result.current.loaded).toBe(false);
    act(() => result.current.select(1));

    expect(result.current.index).toBe(1);
    expect(result.current.entry?.trackAudioId).toBe(12);
    expect(result.current.artwork?.assetPath).toBe("/share/tok/cover/12");
    expect(playNow).not.toHaveBeenCalled();
  });

  it("starts the picked entry, and a timecode starts the share there", () => {
    const { result } = roomFor([track(1, 11, true), track(2, 12, true)]);

    act(() => result.current.select(1));
    act(() => result.current.start());
    expect(playNow.mock.calls[0]?.[1]).toBe(1);

    act(() => result.current.seek(2500));
    expect(playAt).toHaveBeenCalledWith(result.current.entry?.playable, 2.5);
  });

  it("runs the thread on id 0 with no entries", () => {
    const { result } = roomFor([]);

    expect(result.current.entry).toBeUndefined();
    expect(result.current.artwork).toBeNull();
    expect(artProps?.playing).toBeUndefined();
    expect(threadIds.at(-1)).toBe(0);
  });
});

describe("useShareRoom", () => {
  it("throws outside the provider", () => {
    const quiet = console.error;
    console.error = () => {};
    try {
      expect(() => renderHook(() => useShareRoom())).toThrow(
        "ShareRoomProvider"
      );
    } finally {
      console.error = quiet;
    }
  });
});
