import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const setOpen = mock();
const setView = mock();

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: mock(), replace: mock() }),
  usePathname: () => "/project/1",
  useParams: () => ({ projectId: "1" }),
}));
mock.module("@/components/navigation/AppLink", () => ({
  AppLink: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));
mock.module("@/components/music-player/now-playing-context", () => ({
  NowPlayingProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  useNowPlaying: () => ({
    open: false,
    setOpen,
    view: "player",
    setView,
    fromCover: false,
    coverInSheet: false,
    openFromCover: mock(),
  }),
}));

const { CurrentTrackRow } =
  await import("@/components/music-player/CurrentTrackRow");
const { MiniPlayer } = await import("@/components/music-player/MiniPlayer");
const { MusicPlayer } = await import("@/components/music-player/MusicPlayer");
const { PlayerStoreContext } =
  await import("@/components/music-player/player-hooks");
const { Scrub } = await import("@/components/music-player/Scrub");

import type {
  PlayerActions,
  PlayerSnapshot,
  PlayerStore,
} from "@/components/music-player/player-store";
import type { MusicPlayerTrack } from "@/components/music-player/types";
import { DEFAULT_LAB } from "@/lib/dsp/lab-settings";
import { SidebarProvider } from "@workspace/ui/components/sidebar";
import { TooltipProvider } from "@workspace/ui/components/tooltip";

function makeStore(
  current: MusicPlayerTrack | null,
  speed = 1,
  bypass = false
): PlayerStore {
  const snapshot: PlayerSnapshot = {
    current,
    upcoming: [],
    isPlaying: false,
    duration: 120,
    loadError: null,
    prefs: { volume: 1, muted: false, repeat: "off", shuffle: false },
    volumeControllable: true,
    compare: null,
    analyser: null,
    routed: false,
    lab: {
      settings: { ...DEFAULT_LAB, speed },
      phase: "off",
      fraction: 0,
      reason: null,
      source: "original",
      pinned: false,
      bypass,
      targetLufs: -14,
    },
    bounce: null,
    compareProgress: 0,
  };
  return {
    subscribe: () => () => {},
    getSnapshot: () => snapshot,
    getServerSnapshot: () => snapshot,
    subscribeProgress: () => () => {},
    getProgress: () => 0,
    subscribeLoudness: () => () => {},
    subscribeSpectrum: () => () => {},
    subscribeGr: () => () => {},
    actions: {
      seek: mock(),
      clear: mock(),
      togglePlay: mock(),
      next: mock(),
      prev: mock(),
      toggleShuffle: mock(),
      cycleRepeat: mock(),
      toggleMute: mock(),
      setVolume: mock(),
      setAudition: mock(),
      setSpeed: mock(),
    } as unknown as PlayerActions,
    setPolicy: () => {},
    restoreQueue: () => {},
    bindMediaSession: () => () => {},
    destroy: () => {},
  };
}

const track: MusicPlayerTrack = {
  ownerType: "track",
  ownerId: 10,
  projectId: 1,
  title: "Night Mix",
  metadataResolved: true,
  asset: { id: 5, name: "night.wav", assetPath: "/media/5" },
  trackAudio: { id: 20, version: 4, isPrimary: true, lufs: -11 },
};

function wrap(store: PlayerStore, children: React.ReactNode) {
  return (
    <TooltipProvider>
      <SidebarProvider defaultOpen={false}>
        <PlayerStoreContext value={store}>{children}</PlayerStoreContext>
      </SidebarProvider>
    </TooltipProvider>
  );
}

beforeEach(() => {
  setOpen.mockClear();
  setView.mockClear();
});

afterEach(cleanup);

describe("MusicPlayer", () => {
  it("hides the detached card when idle and renders w-64 when playing", () => {
    const { container, rerender } = render(
      wrap(makeStore(null), <MusicPlayer />)
    );
    expect(container.querySelector("[data-bare]")).toBeNull();
    expect(screen.queryByText("Nothing playing")).toBeNull();

    rerender(wrap(makeStore(track), <MusicPlayer />));
    const card = container.querySelector("[data-bare]") as HTMLElement;
    expect(card).toBeTruthy();
    expect(card.className).toContain("w-64");
  });

  it("renders a clickable LAB indicator when Lab is altering sound", () => {
    render(wrap(makeStore(track, 1.25, false), <MusicPlayer />));

    const labButton = screen.getByRole("button", {
      name: "Lab active, open Lab",
    });
    expect(labButton.className).toContain("bg-art");

    fireEvent.click(labButton);
    expect(setView).toHaveBeenCalledWith("lab");
    expect(setOpen).toHaveBeenCalledWith(true);
  });

  it("hides the LAB indicator when Lab is bypassed", () => {
    render(wrap(makeStore(track, 1.25, true), <MusicPlayer />));
    expect(
      screen.queryByRole("button", { name: "Lab active, open Lab" })
    ).toBeNull();
  });
});

describe("MiniPlayer", () => {
  it("renders a clickable LAB indicator when Lab is altering sound", () => {
    render(wrap(makeStore(track, 1.25, false), <MiniPlayer />));

    const labButton = screen.getByRole("button", {
      name: "Lab active, open Lab",
    });
    fireEvent.click(labButton);
    expect(setView).toHaveBeenCalledWith("lab");
    expect(setOpen).toHaveBeenCalledWith(true);
  });
});

describe("CurrentTrackRow", () => {
  it("displays the active VersionBadge when trackAudio.version exists", () => {
    render(<CurrentTrackRow track={track} />);
    expect(screen.getByText("Night Mix")).toBeTruthy();
    expect(screen.getByText("v4")).toBeTruthy();
  });
});

describe("Scrub card geometry", () => {
  it("uses a 20px hit area and renders a hover thumb", () => {
    render(wrap(makeStore(track), <Scrub size="card" />));
    const slider = screen.getByRole("slider", { name: "Seek" });
    expect(slider.className).toContain("h-5");
    expect(slider.querySelector(".bg-art.shadow-float")).toBeTruthy();
  });
});
