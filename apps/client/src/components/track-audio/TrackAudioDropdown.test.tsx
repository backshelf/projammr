import { ProjectProvider } from "@/hooks/use-project-role";
import type { TrackAudioWithAsset } from "@workspace/api/api";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import type { ReactNode } from "react";

const setPrimaryTrackAudio = mock(async () => ({ ok: true as const }));
mock.module("@/actions/track-audios", () => ({
  getCandidateAudios: mock(async () => []),
  linkTrackAudios: mock(async () => ({ analysisJobIds: [] })),
  unlinkTrackAudio: mock(async () => ({ ok: true as const })),
  setPrimaryTrackAudio,
}));
mock.module("sonner", () => ({ toast: { success: mock(), error: mock() } }));
mock.module("@workspace/ui/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

const { TrackAudioDropdown } = await import("./TrackAudioDropdown");

const makeAudio = (
  over: Partial<TrackAudioWithAsset> = {}
): TrackAudioWithAsset =>
  ({
    id: 1,
    trackId: 10,
    assetId: 100,
    version: 1,
    isPrimary: true,
    primaryPinned: false,
    lufs: -14.2,
    truePeakDb: -1.0,
    durationMs: 120_000,
    duplicateOfId: null,
    bouncedFrom: null,
    asset: {
      id: 100,
      name: "mix-v1.wav",
      createdAt: "2026-09-01T10:00:00.000Z",
      localFileCreatedAt: null,
    },
    ...over,
  }) as unknown as TrackAudioWithAsset;

const AUDIOS: TrackAudioWithAsset[] = [
  makeAudio({
    id: 2,
    version: 2,
    isPrimary: false,
    primaryPinned: false,
    asset: {
      id: 101,
      name: "mix-v2.wav",
      createdAt: "2026-09-02T10:00:00.000Z",
      localFileCreatedAt: null,
    } as TrackAudioWithAsset["asset"],
  }),
  makeAudio({
    id: 1,
    version: 1,
    isPrimary: true,
    primaryPinned: true,
  }),
];

function wrapRole(role: "viewer" | "editor") {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <ProjectProvider project={{ id: 1, name: "Demo", role }}>
        {children}
      </ProjectProvider>
    );
  };
}

afterEach(() => {
  cleanup();
  setPrimaryTrackAudio.mockClear();
});

describe("TrackAudioDropdown", () => {
  it("hides primary star promotion controls from viewers while showing Pinned state", async () => {
    render(
      <TrackAudioDropdown
        audios={AUDIOS}
        selectedAudioId={1}
        onSelect={() => {}}
      >
        <button type="button">Choose version</button>
      </TrackAudioDropdown>,
      { wrapper: wrapRole("viewer") }
    );

    fireEvent.click(screen.getByRole("button", { name: "Choose version" }));

    expect(await screen.findByText("mix-v1.wav")).toBeTruthy();
    expect(screen.getByText("Pinned")).toBeTruthy();
    expect(
      screen.queryByRole("menuitem", { name: /Make v2 the primary version/ })
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Make v2 the primary version/ })
    ).toBeNull();
  });

  it("renders editor primary star controls as sibling menuitems without nested buttons", async () => {
    render(
      <TrackAudioDropdown
        audios={AUDIOS}
        selectedAudioId={1}
        onSelect={() => {}}
        onManage={() => {}}
      >
        <button type="button">Choose version</button>
      </TrackAudioDropdown>,
      { wrapper: wrapRole("editor") }
    );

    fireEvent.click(screen.getByRole("button", { name: "Choose version" }));

    const promoteItem = await screen.findByRole("menuitem", {
      name: "Make v2 the primary version",
    });
    expect(promoteItem).toBeTruthy();
    // No nested <button> inside any role="menuitem".
    for (const item of screen.getAllByRole("menuitem")) {
      expect(item.querySelector("button")).toBeNull();
    }
    expect(
      screen.getByRole("menuitem", { name: "Manage track audios…" })
    ).toBeTruthy();
  });
});
