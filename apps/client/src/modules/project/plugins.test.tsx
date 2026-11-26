import { beforeEach, describe, expect, mock, test } from "bun:test";
import { render } from "@testing-library/react";
import type {
  PluginSession,
  PluginUsage,
  SessionSummary,
  TrackSummary,
} from "@workspace/api/api";
import type { ComponentProps, ReactElement } from "react";
import { DEFAULT_POLICIES } from "@/lib/policies/policies";

mock.module("server-only", () => ({}));

mock.module("@/lib/policies/server", () => ({
  cachedPolicies: async () => DEFAULT_POLICIES,
}));

const getProjectPlugins = mock();
const getPluginSessions = mock();
mock.module("@/actions/projects", () => ({
  getProjectPlugins,
  getPluginSessions,
  getProjectSamples: mock(),
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
  usePathname: () => "/project/7/plugins",
  useSearchParams: () => new URLSearchParams(),
}));

const { default: PluginsPage } = await import("./plugins");
const { InventoryPage } = await import("@/components/inventory/InventoryPage");

const session = (id: number): SessionSummary => ({
  id,
  name: `Invented Set ${id}`,
  daw: "ableton",
  trackId: id === 1 ? 3 : null,
  main: false,
  updatedAt: "2026-09-01T00:00:00.000Z",
  archived: false,
});

const device = (
  name: string,
  sessionIds: number[],
  extra: Partial<PluginUsage> = {}
): PluginUsage => ({
  name,
  sessions: sessionIds.length,
  tracks: sessionIds.length,
  sessionIds,
  sessionTracks: sessionIds.map(() => 1),
  origin: "builtin",
  ...extra,
});

// Ten sets: all carry Echo (the stock chain), and neighbouring pairs share a
// third-party device of their own.
const SESSIONS = Array.from({ length: 10 }, (_, i) => session(i + 1));
const USAGE = [
  device(
    "Echo",
    SESSIONS.map((s) => s.id)
  ),
  ...Array.from({ length: 5 }, (_, i) =>
    device(`Invented Verb ${i + 1}`, [2 * i + 1, 2 * i + 2], {
      origin: "plugin",
      host: "vst3",
      sessionTracks: [3, 1],
    })
  ),
];

type Params = Record<string, string | string[] | undefined>;

const pageOf = async (searchParams: Params = {}) =>
  (await PluginsPage({ projectId: 7, searchParams })) as ReactElement<
    ComponentProps<typeof InventoryPage>
  >;

const webOf = async (searchParams: Params = {}) =>
  (await pageOf(searchParams)).props.web;

beforeEach(() => {
  for (const fn of [
    getProjectPlugins,
    getPluginSessions,
    cachedProject,
    cachedSessionSummaries,
    cachedTrackSummaries,
  ]) {
    fn.mockReset();
  }
  cachedProject.mockResolvedValue({ id: 7, name: "Invented Project" });
  getProjectPlugins.mockResolvedValue(USAGE);
  cachedSessionSummaries.mockResolvedValue(SESSIONS);
  cachedTrackSummaries.mockResolvedValue([
    { id: 3, title: "Invented Track" } as TrackSummary,
  ]);
  getPluginSessions.mockResolvedValue([] satisfies PluginSession[]);
});

describe("PluginsPage", () => {
  test("parks the stock chain under the web and draws the gear the sets share", async () => {
    const web = await webOf();
    const { web: drawing, stock } = await web!.layout();

    expect(stock.map((item) => [item.label, item.sets])).toEqual([
      ["Echo", 10],
    ]);
    expect(
      drawing.nodes.filter((node) => node.shape === "square")
    ).toHaveLength(5);
    expect(drawing.nodes.find((node) => node.id === "set:1")?.meta).toBe(
      "Invented Track"
    );
    // A set that carries a device on three tracks draws a heavier line.
    expect(drawing.edges.map((edge) => edge[3]).sort()).toEqual([
      1, 1, 1, 1, 1, 2.58, 2.58, 2.58, 2.58, 2.58,
    ]);
    expect(web?.label).toBe("6 devices across 10 sets · 5 third-party");
    expect(web?.toggleHref).toBe("/project/7/plugins?stock=1");
  });

  test("draws the stock chain in the web on ?stock=1, and keeps it on the rows' links", async () => {
    const web = await webOf({ stock: "1", device: "Echo" });
    const { web: drawing, stock } = await web!.layout();

    expect(drawing.nodes.some((node) => node.id === "item:Echo")).toBe(true);
    expect(stock).toHaveLength(1);
    expect(web?.toggleHref).toBe("/project/7/plugins?device=Echo");

    const page = await pageOf({ stock: "1" });
    const { container } = render(
      <InventoryPage {...page.props} web={undefined} />
    );
    const row = [...container.querySelectorAll("a")].find((link) =>
      link.textContent?.includes("Invented Verb 1")
    );
    expect(row?.getAttribute("href")).toBe(
      "/project/7/plugins?stock=1&device=Invented+Verb+1"
    );
  });

  test("keeps only the tab's devices in the web", async () => {
    const { web } = await (await webOf({ origin: "builtin" }))!.layout();

    // Every set carries Echo, and on this tab nothing else: it is all stock.
    expect(web.nodes).toEqual([]);
  });

  test("leaves the web out when no session reports a device", async () => {
    getProjectPlugins.mockResolvedValue([]);

    expect(await webOf()).toBeUndefined();
  });
});
