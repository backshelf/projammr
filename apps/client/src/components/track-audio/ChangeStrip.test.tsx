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
import { ChangeStrip } from "./ChangeStrip";

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

describe("ChangeStrip", () => {
  it("renders vs vN, alignment badge, hotspot jump chips, and loudnessDelta hover readout", () => {
    const onSeek = mock();
    render(
      <ChangeStrip
        vsVersion={2}
        aligned
        offsetMs={1200}
        change={[0.05, 0.7, 0.8, 0.1]}
        loudnessDelta={[0.1, 2.3, -1.1, 0]}
        summary={{
          changedShare: 0.5,
          loudestChange: { startMs: 1000, endMs: 3000 },
        }}
        durationSeconds={4}
        getSeconds={() => 0}
        onSeek={onSeek}
      />,
      { wrapper: Wrapper }
    );

    expect(screen.getByText("Change · vs v2")).toBeTruthy();
    expect(screen.getByText("aligned +1.2s")).toBeTruthy();

    const jumpBtn = screen.getByRole("button", { name: "0:01–0:03" });
    fireEvent.click(jumpBtn);
    expect(onSeek).toHaveBeenCalledWith(1);

    const slider = screen.getByRole("slider", {
      name: "Seek to a position in change · vs v2",
    });
    expect(slider.className).toContain("h-9");
    Object.defineProperty(slider, "getBoundingClientRect", {
      value: () => ({ left: 0, width: 100, top: 0, height: 36 }),
    });
    fireEvent.pointerMove(slider, {
      pointerType: "mouse",
      clientX: 30,
      clientY: 18,
    });
    expect(screen.getByText(/70% changed · \+2\.3 LU/)).toBeTruthy();
  });
});
