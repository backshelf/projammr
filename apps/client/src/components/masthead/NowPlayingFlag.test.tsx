import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import type { MusicPlayerTrack } from "@/components/music-player/types";

let mockCurrent: MusicPlayerTrack | null = null;
let mockPlaying = false;

mock.module("@/components/music-player/player-hooks", () => ({
  useCurrentTrack: () => mockCurrent,
  useIsPlaying: () => mockPlaying,
}));

mock.module("@/components/navigation/AppLink", () => ({
  AppLink: ({ href, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props} />
  ),
}));

const { NowPlayingFlag } = await import("./NowPlayingFlag");

afterEach(() => {
  cleanup();
  mockCurrent = null;
  mockPlaying = false;
});

const TRACK: MusicPlayerTrack = {
  asset: {
    id: 1,
    name: "render.wav",
    assetPath: "audio/render.wav",
  },
  ownerType: "track",
  ownerId: 42,
  title: "Midnight Run",
  collectionId: 9,
  artists: [],
};

describe("NowPlayingFlag", () => {
  it("renders nothing when another track is loaded", () => {
    mockCurrent = TRACK;
    mockPlaying = true;
    const { container } = render(
      <NowPlayingFlag owner={{ kind: "track", id: 99 }} projectId={3} />
    );
    expect(container.textContent).toBe("");
  });

  it("renders a quiet playing indicator with an art dot when playing", () => {
    mockCurrent = TRACK;
    mockPlaying = true;
    const { container } = render(
      <NowPlayingFlag owner={{ kind: "track", id: 42 }} projectId={3} />
    );
    expect(screen.getByText("Playing")).toBeTruthy();
    expect(container.querySelector(".bg-art")).not.toBeNull();
    expect(container.querySelector('[data-slot="status-chip"]')).toBeNull();
  });

  it("renders plain ink without the art dot when paused", () => {
    mockCurrent = TRACK;
    mockPlaying = false;
    const { container } = render(
      <NowPlayingFlag owner={{ kind: "track", id: 42 }} projectId={3} />
    );
    expect(screen.getByText("Paused")).toBeTruthy();
    expect(container.querySelector(".bg-art")).toBeNull();
  });

  it("links to the playing track inside a collection", () => {
    mockCurrent = TRACK;
    mockPlaying = true;
    render(
      <NowPlayingFlag owner={{ kind: "collection", id: 9 }} projectId={3} />
    );
    const link = screen.getByRole("link", { name: /Playing · Midnight Run/ });
    expect(link.getAttribute("href")).toBe("/project/3/collection/9/track/42");
  });
});
