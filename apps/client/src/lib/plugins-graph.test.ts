import { describe, expect, it } from "bun:test";
import { DEFAULT_SHELL } from "@/lib/policies/shell";
import type { PluginUsage, SessionSummary } from "@workspace/api/api";
import {
  deviceMeta,
  type PluginsDefaults,
  pluginsGraph,
  type PluginsGraphOptions,
  pluginsPageHref,
  type PluginsPageParams,
} from "./plugins-graph";

/** The plugins page's own defaults: every origin, no stock chain. */
const DEFAULTS = DEFAULT_SHELL.inventoryDefaults.plugins;

const graphOf = (
  usage: PluginUsage[],
  sessions: SessionSummary[],
  options: Omit<PluginsGraphOptions, "defaults">
) => pluginsGraph(usage, sessions, { ...options, defaults: DEFAULTS });

const pageHref = (projectId: number, params: PluginsPageParams = {}) =>
  pluginsPageHref(projectId, params, DEFAULTS);

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

const SESSIONS = [
  session(1, "Invented Set A", 10),
  session(2, "Invented Set B", null),
  session(3, "Invented Set C", 11),
];

const USAGE = [
  device("Wobbleforge", [1, 2, 3], {
    origin: "plugin",
    host: "vst3",
    manufacturer: "Nimbus Audio",
  }),
  device("Glasshall Verb", [1, 2], { origin: "plugin", host: "au" }),
  device("Compressor", [1, 3]),
  device("Auto Filter", [2]),
];

describe("pluginsGraph", () => {
  it("keeps every device with no origin, and counts them", () => {
    const graph = graphOf(USAGE, SESSIONS, { projectId: 7 });
    expect(graph.plugins.map((p) => p.name)).toEqual([
      "Wobbleforge",
      "Glasshall Verb",
      "Compressor",
      "Auto Filter",
    ]);
    expect(graph.counts).toEqual({ devices: 4, sets: 3, thirdParty: 2 });
    expect(graph.cables).toHaveLength(8);
  });

  it("filters the graph and the rows alike by origin, with the counts unchanged", () => {
    const graph = graphOf(USAGE, SESSIONS, {
      projectId: 7,
      origin: "builtin",
    });
    expect(graph.plugins.map((p) => p.name)).toEqual([
      "Compressor",
      "Auto Filter",
    ]);
    expect(graph.right.map((n) => n.id)).toEqual(["Compressor", "Auto Filter"]);
    expect(graph.cables).toEqual([
      { left: "1", right: "Compressor", uses: 1 },
      { left: "3", right: "Compressor", uses: 1 },
      { left: "2", right: "Auto Filter", uses: 1 },
    ]);
    expect(graph.left.map((n) => n.id)).toEqual(["1", "2", "3"]);
    expect(graph.counts).toEqual({ devices: 4, sets: 3, thirdParty: 2 });
  });

  it("leaves out a set no kept device is on", () => {
    const graph = graphOf(
      [
        device("Compressor", [1]),
        device("Wobbleforge", [2, 3], { origin: "plugin" }),
      ],
      SESSIONS,
      { projectId: 7, origin: "builtin" }
    );
    expect(graph.left.map((n) => n.id)).toEqual(["1"]);
  });

  it("builds set nodes with a track meta and a session link", () => {
    const graph = graphOf(USAGE, SESSIONS, {
      projectId: 7,
      trackTitles: new Map([[10, "Invented Track"]]),
    });
    expect(graph.left).toEqual([
      {
        id: "1",
        label: "Invented Set A",
        meta: "Invented Track",
        href: "/project/7/track/10/session/1",
      },
      { id: "2", label: "Invented Set B", href: "/project/7/session/2" },
      {
        id: "3",
        label: "Invented Set C",
        href: "/project/7/track/11/session/3",
      },
    ]);
  });

  it("builds device nodes named by the device, linking to their row within the tab", () => {
    const all = graphOf(USAGE, SESSIONS, { projectId: 7 });
    expect(all.right[0]).toEqual({
      id: "Wobbleforge",
      label: "Wobbleforge",
      meta: "Nimbus Audio · VST3",
      href: "/project/7/plugins?device=Wobbleforge",
    });
    expect(all.right[2]?.meta).toBe("Built-in");

    const builtin = graphOf(USAGE, SESSIONS, {
      projectId: 7,
      origin: "builtin",
    });
    expect(builtin.right[0]?.href).toBe(
      "/project/7/plugins?origin=builtin&device=Compressor"
    );
  });

  it("drops a session id the list does not know, and its cables", () => {
    const graph = graphOf([device("Compressor", [1, 99])], SESSIONS, {
      projectId: 7,
    });
    expect(graph.left.map((n) => n.id)).toEqual(["1"]);
    expect(graph.cables).toEqual([{ left: "1", right: "Compressor", uses: 1 }]);
    expect(graph.counts).toEqual({ devices: 1, sets: 1, thirdParty: 0 });
  });

  it("carries each set's track entries on its cable, and the stock chain on a device's link", () => {
    const graph = graphOf(
      [device("Compressor", [1, 3], { sessionTracks: [4, 1] })],
      SESSIONS,
      { projectId: 7, stock: true }
    );
    expect(graph.cables).toEqual([
      { left: "1", right: "Compressor", uses: 4 },
      { left: "3", right: "Compressor", uses: 1 },
    ]);
    expect(graph.right[0]?.href).toBe(
      "/project/7/plugins?stock=1&device=Compressor"
    );
  });

  it("keeps a device with no session ids as a row and a node, without a cable", () => {
    const graph = graphOf([device("Orphan Verb", [])], SESSIONS, {
      projectId: 7,
    });
    expect(graph.plugins.map((p) => p.name)).toEqual(["Orphan Verb"]);
    expect(graph.right.map((n) => n.id)).toEqual(["Orphan Verb"]);
    expect(graph.cables).toEqual([]);
    expect(graph.left).toEqual([]);
  });

  it("answers empty lists for a project with no devices", () => {
    expect(graphOf([], SESSIONS, { projectId: 7 })).toEqual({
      plugins: [],
      left: [],
      right: [],
      cables: [],
      counts: { devices: 0, sets: 0, thirdParty: 0 },
    });
  });
});

describe("pluginsPageHref", () => {
  it("leaves the defaults out", () => {
    expect(pageHref(7)).toBe("/project/7/plugins");
    expect(pageHref(7, { origin: "all", stock: false })).toBe(
      "/project/7/plugins"
    );
  });

  it("round-trips a device name with an ampersand through the query", () => {
    const href = pageHref(7, {
      origin: "plugin",
      device: "Drums & Perc 2",
    });
    const params = new URL(href, "http://x").searchParams;
    expect(params.get("origin")).toBe("plugin");
    expect(params.get("device")).toBe("Drums & Perc 2");
  });

  describe("against defaults of the viewer's own", () => {
    const own: PluginsDefaults = { origin: "builtin", stock: true };

    it("leaves out every view param that matches them", () => {
      expect(pluginsPageHref(7, { origin: "builtin", stock: true }, own)).toBe(
        "/project/7/plugins"
      );
    });

    it("spells out every view param that departs from them, all and off included", () => {
      const params = new URL(
        pluginsPageHref(7, { origin: "all", stock: false }, own),
        "http://x"
      ).searchParams;
      expect(params.get("origin")).toBe("all");
      expect(params.get("stock")).toBe("0");
    });

    it("writes the graph's every-origin view as all against them", () => {
      const graph = pluginsGraph(USAGE, SESSIONS, {
        projectId: 7,
        defaults: own,
      });
      const params = new URL(graph.right[0]?.href ?? "", "http://x")
        .searchParams;
      expect(params.get("origin")).toBe("all");
    });
  });
});

describe("deviceMeta", () => {
  it("names the manufacturer and format of a third-party device", () => {
    expect(
      deviceMeta(
        device("X", [], {
          origin: "plugin",
          manufacturer: "Fernwood",
          host: "vst3",
        })
      )
    ).toBe("Fernwood · VST3");
  });

  it("falls back to Third-party when the scan named neither", () => {
    expect(deviceMeta(device("X", [], { origin: "plugin" }))).toBe(
      "Third-party"
    );
  });

  it("says Built-in for one of the DAW's own", () => {
    expect(deviceMeta(device("X", []))).toBe("Built-in");
  });
});
