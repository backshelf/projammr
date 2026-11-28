import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import { PlayerStoreContext } from "@/components/music-player/player-hooks";
import type {
  PlayerActions,
  PlayerSnapshot,
  PlayerStore,
} from "@/components/music-player/player-store";
import type { MusicPlayerTrack } from "@/components/music-player/types";
import { TrackWaveform } from "@/components/track/TrackWaveform";
import { DEFAULT_POLICIES } from "@/lib/policies/policies";
import { PoliciesProvider } from "@/lib/policies/provider";
import type { ReactNode } from "react";

let currentAssetId: number | null = null;
const playAt = mock();
const seek = mock();

function createMockStore(): PlayerStore {
  const snapshot = (): PlayerSnapshot =>
    ({
      current: currentAssetId
        ? {
            title: "Nightfall",
            artists: ["Alex"],
            asset: { id: currentAssetId, name: "n.wav", assetPath: "a/n.wav" },
            ownerId: 1,
            ownerType: "track",
          }
        : null,
      upcoming: [],
      isPlaying: false,
      duration: currentAssetId ? 120 : 0,
      loadError: null,
      prefs: { volume: 1, muted: false, shuffle: false, repeat: "off" },
      volumeControllable: true,
      compare: null,
      compareProgress: 0,
      analyser: null,
      routed: false,
      lab: { phase: "idle", settings: {}, targetLufs: -14 },
      bounce: null,
    }) as unknown as PlayerSnapshot;

  return {
    subscribe: () => () => {},
    getSnapshot: snapshot,
    getServerSnapshot: snapshot,
    getProgress: () => 0,
    subscribeProgress: () => () => {},
    actions: { playAt, seek } as unknown as PlayerActions,
  } as unknown as PlayerStore;
}

const TRACK: MusicPlayerTrack = {
  title: "Nightfall",
  artists: ["Alex"],
  asset: { id: 10, name: "nightfall.wav", assetPath: "audio/10.wav" },
  ownerId: 1,
  ownerType: "track",
};

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <PoliciesProvider policies={DEFAULT_POLICIES}>
      <PlayerStoreContext value={createMockStore()}>
        {children}
      </PlayerStoreContext>
    </PoliciesProvider>
  );
}

afterEach(() => {
  cleanup();
  currentAssetId = null;
  playAt.mockClear();
  seek.mockClear();
});

describe("TrackWaveform", () => {
  it("renders comment pins on IdleWave and seeks-and-plays from clicked timestamp", () => {
    const onMarkerClick = mock();
    render(
      <TrackWaveform
        assetId={10}
        playerTrack={TRACK}
        peaks={[0.2, 0.5, 0.8, 0.4]}
        durationSeconds={120}
        commentMarks={[
          { id: 42, positionMs: 30_000, author: "Sam", excerpt: "Snare" },
        ]}
        onMarkerClick={onMarkerClick}
      />,
      { wrapper: Wrapper }
    );

    const pin = screen.getByRole("button", {
      name: "Comment by Sam at 0:30",
    });
    fireEvent.click(pin);
    expect(onMarkerClick).toHaveBeenCalledWith([42]);

    const waveBtn = screen.getByRole("button", {
      name: "Play Nightfall from the waveform",
    });
    Object.defineProperty(waveBtn, "getBoundingClientRect", {
      value: () => ({ left: 0, width: 200, top: 0, height: 80 }),
    });
    fireEvent.click(waveBtn, { clientX: 50, detail: 1 });
    expect(playAt).toHaveBeenCalledWith(TRACK, 30);
  });

  it("seeks on ActiveWave click", () => {
    currentAssetId = 10;
    render(
      <TrackWaveform
        assetId={10}
        playerTrack={TRACK}
        peaks={[0.2, 0.5, 0.8, 0.4]}
        durationSeconds={120}
      />,
      { wrapper: Wrapper }
    );

    const slider = screen.getByRole("slider", { name: "Seek" });
    Object.defineProperty(slider, "getBoundingClientRect", {
      value: () => ({ left: 0, width: 200, top: 0, height: 80 }),
    });
    fireEvent.click(slider, { clientX: 100, detail: 1 });
    expect(seek).toHaveBeenCalledWith(60);
  });
});
