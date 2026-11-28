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
import type { ReactNode } from "react";
import { SpectrogramStrip } from "./SpectrogramStrip";

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

describe("SpectrogramStrip", () => {
  it("supports expand toggle (h-24 -> h-44), renders log Hz ticks, and shows studio hover readout", () => {
    render(
      <SpectrogramStrip
        spectrogramKey="analysis/spec.png"
        durationSeconds={120}
        getSeconds={() => 0}
        onSeek={mock()}
      />,
      { wrapper: Wrapper }
    );

    const slider = screen.getByRole("slider", {
      name: "Seek to a position in spectrogram",
    });
    expect(slider.className).toContain("h-24");

    for (const tick of ["50", "200", "1k", "4k", "16k"]) {
      expect(screen.getByText(tick)).toBeTruthy();
    }

    const expandBtn = screen.getByRole("button", { name: "Expand" });
    fireEvent.click(expandBtn);
    expect(slider.className).toContain("h-44");
    expect(screen.getByRole("button", { name: "Collapse" })).toBeTruthy();

    Object.defineProperty(slider, "getBoundingClientRect", {
      value: () => ({ left: 0, width: 200, top: 0, height: 176 }),
    });
    fireEvent.pointerMove(slider, {
      pointerType: "mouse",
      clientX: 100,
      clientY: 88,
    });
    expect(screen.getByText(/1:00\.0 · .* Hz \(.*\) · −80\.0 dB/)).toBeTruthy();
  });
});
