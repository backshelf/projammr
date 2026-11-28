import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import * as clientApi from "@/lib/client-api";
import type { CommentBackend } from "@/components/comments/comment-backend";
import { PlayerStoreContext } from "@/components/music-player/player-hooks";
import type {
  PlayerActions,
  PlayerSnapshot,
  PlayerStore,
} from "@/components/music-player/player-store";
import { ProjectProvider } from "@/hooks/use-project-role";
import { DEFAULT_POLICIES } from "@/lib/policies/policies";
import { policiesFrom } from "@/lib/policies/from-settings";
import { PoliciesProvider } from "@/lib/policies/provider";
import { effectiveSettings } from "@/lib/settings/effective";
import { SettingsProvider } from "@/lib/settings/provider";
import type { TrackAudioWithAsset } from "@workspace/api/api";
import { TooltipProvider } from "@workspace/ui/components/tooltip";
import type { ReactNode } from "react";

mock.module("@/actions/assets", () => ({
  attachAssetTo: mock(),
  deleteAsset: mock(async () => ({ ok: true })),
}));
mock.module("@/actions/track-audios", () => ({
  getCandidateAudios: mock(async () => []),
  linkTrackAudios: mock(async () => ({ analysisJobIds: [] })),
  unlinkTrackAudio: mock(async () => ({ ok: true })),
  setPrimaryTrackAudio: mock(async () => ({ ok: true })),
  unpinPrimaryTrackAudio: mock(async () => ({ ok: true })),
}));
mock.module("@/actions/comments", () => ({
  createComment: mock(),
  deleteComment: mock(),
  getCommentsForTarget: mock(),
  reopenComment: mock(),
  resolveComment: mock(),
  updateComment: mock(),
}));

const playAt = mock();
const endCompare = mock();
const playNext = mock();
const enqueue = mock();

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
    actions: {
      playAt,
      endCompare,
      playNext,
      enqueue,
      playNow: mock(),
      seek: mock(),
    } as unknown as PlayerActions,
  } as unknown as PlayerStore;
}

const makeAudio = (
  over: Partial<TrackAudioWithAsset> = {}
): TrackAudioWithAsset =>
  ({
    id: 1,
    trackId: 10,
    assetId: 100,
    version: 1,
    isPrimary: true,
    primaryPinned: true,
    lufs: -8.7,
    truePeakDb: 0.4,
    durationMs: 120_000,
    duplicateOfId: null,
    spectrogramKey: "spec/1.png",
    bouncedFrom: {
      saveId: 90,
      sessionId: 812,
      savedAt: "2026-09-14T10:00:00.000Z",
      commit: {
        id: 41,
        message: "fix to track names",
        committedAt: "2026-09-14T10:05:00.000Z",
        branch: "main",
        kind: "user",
      },
    },
    analysisVersion: 5,
    asset: {
      id: 100,
      projectId: 5,
      name: "mix-v1.flac",
      assetPath: "audio/100.flac",
      createdAt: "2026-09-01T10:00:00.000Z",
      localFileCreatedAt: null,
    },
    ...over,
  }) as unknown as TrackAudioWithAsset;

const AUDIO = makeAudio();
let selectedAudio = AUDIO;

mock.module("@/components/track-audio/TrackAudioContext", () => ({
  useTrackAudio: () => ({
    audios: [selectedAudio],
    primaryAudio: selectedAudio,
    selected: selectedAudio,
    setSelectedAudioId: mock(),
    comments: [{ id: 1, resolvedAt: "2026-09-02T00:00:00Z" }],
    commentMarks: [],
    reloadComments: mock(),
    registerScrollTarget: mock(),
    scrollToComment: mock(),
    commentsOpen: false,
    setCommentsOpen: mock(),
  }),
}));

mock.module("@/lib/client-api", () => ({
  ...clientApi,
  clientGetTrackAudioMeasure: mock(async (_id: number, measure: string) =>
    measure === "clipping" ? [] : [-14, -12, -10]
  ),
  clientGetTrackAudioDiff: mock(async () => null),
}));

const { CommentBackendProvider } =
  await import("@/components/comments/comment-backend");
const { TrackAudioSection } = await import("./TrackAudioSection");

const commentBackend = {
  list: mock(),
  create: mock(),
  update: mock(),
  remove: mock(),
} as unknown as CommentBackend;

function Wrapper({ children }: { children: ReactNode }) {
  const initial = effectiveSettings({}, "v1");
  return (
    <ProjectProvider project={{ id: 5, name: "Demo", role: "editor" }}>
      <SettingsProvider initial={initial} userId="u1">
        <PoliciesProvider
          policies={{ ...DEFAULT_POLICIES, ...policiesFrom(initial.values) }}
        >
          <PlayerStoreContext value={createMockStore()}>
            <CommentBackendProvider backend={commentBackend}>
              <TooltipProvider>{children}</TooltipProvider>
            </CommentBackendProvider>
          </PlayerStoreContext>
        </PoliciesProvider>
      </SettingsProvider>
    </ProjectProvider>
  );
}

afterEach(() => {
  cleanup();
  selectedAudio = AUDIO;
  playAt.mockClear();
  endCompare.mockClear();
  playNext.mockClear();
  enqueue.mockClear();
});

describe("TrackAudioSection", () => {
  it("hides strips behind the Analysis disclosure by default and opens via HeightReveal", () => {
    render(<TrackAudioSection trackId={10} title="Nightfall" artists={[]} />, {
      wrapper: Wrapper,
    });

    const analysisButton = screen.getByRole("button", { name: /analysis/i });
    expect(analysisButton.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("group", { name: "Strips" })).toBeNull();

    fireEvent.click(analysisButton);
    expect(analysisButton.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("group", { name: "Strips" })).toBeTruthy();
  });

  it("renders a decluttered 2-zone version bar without redundant Pinned chip or Unpin button", () => {
    render(<TrackAudioSection trackId={10} title="Nightfall" artists={[]} />, {
      wrapper: Wrapper,
    });

    expect(screen.queryByText("Pinned")).toBeNull();
    expect(screen.queryByRole("button", { name: "Unpin" })).toBeNull();
    expect(screen.getByRole("img", { name: "Pinned as primary" })).toBeTruthy();

    const versionTrigger = screen.getByRole("button", {
      name: /Choose a version/,
    });
    expect(versionTrigger.getAttribute("aria-label")).toBe(
      "v1 mix-v1.flac — Choose a version"
    );
    expect(versionTrigger.textContent).toBe("v1 mix-v1.flac");

    // True peak > 0 gets --warn tint.
    const tp = screen.getByText(/\+0\.4 dB/);
    expect(tp.className).toContain("text-warn");

    // Compact FromCommitLink targets the Studio drawer URL.
    const commitLink = screen.getByRole("link", {
      name: "from commit 'fix to track names'",
    });
    expect(commitLink.getAttribute("href")).toBe(
      "/project/5/track/10?studio=history&session=812&to=90"
    );

    // Resolved comment pill uses singular grammar without "All 1".
    expect(
      screen.getByRole("button", { name: "1 resolved on v1" }).textContent
    ).toContain("1 resolved");

    // Overflow menu exposes Play next, Add to queue, Download, Manage versions…
    fireEvent.click(
      screen.getByRole("button", { name: "More version actions" })
    );
    expect(screen.getByRole("menuitem", { name: "Play next" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Add to queue" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Download" })).toBeTruthy();
    expect(
      screen.getByRole("menuitem", { name: "Manage versions…" })
    ).toBeTruthy();
  });

  it("keeps visible version trigger text aligned with aria-label when version is missing", () => {
    selectedAudio = makeAudio({ version: undefined });
    render(<TrackAudioSection trackId={10} title="Nightfall" artists={[]} />, {
      wrapper: Wrapper,
    });

    const versionTrigger = screen.getByRole("button", {
      name: /Choose a version/,
    });
    expect(versionTrigger.getAttribute("aria-label")).toBe(
      "— mix-v1.flac — Choose a version"
    );
    expect(versionTrigger.textContent).toBe("— mix-v1.flac");
  });
});
