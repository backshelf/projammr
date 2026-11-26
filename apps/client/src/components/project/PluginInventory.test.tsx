import { beforeEach, describe, expect, mock, test } from "bun:test";
import { render } from "@testing-library/react";
import type { PluginUsage, SessionSummary } from "@workspace/api/api";
import { DEFAULT_POLICIES } from "@/lib/policies/policies";

const cachedSessionSummaries = mock();

mock.module("@/lib/server-data", () => ({ cachedSessionSummaries }));
mock.module("@/lib/policies/server", () => ({
  cachedPolicies: async () => DEFAULT_POLICIES,
}));

const { PluginInventory } = await import("./PluginInventory");

const session = (id: number, name: string): SessionSummary => ({
  id,
  name,
  daw: "ableton",
  trackId: null,
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

const SESSIONS = [session(1, "Invented Set A"), session(2, "Invented Set B")];
const PLUGINS = [
  device("Wobbleforge", [1, 2], { origin: "plugin", host: "vst3" }),
  device("Compressor", [1, 2]),
  device("Auto Filter", [2]),
];

const renderSection = async (plugins: PluginUsage[] = PLUGINS) =>
  render(await PluginInventory({ projectId: 7, plugins, sessionCount: 2 }));

beforeEach(() => {
  cachedSessionSummaries.mockReset();
  cachedSessionSummaries.mockResolvedValue(SESSIONS);
});

describe("PluginInventory", () => {
  test("states the devices across the sets", async () => {
    const { container } = await renderSection();

    expect(container.textContent).toContain("3 devices across 2 sets");
  });

  test("links to the full plugins page", async () => {
    const { container } = await renderSection();

    const link = [...container.querySelectorAll("a")].find(
      (a) => a.textContent === "All devices"
    );
    expect(link?.getAttribute("href")).toBe("/project/7/plugins");
  });

  test("draws the sets and the devices they share, folding a single-set device into its set", async () => {
    const { container } = await renderSection();

    expect(
      container.querySelectorAll("[data-pb-side='left'][data-pb-node]")
    ).toHaveLength(2);
    expect(
      [...container.querySelectorAll("[data-pb-side='right'][data-pb-node]")]
        .map((node) => node.getAttribute("data-pb-node"))
        .sort()
    ).toEqual(["Compressor", "Wobbleforge"]);
  });

  test("renders nothing when no session reports a device", async () => {
    expect(
      await PluginInventory({ projectId: 7, plugins: [], sessionCount: 2 })
    ).toBeNull();
  });

  test("renders nothing when the session read fails", async () => {
    cachedSessionSummaries.mockResolvedValue({ error: "boom" });

    expect(
      await PluginInventory({ projectId: 7, plugins: PLUGINS, sessionCount: 2 })
    ).toBeNull();
  });
});
