import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

mock.module("server-only", () => ({}));
mock.module("@/components/lab/SpeedPitch", () => ({
  SpeedPitch: () => <div data-testid="speed-pitch" />,
}));
mock.module("@/components/lab/RackEq", () => ({
  RackEq: () => <div data-testid="rack-eq" />,
}));
mock.module("@/components/lab/RackComp", () => ({
  RackComp: () => <div data-testid="rack-comp" />,
}));
mock.module("@/components/lab/RackReverb", () => ({
  RackReverb: () => <div data-testid="rack-reverb" />,
}));
mock.module("@/components/lab/Auditions", () => ({
  Auditions: () => <div data-testid="auditions" />,
}));
mock.module("@/components/lab/MatchEq", () => ({
  MatchEq: () => <div data-testid="match-eq" />,
}));
mock.module("@/components/lab/Bounce", () => ({
  Bounce: () => <div data-testid="bounce" />,
}));

const { LabView } = await import("@/components/lab/LabView");
const { PlayerStoreContext } =
  await import("@/components/music-player/player-hooks");

import type {
  PlayerActions,
  PlayerSnapshot,
  PlayerStore,
} from "@/components/music-player/player-store";
import type { MusicPlayerTrack } from "@/components/music-player/types";
import { DEFAULT_LAB, type LabSettings } from "@/lib/dsp/lab-settings";

const setLabBypass = mock();
const resetLab = mock();

function makeStore(
  settings: LabSettings = DEFAULT_LAB,
  bypass = false
): PlayerStore {
  const snapshot: PlayerSnapshot = {
    current: track,
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
      settings,
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
      setLabBypass,
      resetLab,
    } as unknown as PlayerActions,
    setPolicy: () => {},
    restoreQueue: () => {},
    bindMediaSession: () => () => {},
    destroy: () => {},
  };
}

const track = {
  ownerType: "track",
  ownerId: 1,
  metadataResolved: true,
  asset: { id: 1, name: "demo.wav", assetPath: "/media/1" },
  trackAudio: { id: 10, version: 1, isPrimary: true, lufs: -12 },
} as MusicPlayerTrack;

beforeEach(() => {
  setLabBypass.mockClear();
  resetLab.mockClear();
});

afterEach(cleanup);

describe("LabView", () => {
  it("toggles bypass on click and on pressing b outside inputs", () => {
    render(
      <PlayerStoreContext value={makeStore()}>
        <LabView current={track} audios={null} />
      </PlayerStoreContext>
    );

    const bypass = screen.getByRole("button", { name: /Bypass/i });
    fireEvent.click(bypass);
    expect(setLabBypass).toHaveBeenCalledWith(true);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "b" }));
    expect(setLabBypass).toHaveBeenCalledTimes(2);
    expect(setLabBypass).toHaveBeenLastCalledWith(true);
  });

  it("ignores b keydown when typing in an input", () => {
    render(
      <PlayerStoreContext value={makeStore()}>
        <div>
          <input aria-label="freq" />
          <LabView current={track} audios={null} />
        </div>
      </PlayerStoreContext>
    );

    const input = screen.getByLabelText("freq");
    fireEvent.keyDown(input, { key: "b" });
    expect(setLabBypass).not.toHaveBeenCalled();
  });

  it("disables Reset all at defaults and calls resetLab when dirty or bypassed", () => {
    const { rerender } = render(
      <PlayerStoreContext value={makeStore()}>
        <LabView current={track} audios={null} />
      </PlayerStoreContext>
    );
    const reset = screen.getByRole("button", { name: "Reset all" });
    expect(reset.hasAttribute("disabled")).toBe(true);

    rerender(
      <PlayerStoreContext
        value={makeStore({ ...DEFAULT_LAB, speed: 1.25 }, false)}
      >
        <LabView current={track} audios={null} />
      </PlayerStoreContext>
    );
    expect(reset.hasAttribute("disabled")).toBe(false);

    fireEvent.click(reset);
    expect(resetLab).toHaveBeenCalledTimes(1);
  });
});
