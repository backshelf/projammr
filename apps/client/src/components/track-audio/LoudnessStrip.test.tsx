import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import { PlayerStoreContext } from "@/components/music-player/player-hooks";
import type {
  PlayerActions,
  PlayerSnapshot,
  PlayerStore,
} from "@/components/music-player/player-store";
import { DEFAULT_POLICIES } from "@/lib/policies/policies";
import { PoliciesProvider } from "@/lib/policies/provider";
import type { ClippedBin } from "@workspace/dsp/offline";
import type { ReactNode } from "react";

const mockClipping: ClippedBin[] = [
  { binIndex: 100, samples: 1, over: true },
  { binIndex: 200, samples: 5, over: true },
];

mock.module("@/components/track-audio/measures", () => ({
  useTrackAudioMeasure: (_id: number | null, measure: string) =>
    measure === "clipping" ? mockClipping : null,
  useTrackAudioDiff: () => null,
}));

const { LoudnessStrip } = await import("./LoudnessStrip");

function createMockStore(): PlayerStore {
  const snapshot = (): PlayerSnapshot =>
    ({
      current: null,
      upcoming: [],
      isPlaying: false,
      duration: 0,
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
    actions: {} as PlayerActions,
  } as unknown as PlayerStore;
}

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <PoliciesProvider policies={DEFAULT_POLICIES}>
      <PlayerStoreContext value={createMockStore()}>
        {children}
      </PlayerStoreContext>
    </PoliciesProvider>
  );
}

afterEach(cleanup);

describe("LoudnessStrip", () => {
  it("renders gridlines, clipping ticks, and hover LUFS inspector", () => {
    const onSeek = mock();
    const { container } = render(
      <LoudnessStrip
        trackAudioId={1}
        curve={[-16, -8.4, -12]}
        durationSeconds={120}
        getSeconds={() => 0}
        onSeek={onSeek}
      />,
      { wrapper: Wrapper }
    );

    const slider = screen.getByRole("slider", {
      name: "Seek to a position in loudness",
    });
    expect(slider.className).toContain("h-14");

    // Reference + grid stops (−6, −14, −24)
    expect(screen.getByText("−6")).toBeTruthy();
    expect(screen.getByText("−14")).toBeTruthy();
    expect(screen.getByText("−24")).toBeTruthy();

    // Clipping ticks (--warn for TP>0, --danger for hard clip >= 3 samples)
    expect(container.querySelector(".bg-warn")).toBeTruthy();
    expect(container.querySelector(".bg-danger")).toBeTruthy();

    // Hover inspector at midpoint (second 1 -> −8.4 LUFS, +5.6 vs −14)
    Object.defineProperty(slider, "getBoundingClientRect", {
      value: () => ({ left: 0, width: 100, top: 0, height: 56 }),
    });
    fireEvent.pointerMove(slider, {
      pointerType: "mouse",
      clientX: 50,
      clientY: 20,
    });
    expect(screen.getByText(/−8\.4 LUFS \(\+5\.6 vs −14\)/)).toBeTruthy();
  });
});
