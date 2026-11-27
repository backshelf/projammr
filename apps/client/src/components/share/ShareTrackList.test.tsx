import { afterEach, describe, expect, it, mock } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import type { ShareEntry } from "@/components/share/share-playables";
import type { ShareRoom } from "@/components/share/ShareRoom";

let isPlaying = false;
const select = mock();

const currentAssetIdStub = () => null;
const isPlayingStub = () => isPlaying;
const playerActionsStub = () => ({});
const commentThreadStub = () => ({});

mock.module("server-only", () => ({}));
mock.module("@/components/music-player/player-hooks", () => ({
  useCurrentAssetId: currentAssetIdStub,
  useIsPlaying: isPlayingStub,
  usePlayerActions: playerActionsStub,
}));
mock.module("@/components/art/ArtProvider", () => ({
  ArtProvider: ({ children }: PropsWithChildren) => <div>{children}</div>,
}));
mock.module("@/components/track-audio/AudioCommentSection", () => ({
  useCommentThread: commentThreadStub,
}));

const { ShareTrackList } = await import("./ShareTrackList");
const { ShareRoomContext } = await import("./ShareRoom");

const entry = (id: number, title: string): ShareEntry =>
  ({
    title,
    trackAudioId: id,
    assetId: id + 100,
    version: 2,
    durationMs: 125_000,
  }) as unknown as ShareEntry;

const renderList = (entries: ShareEntry[], over: Partial<ShareRoom> = {}) => {
  const room = {
    entries,
    index: 0,
    loaded: false,
    artwork: null,
    select,
    ...over,
  } as unknown as ShareRoom;
  return render(
    <ShareRoomContext value={room}>
      <ShareTrackList />
    </ShareRoomContext>
  );
};

afterEach(() => {
  cleanup();
  isPlaying = false;
  select.mockClear();
});

describe("ShareTrackList", () => {
  it("draws nothing for a share of one track", () => {
    const { container } = renderList([entry(1, "Only")]);

    expect(container.textContent).toBe("");
  });

  it("lists every track with its version and length under a counted heading", () => {
    renderList([entry(1, "First"), entry(2, "Second")]);

    expect(screen.getByRole("heading", { name: "Tracks , 2" })).toBeTruthy();
    expect(screen.getByText("First")).toBeTruthy();
    expect(screen.getByText("Second")).toBeTruthy();
    expect(screen.getAllByText("v2")).toHaveLength(2);
    expect(screen.getAllByText("2:05")).toHaveLength(2);
  });

  it("marks only the current row and selects the row that is clicked", () => {
    renderList([entry(1, "First"), entry(2, "Second")], { index: 1 });

    const rows = screen.getAllByRole("button");
    expect(rows[0]?.getAttribute("aria-current")).toBeNull();
    expect(rows[1]?.getAttribute("aria-current")).toBe("true");

    fireEvent.click(rows[0]!);
    expect(select).toHaveBeenCalledWith(0);
  });

  it("swaps the current row's number for the volume mark while its audio plays", () => {
    isPlaying = true;
    renderList([entry(1, "First"), entry(2, "Second")], { loaded: true });

    const [current, other] = screen.getAllByRole("button");
    expect(current?.textContent).not.toContain("1");
    expect(other?.textContent).toContain("2");
  });

  it("shows a coarse-pointer play glyph on idle rows while keeping track numbers and fine hover swap", () => {
    isPlaying = true;
    renderList([entry(1, "First"), entry(2, "Second")], { loaded: true });

    const [playingRow, idleRow] = screen.getAllByRole("button");
    expect(playingRow?.querySelector('[data-slot="coarse-play"]')).toBeNull();

    const coarsePlay = idleRow?.querySelector('[data-slot="coarse-play"]');
    expect(coarsePlay).toBeTruthy();
    expect(coarsePlay?.getAttribute("class")).toContain("coarse:inline-block");
    expect(coarsePlay?.getAttribute("class")).toContain("hidden");
    expect(idleRow?.textContent).toContain("2");
    expect(
      idleRow?.querySelector(".fine\\:group-hover\\/row\\:block")
    ).toBeTruthy();
  });

  it("renders durations with tabular numerals", () => {
    renderList([entry(1, "First"), entry(2, "Second")]);

    for (const duration of screen.getAllByText("2:05")) {
      expect(duration.className).toContain("tabular-nums");
    }
  });
});
