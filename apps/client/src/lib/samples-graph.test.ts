import { describe, expect, it } from "bun:test";
import { DEFAULT_SHELL } from "@/lib/policies/shell";
import type { SampleUsage, SessionSummary } from "@workspace/api/api";
import {
  type SamplesDefaults,
  type SamplesGraphOptions,
  samplesGraph,
  samplesPageHref,
  type SamplesPageParams,
} from "./samples-graph";

/** The samples page's own defaults: every sample, Library off, no stock chain. */
const DEFAULTS = DEFAULT_SHELL.inventoryDefaults.samples;

const graphOf = (
  usage: SampleUsage[],
  sessions: SessionSummary[],
  options: Omit<SamplesGraphOptions, "defaults">
) => samplesGraph(usage, sessions, { ...options, defaults: DEFAULTS });

const pageHref = (projectId: number, params: SamplesPageParams = {}) =>
  samplesPageHref(projectId, params, DEFAULTS);

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

const SESSIONS = [
  session(1, "Invented Set A", 10),
  session(2, "Invented Set B", null),
  session(3, "Invented Set C", 11),
];

const USAGE = [
  usage("/Users/demo/Samples/Shared Kick.wav", [1, 2]),
  usage("/Users/demo/Samples/Lost Hat.wav", [2, 3], { missing: true }),
  usage("Samples/Imported/Own Pad.wav", [1]),
  usage("/Library/Core/Drums/Core Clap.wav", [1, 3], { kind: "library" }),
];

describe("samplesGraph", () => {
  it("hides library samples unless the toggle is on", () => {
    const off = graphOf(USAGE, SESSIONS, {
      projectId: 7,
      show: "all",
      library: false,
    });
    expect(off.samples.map((s) => s.path)).not.toContain(
      "/Library/Core/Drums/Core Clap.wav"
    );
    expect(off.counts).toEqual({ samples: 3, sets: 3, shared: 2, missing: 1 });

    const on = graphOf(USAGE, SESSIONS, {
      projectId: 7,
      show: "all",
      library: true,
    });
    expect(on.samples).toHaveLength(4);
    expect(on.counts.shared).toBe(3);
  });

  it("keeps only missing samples on the Missing tab, with the counts unchanged", () => {
    const graph = graphOf(USAGE, SESSIONS, {
      projectId: 7,
      show: "missing",
      library: false,
    });
    expect(graph.samples.map((s) => s.path)).toEqual([
      "/Users/demo/Samples/Lost Hat.wav",
    ]);
    expect(graph.left.map((n) => n.id)).toEqual(["2", "3"]);
    expect(graph.cables).toEqual([
      { left: "2", right: "/Users/demo/Samples/Lost Hat.wav", missing: true },
      { left: "3", right: "/Users/demo/Samples/Lost Hat.wav", missing: true },
    ]);
    expect(graph.counts).toEqual({
      samples: 3,
      sets: 3,
      shared: 2,
      missing: 1,
    });
  });

  it("builds set nodes with a track meta and a session link", () => {
    const graph = graphOf(USAGE, SESSIONS, {
      projectId: 7,
      show: "all",
      library: false,
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

  it("builds sample nodes from the path, linking to their row", () => {
    const graph = graphOf(USAGE, SESSIONS, {
      projectId: 7,
      show: "all",
      library: true,
    });
    expect(graph.right[1]).toEqual({
      id: "/Users/demo/Samples/Lost Hat.wav",
      label: "Lost Hat.wav",
      meta: "/Users/demo/Samples",
      href: `/project/7/samples?library=1&sample=${encodeURIComponent("/Users/demo/Samples/Lost Hat.wav").replaceAll("%20", "+")}`,
      missing: true,
    });
  });

  it("drops a session id the list does not know, and its cables", () => {
    const graph = graphOf(
      [usage("/Users/demo/Samples/Shared Kick.wav", [1, 99])],
      SESSIONS,
      { projectId: 7, show: "all", library: false }
    );
    expect(graph.left.map((n) => n.id)).toEqual(["1"]);
    expect(graph.cables).toHaveLength(1);
    expect(graph.counts).toEqual({
      samples: 1,
      sets: 1,
      shared: 0,
      missing: 0,
    });
  });

  it("answers empty lists for a project with no samples", () => {
    const graph = graphOf([], SESSIONS, {
      projectId: 7,
      show: "all",
      library: false,
    });
    expect(graph).toEqual({
      samples: [],
      left: [],
      right: [],
      cables: [],
      counts: { samples: 0, sets: 0, shared: 0, missing: 0 },
    });
  });
});

describe("samplesPageHref", () => {
  it("leaves the defaults out", () => {
    expect(pageHref(7)).toBe("/project/7/samples");
  });

  it("round-trips a path with an ampersand through the query", () => {
    const href = pageHref(7, {
      show: "missing",
      library: true,
      sample: "/Users/demo/Drums & Perc/Hat.wav",
    });
    const params = new URL(href, "http://x").searchParams;
    expect(params.get("show")).toBe("missing");
    expect(params.get("library")).toBe("1");
    expect(params.get("sample")).toBe("/Users/demo/Drums & Perc/Hat.wav");
  });

  it("says stock=1 when the stock chain is drawn, and leaves it out when not", () => {
    expect(pageHref(7, { stock: true })).toBe("/project/7/samples?stock=1");
    expect(pageHref(7, { stock: false })).toBe("/project/7/samples");
  });

  describe("against defaults of the viewer's own", () => {
    const own: SamplesDefaults = {
      show: "missing",
      library: true,
      stock: true,
    };

    it("leaves out every view param that matches them", () => {
      expect(
        samplesPageHref(7, { show: "missing", library: true, stock: true }, own)
      ).toBe("/project/7/samples");
    });

    it("spells out every view param that departs from them, off included", () => {
      const params = new URL(
        samplesPageHref(7, { show: "all", library: false, stock: false }, own),
        "http://x"
      ).searchParams;
      expect(params.get("show")).toBe("all");
      expect(params.get("library")).toBe("0");
      expect(params.get("stock")).toBe("0");
    });

    it("carries them on every sample's link in the graph", () => {
      const graph = samplesGraph(USAGE, SESSIONS, {
        projectId: 7,
        show: "missing",
        library: true,
        stock: true,
        defaults: own,
      });
      const hrefs = graph.right.map(
        (node) => new URL(node.href ?? "", "http://x").searchParams
      );
      expect(hrefs.every((params) => !params.has("library"))).toBe(true);
      expect(hrefs.every((params) => !params.has("show"))).toBe(true);
    });
  });
});
