import { mock } from "bun:test";

mock.module("server-only", () => ({}));

const { PlayerStoreContext, writeAttribute, writeText } =
  await import("@/components/music-player/player-hooks");
const { ShareRoomContext } = await import("@/components/share/ShareRoom");
const { ShareStickyTransport } =
  await import("@/components/share/ShareStickyTransport");

import type {
  PlayerActions,
  PlayerSnapshot,
  PlayerStore,
} from "@/components/music-player/player-store";
import type { ShareEntry } from "@/components/share/share-playables";
import type { ShareRoom } from "@/components/share/ShareRoom";
import { DEFAULT_LAB } from "@/lib/dsp/lab-settings";
import { CanvasRootProvider } from "@workspace/ui/components/layout/scroll-root";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useRef } from "react";

const togglePlay = mock();
const prev = mock();
const next = mock();
const start = mock();
const select = mock();

function makeStore(isPlaying = false): PlayerStore {
  const snapshot: PlayerSnapshot = {
    current: null,
    upcoming: [],
    isPlaying,
    duration: 120,
    loadError: null,
    prefs: { volume: 1, muted: false, repeat: "off", shuffle: false },
    volumeControllable: true,
    compare: null,
    analyser: null,
    routed: false,
    lab: {
      settings: DEFAULT_LAB,
      phase: "off",
      fraction: 0,
      reason: null,
      source: "original",
      pinned: false,
      bypass: false,
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
      togglePlay,
      prev,
      next,
    } as unknown as PlayerActions,
    setPolicy: () => {},
    restoreQueue: () => {},
    bindMediaSession: () => () => {},
    destroy: () => {},
  };
}

const makeEntry = (id: number, title: string): ShareEntry =>
  ({
    title,
    trackAudioId: id,
    assetId: id + 100,
    peaks: [],
    version: 3,
    createdAt: null,
    durationMs: 120_000,
    playable: { asset: { assetPath: `/media/${id}` } },
  }) as unknown as ShareEntry;

let observerCallback:
  ((entries: Partial<IntersectionObserverEntry>[]) => void) | null = null;
const disconnect = mock();

class FakeObserver {
  constructor(cb: (entries: Partial<IntersectionObserverEntry>[]) => void) {
    observerCallback = cb;
  }
  observe() {}
  disconnect() {
    disconnect();
  }
}

beforeEach(() => {
  void writeAttribute;
  void writeText;
  observerCallback = null;
  togglePlay.mockClear();
  prev.mockClear();
  next.mockClear();
  start.mockClear();
  select.mockClear();
  disconnect.mockClear();
  globalThis.IntersectionObserver =
    FakeObserver as unknown as typeof IntersectionObserver;
});

afterEach(cleanup);

function Harness({ room }: { room: ShareRoom }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <PlayerStoreContext value={makeStore(false)}>
      <ShareRoomContext value={room}>
        <CanvasRootProvider containerRef={ref}>
          <div ref={ref}>
            <ShareStickyTransport />
            <div data-slot={"share-transport"} />
          </div>
        </CanvasRootProvider>
      </ShareRoomContext>
    </PlayerStoreContext>
  );
}

const makeRoom = (over: Partial<ShareRoom> = {}): ShareRoom => {
  const entries = over.entries ?? [makeEntry(1, "Alpha"), makeEntry(2, "Beta")];
  return {
    token: "tok",
    entries,
    index: 0,
    entry: entries[0],
    loaded: false,
    artwork: null,
    select,
    start,
    ...over,
  } as unknown as ShareRoom;
};

describe("ShareStickyTransport", () => {
  it("stays hidden until the masthead transport scrolls above the viewport", () => {
    render(<Harness room={makeRoom()} />);

    expect(
      screen.queryByRole("region", { name: "Playback controls" })
    ).toBeNull();

    // Below the viewport (not yet scrolled past) stays hidden.
    act(() => {
      observerCallback?.([
        {
          isIntersecting: false,
          boundingClientRect: { bottom: 900 } as DOMRectReadOnly,
          rootBounds: { top: 0 } as DOMRectReadOnly,
        },
      ]);
    });
    expect(
      screen.queryByRole("region", { name: "Playback controls" })
    ).toBeNull();

    // Scrolled past above the viewport reveals the mini-transport.
    act(() => {
      observerCallback?.([
        {
          isIntersecting: false,
          boundingClientRect: { bottom: -10 } as DOMRectReadOnly,
          rootBounds: { top: 0 } as DOMRectReadOnly,
        },
      ]);
    });
    expect(
      screen.getByRole("region", { name: "Playback controls" })
    ).toBeTruthy();
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("v3")).toBeTruthy();
  });

  it("wires play, prev, and next controls when visible", () => {
    render(<Harness room={makeRoom({ loaded: true })} />);

    act(() => {
      observerCallback?.([
        {
          isIntersecting: false,
          boundingClientRect: { bottom: -10 } as DOMRectReadOnly,
          rootBounds: { top: 0 } as DOMRectReadOnly,
        },
      ]);
    });

    fireEvent.click(screen.getByRole("button", { name: "Play Alpha" }));
    expect(togglePlay).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(next).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(prev).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("slider", { name: "Seek" })).toBeTruthy();
  });
});
