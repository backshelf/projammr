import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import * as clientApi from "@/lib/client-api";
import { CopyTextProvider } from "@/components/copy-text/CopyTextProvider";
import { fromCommitHref } from "@/components/track-audio/version-rows";
import { DEFAULT_POLICIES } from "@/lib/policies/policies";
import { PoliciesProvider } from "@/lib/policies/provider";
import type {
  GetSession,
  GetTrack,
  Repo,
  SampleUsage,
  Session,
  SessionCommit,
  SessionSave,
} from "@workspace/api/api";
import { TooltipProvider } from "@workspace/ui/components/tooltip";
import type { ReactNode } from "react";

let currentSearch = "";
const replaceCalls: string[] = [];
const routerPush = mock();
const routerRefresh = mock();

function createSearchParams() {
  return new URLSearchParams(currentSearch);
}

mock.module("next/navigation", () => ({
  useRouter: () => ({
    replace: (href: string) => {
      replaceCalls.push(href);
      const qIdx = href.indexOf("?");
      currentSearch = qIdx >= 0 ? href.slice(qIdx + 1) : "";
    },
    push: routerPush,
    refresh: routerRefresh,
  }),
  usePathname: () => "/project/5/track/10",
  useSearchParams: () => createSearchParams(),
}));

mock.module("@/components/navigation/AppLink", () => ({
  AppLink: ({
    href,
    children,
    ...props
  }: React.ComponentProps<"a"> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

mock.module("@/components/deep-link/DeepLinkProvider", () => ({
  useOpenDeepLink: () => mock(),
}));

mock.module("@/components/session/OpenInDawButton", () => ({
  OpenInDawButton: () => <button type="button">Open in DAW</button>,
}));

mock.module("@/components/product-linking/pickers", () => ({
  SessionPicker: ({ trackId }: { trackId: number }) => (
    <div data-testid="session-picker">SessionPicker:{trackId}</div>
  ),
}));

const setSessionMainMock = mock(async () => ({ ok: true }));
mock.module("@/actions/sessions", () => ({
  setSessionMain: setSessionMainMock,
}));

const sessionPatchMock = mock(async () => ({ id: 812 }));
const sessionRemoveMock = mock(async () => ({ ok: true }));
mock.module("@/entities/api", () => ({
  ENTITY_API: {
    session: {
      patch: sessionPatchMock,
      remove: sessionRemoveMock,
    },
  },
}));

mock.module("sonner", () => ({
  toast: Object.assign(mock(), { error: mock(), success: mock() }),
}));

const BASE_SESSION_ROW: Session = {
  id: 812,
  projectId: 5,
  trackId: 10,
  name: "Midnight_v4.als",
  daw: "ableton",
  dawName: "Ableton Live",
  dawVersion: "Live 12.1",
  dawCapabilities: [
    "tempo",
    "key",
    "timeSignature",
    "structure",
    "samplePaths",
  ],
  main: true,
  tempo: "128",
  timeSignature: "4/4",
  rootNote: "C#",
  scale: "Minor",
  tracksCount: 14,
  scenesCount: 4,
  localFilepath: "/sets/Midnight_v4.als",
  localFileMachineName: "Studio Mac",
  localFileCreatedAt: "2026-09-01T10:00:00Z",
  localFileUpdatedAt: "2026-09-14T10:00:00Z",
  inboxDismissedAt: null,
  fingerprint: null,
  repoId: 3,
  ditSetId: "set-1",
  currentBranchId: 1,
  priorityId: 1,
  createdAt: "2026-09-01T10:00:00Z",
  updatedAt: "2026-09-14T10:00:00Z",
} as unknown as Session;

const SESSION_DETAIL: GetSession = {
  ...BASE_SESSION_ROW,
  priority: { id: 1, name: "Normal", colour: "ink", rank: 1, isDefault: true },
  track: null,
  attachments: [],
  comments: [],
  labels: [],
  artwork: null,
  repoName: "midnight-repo",
  openOn: null,
  notes: null,
  notesText: null,
  structure: {
    tracks: [
      { kind: "audio", name: "1 Drums", devices: ["EQ Eight"] },
      { kind: "midi", name: "2 Lead", devices: ["Serum 2"] },
    ],
    plugins: {
      "Serum 2": { manufacturer: "Xfer Records", host: "vst3" },
    },
  },
  samples: [
    {
      path: "/Samples/kick.wav",
      kind: "project",
      status: "present",
      held: true,
      object: "obj-1",
    },
  ],
  saveCount: 3,
  history: {
    commits: 1,
    saves: 3,
    timeInSet: 3600,
    contentRetentionDays: 30,
  },
  archived: false,
} as unknown as GetSession;

const SAVE_COLLIDING_ID_41: SessionSave = {
  id: 41,
  sessionId: 812,
  projectId: 5,
  fileUpdatedAt: "2026-09-10T10:00:00.000Z",
  machineName: "Laptop",
  source: "scan",
  branch: "main",
  hash: "hash-41",
  contentState: "held",
  meta: {
    tempo: "110",
    timeSignature: "4/4",
    rootNote: "A",
    scale: "Minor",
    tracksCount: 2,
    scenesCount: 1,
    dawVersion: "Live 12.0",
    samplePaths: [],
    structure: {
      tracks: [{ kind: "audio", name: "Old Drums", devices: [] }],
    },
  },
} as unknown as SessionSave;

const SAVE_80: SessionSave = {
  id: 80,
  sessionId: 812,
  projectId: 5,
  fileUpdatedAt: "2026-09-12T10:00:00.000Z",
  machineName: "Studio Mac",
  source: "scan",
  branch: "main",
  hash: "hash-80",
  contentState: "held",
  meta: {
    tempo: "120",
    timeSignature: "4/4",
    rootNote: "C#",
    scale: "Minor",
    tracksCount: 8,
    scenesCount: 2,
    dawVersion: "Live 12.1",
    samplePaths: [],
    structure: {
      tracks: [{ kind: "audio", name: "1 Drums", devices: ["EQ Eight"] }],
    },
  },
} as unknown as SessionSave;

const SAVE_90: SessionSave = {
  id: 90,
  sessionId: 812,
  projectId: 5,
  fileUpdatedAt: "2026-09-14T10:00:00.000Z",
  machineName: "Studio Mac",
  source: "commit",
  branch: "main",
  hash: "hash-90",
  contentState: "held",
  meta: {
    tempo: "128",
    timeSignature: "4/4",
    rootNote: "C#",
    scale: "Minor",
    tracksCount: 14,
    scenesCount: 4,
    dawVersion: "Live 12.1",
    samplePaths: ["/Samples/kick.wav"],
    structure: {
      tracks: [
        { kind: "audio", name: "1 Drums", devices: ["EQ Eight"] },
        { kind: "midi", name: "2 Strings", devices: ["Serum 2"] },
      ],
    },
  },
} as unknown as SessionSave;

let mockSaves: SessionSave[] = [SAVE_90, SAVE_80, SAVE_COLLIDING_ID_41];

const MOCK_COMMITS: SessionCommit[] = [
  {
    id: 41,
    hash: "deadbeef1234",
    parentHash: null,
    saveHash: "hash-90",
    branch: "main",
    kind: "user",
    message: "added strings",
    committedAt: "2026-09-14T10:05:00.000Z",
    authorName: "Alex",
    machineName: "Studio Mac",
    saves: [SAVE_90],
    samplesReferenced: 0,
    samplesHeld: 0,
    timeInSet: null,
  } as unknown as SessionCommit,
];

const MOCK_REPOS: Repo[] = [
  {
    id: 3,
    projectId: 5,
    name: "midnight-repo",
    storage: { setBytes: 2048, sampleBytes: 4096 },
    lastPush: null,
  } as unknown as Repo,
];

const MOCK_SAMPLES: SampleUsage[] = [
  {
    path: "/Samples/kick.wav",
    kind: "project",
    sessionsCount: 1,
    trackIds: [10],
  } as unknown as SampleUsage,
];

const getTrackSessionsMock = mock(async () => [BASE_SESSION_ROW]);
const getTrackReposMock = mock(async () => MOCK_REPOS);
const getSessionMock = mock(async () => SESSION_DETAIL);
const getSessionPresenceMock = mock(async () => []);
const getSessionSavesMock = mock(async () => mockSaves);
const getSessionCommitsMock = mock(async () => MOCK_COMMITS);
const getProjectSamplesMock = mock(async () => MOCK_SAMPLES);

mock.module("@/lib/client-api", () => ({
  ...clientApi,
  clientGetTrackSessions: getTrackSessionsMock,
  clientGetTrackRepos: getTrackReposMock,
  clientGetSession: getSessionMock,
  clientGetSessionPresence: getSessionPresenceMock,
  clientGetSessionSaves: getSessionSavesMock,
  clientGetSessionCommits: getSessionCommitsMock,
  clientGetProjectSamples: getProjectSamplesMock,
}));

const { TrackStudioDrawer } = await import("./TrackStudioDrawer");

const STUDIO_PROP: GetTrack["studio"] = {
  sessionCount: 1,
  commitCount: 1,
  saveCount: 3,
  lastSaveAt: "2026-09-14T10:00:00.000Z",
  openOn: null,
  openSessionId: null,
  mainSession: {
    id: 812,
    name: "Midnight_v4.als",
    daw: "ableton",
    dawName: "Ableton Live",
    dawVersion: "Live 12.1",
    repoId: 3,
    main: true,
  },
};

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <PoliciesProvider policies={DEFAULT_POLICIES}>
      <CopyTextProvider>
        <TooltipProvider>{children}</TooltipProvider>
      </CopyTextProvider>
    </PoliciesProvider>
  );
}

function renderDrawer(
  over: {
    search?: string;
    canEdit?: boolean;
    studio?: GetTrack["studio"];
  } = {}
) {
  currentSearch = over.search ?? "";
  return render(
    <TrackStudioDrawer
      projectId={5}
      trackId={10}
      trackTitle="Nightfall"
      studio={over.studio ?? STUDIO_PROP}
      canEdit={over.canEdit ?? true}
      viewerId="u1"
    />,
    { wrapper: Wrapper }
  );
}

afterEach(() => {
  cleanup();
  currentSearch = "";
  replaceCalls.length = 0;
  mockSaves = [SAVE_90, SAVE_80, SAVE_COLLIDING_ID_41];
  getTrackSessionsMock.mockClear();
  getTrackReposMock.mockClear();
  getSessionMock.mockClear();
  getSessionPresenceMock.mockClear();
  getSessionSavesMock.mockClear();
  getSessionCommitsMock.mockClear();
  getProjectSamplesMock.mockClear();
  setSessionMainMock.mockClear();
  sessionPatchMock.mockClear();
  sessionRemoveMock.mockClear();
  routerPush.mockClear();
  routerRefresh.mockClear();
});

describe("TrackStudioDrawer", () => {
  it("performs zero client fetches while closed", () => {
    renderDrawer({ search: "" });

    expect(screen.queryByText("STUDIO / DAW")).toBeNull();
    expect(getTrackSessionsMock).not.toHaveBeenCalled();
    expect(getTrackReposMock).not.toHaveBeenCalled();
    expect(getSessionMock).not.toHaveBeenCalled();
    expect(getSessionPresenceMock).not.toHaveBeenCalled();
    expect(getSessionSavesMock).not.toHaveBeenCalled();
    expect(getSessionCommitsMock).not.toHaveBeenCalled();
    expect(getProjectSamplesMock).not.toHaveBeenCalled();
  });

  it("opens on overview with the w shortcut outside editable inputs", () => {
    const { container } = render(
      <div>
        <input aria-label="Track note" />
        <TrackStudioDrawer
          projectId={5}
          trackId={10}
          trackTitle="Nightfall"
          studio={STUDIO_PROP}
          canEdit={true}
          viewerId="u1"
        />
      </div>,
      { wrapper: Wrapper }
    );

    const input = container.querySelector("input")!;
    fireEvent.keyDown(input, { key: "w" });
    expect(replaceCalls).toEqual([]);

    fireEvent.keyDown(window, { key: "w" });
    expect(replaceCalls).toEqual([
      "/project/5/track/10?studio=overview&session=812",
    ]);
  });

  it("renders overview metadata, repository, and ?standalone=1 escape hatch", async () => {
    renderDrawer({ search: "studio=overview&session=812" });

    await waitFor(() => {
      expect(screen.getByText("128 BPM")).toBeTruthy();
    });
    expect(screen.getByText("C# Minor")).toBeTruthy();
    expect(screen.getByText("4/4")).toBeTruthy();
    expect(screen.getByText("14")).toBeTruthy();
    expect(screen.getByText("REPOSITORY")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Session actions" }));
    const standaloneLink = await screen.findByRole("menuitem", {
      name: /Open full session page/,
    });
    expect(standaloneLink.getAttribute("href")).toBe(
      "/project/5/track/10/session/812?standalone=1"
    );
  });

  it("does not duplicate saves/commits fetches when switching overview -> history or opening history directly", async () => {
    const { rerender } = renderDrawer({
      search: "studio=overview&session=812",
    });

    await waitFor(() => {
      expect(getSessionMock).toHaveBeenCalledTimes(1);
    });
    expect(getSessionSavesMock).toHaveBeenCalledTimes(1);
    expect(getSessionSavesMock).toHaveBeenCalledWith(812, 8);
    expect(getSessionCommitsMock).toHaveBeenCalledTimes(1);

    currentSearch = "studio=history&session=812";
    await act(async () => {
      rerender(
        <TrackStudioDrawer
          projectId={5}
          trackId={10}
          trackTitle="Nightfall"
          studio={STUDIO_PROP}
          canEdit={true}
          viewerId="u1"
        />
      );
    });

    await waitFor(() => {
      expect(getSessionSavesMock).toHaveBeenCalledTimes(2);
    });
    expect(getSessionSavesMock).toHaveBeenLastCalledWith(812, 500);
    expect(getSessionCommitsMock).toHaveBeenCalledTimes(2);
    // Session detail & presence must not re-fetch on tab switch.
    expect(getSessionMock).toHaveBeenCalledTimes(1);
    expect(getSessionPresenceMock).toHaveBeenCalledTimes(1);
  });

  it("resolves fromCommitHref to=<saveId> to the commit's save even when commit.id collides with another save", async () => {
    const href = fromCommitHref(
      {
        saveId: 90,
        sessionId: 812,
        savedAt: "2026-09-14T10:00:00.000Z",
        commit: {
          id: 41,
          message: "added strings",
          committedAt: "2026-09-14T10:05:00.000Z",
          branch: "main",
          kind: "user",
        },
      },
      { projectId: 5, trackId: 10 }
    );
    expect(href).toBe("/project/5/track/10?studio=history&session=812&to=90");
    const search = href!.split("?")[1]!;

    renderDrawer({ search });

    await waitFor(() => {
      expect(screen.getByText("COMPARING")).toBeTruthy();
    });
    // Must compare save 90 (2 Strings, 14 tracks), NOT save 41 (Old Drums).
    expect(screen.getAllByText(/2 Strings/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Old Drums/)).toBeNull();
    // Opening directly on history must issue only one saves/commits fetch.
    expect(getSessionSavesMock).toHaveBeenCalledTimes(1);
    expect(getSessionCommitsMock).toHaveBeenCalledTimes(1);
  });

  it("resolves fromCommitHref to=<saveId> when no save shares commit.id", async () => {
    mockSaves = [SAVE_90, SAVE_80];
    renderDrawer({ search: "studio=history&session=812&to=90" });

    await waitFor(() => {
      expect(screen.getByText("COMPARING")).toBeTruthy();
    });
    expect(screen.getAllByText(/2 Strings/).length).toBeGreaterThan(0);
  });

  it("lazy-loads project samples on Gear & Samples tab", async () => {
    renderDrawer({ search: "studio=gear&session=812" });

    await waitFor(() => {
      expect(getProjectSamplesMock).toHaveBeenCalledWith(5);
    });
    expect(screen.getByText("Serum 2")).toBeTruthy();
    expect(screen.getByText("1 built-in device")).toBeTruthy();
  });

  it("gates editing actions for viewers while keeping standalone navigation", async () => {
    renderDrawer({ search: "studio=overview&session=812", canEdit: false });

    await waitFor(() => {
      expect(screen.getByText("Main set")).toBeTruthy();
    });
    expect(
      screen.queryByRole("button", { name: /Make main|Main set/ })
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Session actions" }));
    const standaloneLink = await screen.findByRole("menuitem", {
      name: /Open full session page/,
    });
    expect(standaloneLink.getAttribute("href")).toBe(
      "/project/5/track/10/session/812?standalone=1"
    );
    expect(screen.queryByText("Edit set details")).toBeNull();
    expect(screen.queryByText("Unlink from this track")).toBeNull();
    expect(screen.queryByText("Delete session")).toBeNull();
  });

  it("does not render previous session's saves or commits while new session's saves load", async () => {
    const session813: GetSession = {
      ...SESSION_DETAIL,
      id: 813,
      name: "Sunrise_v1.als",
      main: false,
      tempo: "100",
      rootNote: "F",
      scale: "Major",
      tracksCount: 2,
      structure: {
        tracks: [{ kind: "audio", name: "Sunrise Pad", devices: [] }],
      },
      samples: [],
      saveCount: 1,
      history: {
        commits: 1,
        saves: 1,
        timeInSet: 600,
        contentRetentionDays: 30,
      },
    } as unknown as GetSession;

    const save813: SessionSave = {
      id: 913,
      sessionId: 813,
      projectId: 5,
      fileUpdatedAt: "2026-09-15T10:00:00.000Z",
      machineName: "Studio Mac",
      source: "scan",
      branch: "main",
      hash: "hash-913",
      contentState: "held",
      meta: {
        tempo: "100",
        timeSignature: "4/4",
        rootNote: "F",
        scale: "Major",
        tracksCount: 1,
        scenesCount: 1,
        dawVersion: "Live 12.1",
        samplePaths: [],
        structure: {
          tracks: [{ kind: "audio", name: "Sunrise Pad", devices: [] }],
        },
      },
    } as unknown as SessionSave;

    const commit813: SessionCommit = {
      ...MOCK_COMMITS[0]!,
      id: 99,
      saveHash: "hash-913",
      message: "sunrise init",
      saves: [save813],
    } as unknown as SessionCommit;

    let resolveSaves813!: (rows: SessionSave[]) => void;
    let resolveCommits813!: (rows: SessionCommit[]) => void;

    getTrackSessionsMock.mockImplementationOnce(async () => [
      BASE_SESSION_ROW,
      { ...BASE_SESSION_ROW, id: 813, name: "Sunrise_v1.als", main: false },
    ]);
    getSessionMock.mockImplementation(async (id?: number) =>
      id === 813 ? session813 : SESSION_DETAIL
    );
    getSessionSavesMock.mockImplementation(async (id?: number) => {
      if (id === 813) {
        return new Promise<SessionSave[]>((resolve) => {
          resolveSaves813 = resolve;
        });
      }
      return mockSaves;
    });
    getSessionCommitsMock.mockImplementation(async (id?: number) => {
      if (id === 813) {
        return new Promise<SessionCommit[]>((resolve) => {
          resolveCommits813 = resolve;
        });
      }
      return MOCK_COMMITS;
    });

    try {
      const { rerender } = renderDrawer({
        search: "studio=overview&session=812",
      });

      await waitFor(() => {
        expect(screen.getByText("128 BPM")).toBeTruthy();
      });
      // Session 812 has commit 41 and 2 Lead vs SAVE_90's 2 Strings.
      expect(
        screen.getByRole("link", { name: "Download set" }).getAttribute("href")
      ).toBe("/api/commits/41/set");

      // Switch to session 813 while its saves/commits are still pending.
      currentSearch = "studio=overview&session=813";
      await act(async () => {
        rerender(
          <TrackStudioDrawer
            projectId={5}
            trackId={10}
            trackTitle="Nightfall"
            studio={STUDIO_PROP}
            canEdit={true}
            viewerId="u1"
          />
        );
      });

      await waitFor(() => {
        expect(screen.getByText("100 BPM")).toBeTruthy();
      });

      // Must NOT leak session 812's commit 41 or session 812's save timestamp/diff!
      expect(screen.queryByRole("link", { name: "Download set" })).toBeNull();
      // Session 812's SAVE_90 had "2 Strings" in previous save; must not appear as
      // "removed" diff against 813's structure.
      expect(screen.queryByText(/2 Strings/)).toBeNull();

      await act(async () => {
        resolveSaves813([save813]);
        resolveCommits813([commit813]);
      });

      await waitFor(() => {
        expect(
          screen
            .getByRole("link", { name: "Download set" })
            .getAttribute("href")
        ).toBe("/api/commits/99/set");
      });
    } finally {
      getTrackSessionsMock.mockImplementation(async () => [BASE_SESSION_ROW]);
      getSessionMock.mockImplementation(async () => SESSION_DETAIL);
      getSessionSavesMock.mockImplementation(async () => mockSaves);
      getSessionCommitsMock.mockImplementation(async () => MOCK_COMMITS);
    }
  });
});
