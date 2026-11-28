import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import { PlayerStoreContext } from "@/components/music-player/player-hooks";
import type {
  PlayerActions,
  PlayerSnapshot,
  PlayerStore,
} from "@/components/music-player/player-store";
import { DEFAULT_POLICIES } from "@/lib/policies/policies";
import { PoliciesProvider } from "@/lib/policies/provider";
import { TooltipProvider } from "@workspace/ui/components/tooltip";
import { stubGlobal, unstubAllGlobals } from "@workspace/test/globals";
import type { ComponentProps } from "react";
import type { TrackAudioDiff } from "@workspace/api/api";

const getMeasure = mock(async (_id: number, measure: string) =>
  measure === "clipping" ? [] : [-18, -14, -12]
);
const getDiff = mock(
  async (fromId: number, toId: number): Promise<TrackAudioDiff> => ({
    fromId,
    toId,
    aligned: true,
    offsetMs: 0,
    analysisVersion: 1,
    change: [0.1, 0.4, 0.8],
    loudnessDelta: [0, 0.5, -0.5],
    summary: {
      changedSeconds: 12,
      changedShare: 0.42,
      loudestChange: { startMs: 1000, endMs: 2000 },
    },
  })
);

mock.module("@/components/jobs/JobsProvider", () => ({
  JobsProvider: ({ children }: { children: unknown }) => children,
  useJobsFinish: () => {},
  useJobsDrain: () => {},
  useJob: () => undefined,
  useJobsLoaded: () => true,
}));
mock.module("@/lib/client-api", () => ({
  clientGetTrackAudioMeasure: getMeasure,
  clientGetTrackAudioDiff: getDiff,
}));

const { MeasureStack } = await import("./MeasureStack");

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

function stubViewport(phone: boolean) {
  stubGlobal("innerWidth", phone ? 390 : 1280);
  stubGlobal("matchMedia", () => ({
    matches: phone,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

afterEach(() => {
  cleanup();
  unstubAllGlobals();
  getMeasure.mockClear();
  getDiff.mockClear();
});

const defaultProps = (
  overrides: Partial<ComponentProps<typeof MeasureStack>> = {}
): ComponentProps<typeof MeasureStack> => ({
  trackAudioId: 101,
  previousAudioId: 100,
  previousVersion: 1,
  durationSeconds: 180,
  spectrogramKey: "spec/101.png",
  selectedIds: ["loudness", "spectrogram", "change"],
  onToggle: mock(),
  onClear: mock(),
  getSeconds: () => 0,
  onSeek: mock(),
  live: false,
  ...overrides,
});

function renderStack(
  overrides: Partial<ComponentProps<typeof MeasureStack>> = {}
) {
  const props = defaultProps(overrides);
  const result = render(
    <PoliciesProvider policies={DEFAULT_POLICIES}>
      <PlayerStoreContext value={createMockStore()}>
        <TooltipProvider>
          <MeasureStack {...props} />
        </TooltipProvider>
      </PlayerStoreContext>
    </PoliciesProvider>
  );
  return { ...result, props };
}

describe("MeasureStack", () => {
  it("preserves desktop multi-strip legend and renders all selected strips", async () => {
    stubViewport(false);
    const { props } = renderStack({ trackAudioId: 201, previousAudioId: 200 });

    await screen.findByRole("slider", { name: /loudness/i });
    await screen.findByRole("slider", { name: /change/i });
    expect(screen.getByRole("slider", { name: /spectrogram/i })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Strips" })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Analysis strip" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Spectrogram" }));
    expect(props.onToggle).toHaveBeenCalledWith("spectrogram");
  });

  it("hides unavailable strips (like Change on v1) from the desktop legend", async () => {
    stubViewport(false);
    renderStack({
      trackAudioId: 202,
      previousAudioId: null,
      spectrogramKey: "spec/202.png",
    });

    await screen.findByRole("slider", { name: /loudness/i });
    const legend = screen.getByRole("group", { name: "Strips" });
    expect(
      Array.from(legend.querySelectorAll("button")).map((b) => b.textContent)
    ).toEqual(["Loudness", "Spectrogram"]);
  });

  it("defaults phones to one active strip with a compact switcher using Spectrogram", async () => {
    stubViewport(true);
    const { props } = renderStack({ trackAudioId: 301, previousAudioId: 300 });

    await screen.findByRole("slider", { name: /loudness/i });

    expect(screen.getAllByRole("slider")).toHaveLength(1);
    expect(screen.queryByRole("slider", { name: /spectrogram/i })).toBeNull();
    expect(screen.queryByRole("slider", { name: /change/i })).toBeNull();
    expect(getDiff).not.toHaveBeenCalled();

    const switcher = screen.getByRole("group", { name: "Analysis strip" });
    expect(
      Array.from(switcher.querySelectorAll("button")).map((b) => b.textContent)
    ).toEqual(["Loudness", "Spectrogram", "Changes"]);

    fireEvent.click(screen.getByRole("button", { name: "Spectrogram" }));
    expect(screen.getByRole("slider", { name: /spectrogram/i })).toBeTruthy();
    expect(screen.queryByRole("slider", { name: /loudness/i })).toBeNull();
    expect(props.onToggle).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Changes" }));
    await screen.findByRole("slider", { name: /change/i });
    expect(screen.getAllByRole("slider")).toHaveLength(1);
    expect(getDiff).toHaveBeenCalledWith(300, 301);
  });

  it("allows deselecting the active strip back to [] on phone even with only 1 available strip", async () => {
    stubViewport(true);
    const { props } = renderStack({
      trackAudioId: 402,
      previousAudioId: null,
      spectrogramKey: null,
      selectedIds: ["loudness"],
    });

    await screen.findByRole("slider", { name: /loudness/i });
    const switcher = screen.getByRole("group", { name: "Analysis strip" });
    expect(
      Array.from(switcher.querySelectorAll("button")).map((b) => b.textContent)
    ).toEqual(["Loudness"]);

    fireEvent.click(screen.getByRole("button", { name: "Loudness" }));
    expect(props.onClear).toHaveBeenCalledTimes(1);
  });

  it("only offers strips available for the track on phone", async () => {
    stubViewport(true);
    renderStack({
      trackAudioId: 401,
      previousAudioId: null,
      spectrogramKey: "spec/401.png",
    });

    await screen.findByRole("slider", { name: /loudness/i });
    const switcher = screen.getByRole("group", { name: "Analysis strip" });
    expect(
      Array.from(switcher.querySelectorAll("button")).map((b) => b.textContent)
    ).toEqual(["Loudness", "Spectrogram"]);
  });

  it("falls back to an available strip when the active phone strip disappears", async () => {
    stubViewport(true);
    const props = defaultProps({ trackAudioId: 501, previousAudioId: 500 });
    const { rerender } = render(
      <PoliciesProvider policies={DEFAULT_POLICIES}>
        <PlayerStoreContext value={createMockStore()}>
          <TooltipProvider>
            <MeasureStack {...props} />
          </TooltipProvider>
        </PlayerStoreContext>
      </PoliciesProvider>
    );

    await screen.findByRole("slider", { name: /loudness/i });
    fireEvent.click(screen.getByRole("button", { name: "Changes" }));
    await screen.findByRole("slider", { name: /change/i });

    await act(async () => {
      rerender(
        <PoliciesProvider policies={DEFAULT_POLICIES}>
          <PlayerStoreContext value={createMockStore()}>
            <TooltipProvider>
              <MeasureStack {...props} previousAudioId={null} />
            </TooltipProvider>
          </PlayerStoreContext>
        </PoliciesProvider>
      );
    });

    await screen.findByRole("slider", { name: /loudness/i });
    expect(screen.queryByRole("slider", { name: /change/i })).toBeNull();
  });
});
