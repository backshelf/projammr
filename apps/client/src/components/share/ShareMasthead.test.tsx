import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import type { Sharelink } from "@workspace/api/api";
import type { ShareEntry } from "@/components/share/share-playables";
import type { ShareRoom } from "@/components/share/ShareRoom";

const retry = mock();
const togglePlay = mock();
const start = mock();
const jumpToComment = mock();
let loadError: { assetId: number; message: string } | null = null;
let isPlaying = false;

const currentAssetIdStub = () => null;
const durationStub = () => 0;
const isPlayingStub = () => isPlaying;
const loadErrorStub = () => loadError;
const playerActionsStub = () => ({ retry, togglePlay });
const progressFramesStub = () => {};
const commentThreadStub = () => ({});
const mastheadScrollStub = () => undefined;

mock.module("server-only", () => ({}));
mock.module("@/components/music-player/player-hooks", () => ({
  useCurrentAssetId: currentAssetIdStub,
  useDuration: durationStub,
  useIsPlaying: isPlayingStub,
  useLoadError: loadErrorStub,
  usePlayerActions: playerActionsStub,
  useProgressFrames: progressFramesStub,
  writeAttribute: () => {},
  writeText: () => {},
}));
mock.module("@/components/music-player/PlayerControls", () => ({
  Transport: ({ size }: { size: string }) => (
    <div data-testid={"transport"} data-size={size} />
  ),
  SecondaryControls: {
    Volume: ({ size }: { size: string }) => (
      <div data-testid={"volume"} data-size={size} />
    ),
  },
}));
mock.module("@/components/track/TrackWaveform", () => ({
  TrackWaveform: ({ assetId }: { assetId: number }) => (
    <div data-testid={"wave"} data-asset-id={assetId} />
  ),
}));
mock.module("@/components/art/ArtProvider", () => ({
  ArtProvider: ({ children }: PropsWithChildren) => <div>{children}</div>,
}));
mock.module("@/components/track-audio/AudioCommentSection", () => ({
  useCommentThread: commentThreadStub,
}));
mock.module("@/components/motion/masthead-scroll", () => ({
  useMastheadScroll: mastheadScrollStub,
}));

const { ShareMasthead } = await import("./ShareMasthead");
const { ShareRoomContext } = await import("./ShareRoom");

const entry = (assetId: number, title: string): ShareEntry =>
  ({
    title,
    trackAudioId: assetId - 100,
    assetId,
    peaks: [],
    version: 2,
    createdAt: null,
    durationMs: 125_000,
    playable: { asset: { assetPath: `/media/${assetId}?token=t` } },
  }) as unknown as ShareEntry;

const sharelink = (over: Partial<Sharelink> = {}): Sharelink =>
  ({
    entityType: "collection",
    title: "Demo Reel",
    description: null,
    isDownloadsEnabled: false,
    tracks: [
      { trackAudio: { id: 1, durationMs: 60_000 } },
      { trackAudio: { id: 2, durationMs: 65_000 } },
    ],
    ...over,
  }) as Sharelink;

const renderMasthead = (over: Partial<ShareRoom> = {}) => {
  const entries = over.entries ?? [entry(101, "First"), entry(102, "Second")];
  const room = {
    token: "tok",
    sharelink: sharelink(),
    viewerId: null,
    entries,
    index: 0,
    entry: entries[0],
    loaded: false,
    artwork: null,
    select: mock(),
    start,
    seek: mock(),
    jumpToComment,
    thread: { commentMarks: [] },
    ...over,
  } as unknown as ShareRoom;
  return render(
    <ShareRoomContext value={room}>
      <ShareMasthead />
    </ShareRoomContext>
  );
};

beforeEach(() => {
  loadError = null;
  isPlaying = false;
  retry.mockClear();
  togglePlay.mockClear();
  start.mockClear();
});
afterEach(cleanup);

describe("ShareMasthead", () => {
  it("says there is nothing to play, and draws no wave, when the share has no entries", () => {
    renderMasthead({ entries: [], entry: undefined });

    expect(screen.getByText("Nothing to play yet.")).toBeTruthy();
    expect(screen.queryByTestId("wave")).toBeNull();
  });

  it("shows the facts line as the eyebrow and the title as the heading", () => {
    renderMasthead();

    expect(screen.getByText(/^Shared collection · 2 tracks/)).toBeTruthy();
    expect(
      screen.getByRole("heading", { level: 1, name: "Demo Reel" })
    ).toBeTruthy();
  });

  it("shows the current asset's load error in the wave's slot and retries on Try again", () => {
    loadError = { assetId: 101, message: "decode failed" };
    renderMasthead();

    expect(
      screen.getByText("This audio can't be played right now.")
    ).toBeTruthy();
    expect(screen.queryByTestId("wave")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("ignores a load error for an asset that is not the current entry's", () => {
    loadError = { assetId: 999, message: "decode failed" };
    renderMasthead();

    expect(screen.getByTestId("wave").dataset.assetId).toBe("101");
    expect(
      screen.queryByText("This audio can't be played right now.")
    ).toBeNull();
  });

  it("shows the full transport for a loaded share with more than one entry", () => {
    renderMasthead({ loaded: true });

    expect(screen.getByTestId("transport").dataset.size).toBe("full");
    expect(screen.queryByRole("button", { name: /^Play / })).toBeNull();
  });

  it("shows the hero play button for a single entry and starts the share from it", () => {
    const entries = [entry(101, "Only")];
    renderMasthead({ entries, entry: entries[0], loaded: true });

    expect(screen.queryByTestId("transport")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Play Only" }));
    expect(togglePlay).toHaveBeenCalledTimes(1);
    expect(start).not.toHaveBeenCalled();
  });

  it("starts the share from the hero button before it is the loaded queue", () => {
    renderMasthead({ loaded: false });

    fireEvent.click(screen.getByRole("button", { name: "Play First" }));
    expect(start).toHaveBeenCalledTimes(1);
    expect(togglePlay).not.toHaveBeenCalled();
  });

  it("keeps the on-art text classes off without artwork", () => {
    const { container } = renderMasthead({
      sharelink: sharelink({ description: "Rough mixes." }),
    });

    expect(container.querySelector(".on-art, .on-art-soft")).toBeNull();
  });

  it("offers the download link only when the share allows downloads", () => {
    const { unmount } = renderMasthead();
    expect(screen.queryByText(/^Download /)).toBeNull();
    unmount();

    renderMasthead({ sharelink: sharelink({ isDownloadsEnabled: true }) });
    expect(
      screen.getByText("Download First").closest("a")?.getAttribute("href")
    ).toBe("/media/101?token=t&download");
  });

  it("shows the active track title in the header only when there are multiple entries", () => {
    const { unmount } = renderMasthead();
    expect(screen.getByText("First")).toBeTruthy();
    unmount();

    const single = [entry(101, "Only")];
    renderMasthead({ entries: single, entry: single[0] });
    expect(screen.queryByText("Only")).toBeNull();
  });

  it("renders a desktop-only volume control and stacks waveform above transport on phone", () => {
    const { container } = renderMasthead({ loaded: true });

    const vol = screen.getByTestId("volume");
    expect(vol.parentElement?.className).toContain("phone:hidden");

    const row = container.querySelector('[data-slot="share-transport"]');
    expect(row?.className).toContain("phone:flex-col");
  });
});
