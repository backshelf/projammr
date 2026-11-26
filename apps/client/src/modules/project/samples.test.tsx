import { beforeEach, describe, expect, mock, test } from "bun:test";
import { render } from "@testing-library/react";
import type {
  SampleSession,
  SampleUsage,
  SessionSummary,
  TrackSummary,
} from "@workspace/api/api";
import type { ComponentProps, ReactElement } from "react";
import { DEFAULT_POLICIES } from "@/lib/policies/policies";

mock.module("server-only", () => ({}));

let policies = DEFAULT_POLICIES;
mock.module("@/lib/policies/server", () => ({
  cachedPolicies: async () => policies,
}));

const getProjectSamples = mock();
const getSampleSessions = mock();
mock.module("@/actions/projects", () => ({
  getProjectPlugins: mock(),
  getProjectSamples,
  getSampleSessions,
}));

const cachedProject = mock();
const cachedSessionSummaries = mock();
const cachedTrackSummaries = mock();
mock.module("@/lib/server-data", () => ({
  cachedProject,
  cachedSessionSummaries,
  cachedTrackSummaries,
}));

mock.module("@/components/layout/Breadcrumbs", () => ({
  Breadcrumbs: () => null,
}));
mock.module("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
  useRouter: () => ({ replace: mock() }),
  usePathname: () => "/project/7/samples",
  useSearchParams: () => new URLSearchParams(),
}));

const { default: SamplesPage } = await import("./samples");
const { InventoryPage } = await import("@/components/inventory/InventoryPage");

const session = (
  id: number,
  name: string,
  trackId: number | null
): SessionSummary => ({
  id,
  name,
  daw: "ableton",
  trackId,
  main: false,
  updatedAt: "2026-09-01T00:00:00.000Z",
  archived: false,
});

const usage = (
  path: string,
  sessionIds: number[],
  extra: Partial<SampleUsage> = {}
): SampleUsage => ({
  path,
  kind: "project",
  sessions: sessionIds.length,
  sessionIds,
  missing: false,
  ...extra,
});

const KICK = "/Users/demo/Samples/Shared Kick.wav";
const USAGE = [
  usage(KICK, [1, 2]),
  usage("/Users/demo/Samples/Lost Hat.wav", [1], { missing: true }),
  usage("/Library/Core/Drums/Core Clap.wav", [1, 2], { kind: "library" }),
];

const OPEN_SESSIONS: SampleSession[] = [
  {
    id: 2,
    name: "Invented Set B",
    daw: "ableton",
    updatedAt: "2026-09-01T00:00:00.000Z",
    trackId: null,
    trackTitle: null,
    status: "present",
  },
];

type Params = Record<string, string | string[] | undefined>;

const pageOf = async (searchParams: Params = {}) =>
  (await SamplesPage({ projectId: 7, searchParams })) as ReactElement<
    ComponentProps<typeof InventoryPage>
  >;

/** The page without its web: the web is an async server component that
 *  streams in on its own, and `webOf` reads what it would draw. */
const renderPage = async (searchParams: Params = {}) =>
  render(
    <InventoryPage {...(await pageOf(searchParams)).props} web={undefined} />
  );

const webOf = async (searchParams: Params = {}) =>
  (await pageOf(searchParams)).props.web;

const rowTexts = (container: HTMLElement) =>
  [...container.querySelectorAll("a")].map((link) => link.textContent ?? "");

beforeEach(() => {
  for (const fn of [
    getProjectSamples,
    getSampleSessions,
    cachedProject,
    cachedSessionSummaries,
    cachedTrackSummaries,
  ]) {
    fn.mockReset();
  }
  cachedProject.mockResolvedValue({ id: 7, name: "Invented Project" });
  getProjectSamples.mockResolvedValue(USAGE);
  cachedSessionSummaries.mockResolvedValue([
    session(1, "Invented Set A", 3),
    session(2, "Invented Set B", null),
  ]);
  cachedTrackSummaries.mockResolvedValue([
    { id: 3, title: "Invented Track" } as TrackSummary,
  ]);
  getSampleSessions.mockResolvedValue(OPEN_SESSIONS);
  policies = DEFAULT_POLICIES;
});

describe("SamplesPage", () => {
  test("states the counts in the lede, Library samples left out by default", async () => {
    const { container } = await renderPage();

    expect(container.textContent).toContain(
      "2 samples across 2 sets · 1 shared by more than one · 1 missing"
    );
    expect(getSampleSessions).not.toHaveBeenCalled();
  });

  test("counts Library samples with ?library=1", async () => {
    const { container } = await renderPage({ library: "1" });

    expect(container.textContent).toContain(
      "3 samples across 2 sets · 2 shared by more than one · 1 missing"
    );
  });

  test("lists only the missing samples on ?show=missing, leaving the lede as it was", async () => {
    const { container } = await renderPage({ show: "missing" });

    expect(rowTexts(container)).toEqual([
      expect.stringContaining("Lost Hat.wav"),
    ]);
    expect(container.textContent).toContain("2 samples across 2 sets");
  });

  test("reads an unknown ?show= as all", async () => {
    const { container } = await renderPage({ show: "everything" });

    expect(rowTexts(container)).toHaveLength(2);
  });

  test("opens a bare URL on the viewer's own defaults, and ?library=0 turns Library off", async () => {
    const samples = DEFAULT_POLICIES.shell.inventoryDefaults.samples;
    policies = {
      ...DEFAULT_POLICIES,
      shell: {
        ...DEFAULT_POLICIES.shell,
        inventoryDefaults: {
          ...DEFAULT_POLICIES.shell.inventoryDefaults,
          samples: { ...samples, show: "missing", library: true },
        },
      },
    };

    const bare = await renderPage();
    expect(bare.container.textContent).toContain(
      "3 samples across 2 sets · 2 shared by more than one · 1 missing"
    );
    expect(rowTexts(bare.container)).toEqual([
      expect.stringContaining("Lost Hat.wav"),
    ]);
    bare.unmount();

    const off = await renderPage({ library: "0", show: "all" });
    expect(off.container.textContent).toContain(
      "2 samples across 2 sets · 1 shared by more than one · 1 missing"
    );
    expect(rowTexts(off.container)).toHaveLength(2);
  });

  test("draws the shared samples and the sets that share them, each set's track as its meta", async () => {
    const web = await webOf();
    const { web: drawing, stock } = await web!.layout();

    expect(drawing.nodes.map((node) => node.id).sort()).toEqual([
      `item:${KICK}`,
      "set:1",
      "set:2",
    ]);
    const first = drawing.nodes.find((node) => node.id === "set:1");
    expect(first?.meta).toBe("Invented Track");
    // The hat only set 1 uses is its own.
    expect(first?.count).toBe("1 sample · +1 own");
    expect(stock).toEqual([]);
    expect(web?.label).toBe(
      "2 samples across 2 sets · 1 shared by more than one · 1 missing"
    );
  });

  test("still draws the sets when the track read fails", async () => {
    cachedTrackSummaries.mockResolvedValue({ error: "boom", code: "internal" });

    const { web } = await (await webOf())!.layout();

    const sets = web.nodes.filter((node) => node.shape === "circle");
    expect(sets).toHaveLength(2);
    expect(sets.every((node) => node.meta === undefined)).toBe(true);
  });

  test("carries ?stock=1 into the web, its control and the rows", async () => {
    const web = await webOf({ stock: "1", show: "missing" });
    expect(web?.stock).toBe(true);
    expect(web?.toggleHref).toBe("/project/7/samples?show=missing");

    const { container } = await renderPage({ stock: "1" });
    const row = [...container.querySelectorAll("a")].find((link) =>
      link.textContent?.includes("Shared Kick.wav")
    );
    expect(row?.getAttribute("href")).toContain("stock=1");
  });

  test("leaves the web out when no set has reported a sample", async () => {
    getProjectSamples.mockResolvedValue([]);

    expect(await webOf()).toBeUndefined();
  });

  test("opens the row ?sample= names and reads its sets", async () => {
    const { container } = await renderPage({ sample: KICK });

    expect(getSampleSessions).toHaveBeenCalledWith(7, KICK);
    expect(rowTexts(container)).toContainEqual(
      expect.stringContaining("Invented Set B")
    );
  });

  test("says what to do when no set has reported a sample", async () => {
    getProjectSamples.mockResolvedValue([]);

    const { container } = await renderPage();

    expect(container.textContent).toContain(
      "No set has reported its samples yet. Scan a project folder to fill this."
    );
  });

  test("says nothing is missing on an empty Missing tab", async () => {
    getProjectSamples.mockResolvedValue([USAGE[0]]);

    const { container } = await renderPage({ show: "missing" });

    expect(container.textContent).toContain("Nothing missing.");
  });

  test("points at the Library toggle when every sample is a Library one", async () => {
    getProjectSamples.mockResolvedValue([USAGE[2]]);

    const { container } = await renderPage();

    expect(container.textContent).toContain(
      "Every sample is in the Library. Turn Library on to see them."
    );
  });
});
