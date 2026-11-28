import { describe, expect, it } from "bun:test";
import { parseRoute } from "@/lib/route-parser";
import { NOTES_HREF } from "@/lib/utils";
import { DEFAULT_SHELL, type DockTabId } from "@/lib/policies/shell";
import { dockTabs, TABS, type TabContext } from "./tabs";

const ctxAt = (
  path: string,
  overrides: Partial<TabContext> = {}
): TabContext => ({
  projectId: 7,
  route: parseRoute(path.split("/").filter(Boolean)),
  pathname: `/project/7/${path}`,
  ...overrides,
});

const activeTabs = (ctx: TabContext) =>
  TABS.filter((tab) => tab.isActive(ctx)).map((tab) => tab.id);

describe("TABS", () => {
  it.each<[string, DockTabId]>([
    ["collection/all", "collections"],
    ["collection/3", "collections"],
    ["collection/3/track/9", "collections"],
    ["collection/3/track/9/session/7", "collections"],
    ["track/all", "tracks"],
    ["track/12", "tracks"],
    ["track/new", "tracks"],
    ["session/all", "studio"],
    ["session/7", "studio"],
    ["plugins", "studio"],
    ["samples", "studio"],
  ])("lights one tab for /%s", (path, expected) => {
    expect(activeTabs(ctxAt(path))).toEqual([expected]);
  });

  it("lights Home on the project root", () => {
    expect(
      activeTabs({
        projectId: 7,
        route: { kind: "project" },
        pathname: "/project/7",
      })
    ).toEqual(["home"]);
  });

  it("lights nothing on a project page no tab covers", () => {
    expect(activeTabs(ctxAt("repo/1"))).toEqual([]);
  });

  it("lights nothing on a route it does not recognise", () => {
    expect(activeTabs(ctxAt("nonsense"))).toEqual([]);
  });

  it("lights Notes on /notes and its detail routes", () => {
    const notesCtx: TabContext = {
      projectId: 7,
      route: null,
      pathname: "/notes/12",
    };
    expect(activeTabs(notesCtx)).toEqual(["notes"]);
  });

  it("addresses every project tab plus Notes, and nothing for Search", () => {
    const ctx = ctxAt("collection/all");
    const hrefs = TABS.map((tab) =>
      tab.kind === "link" ? tab.href(ctx) : null
    );
    expect(hrefs).toEqual([
      "/project/7",
      "/project/7/collection/all",
      "/project/7/track/all",
      NOTES_HREF,
      null,
      "/project/7/session/all",
    ]);
  });

  it("returns null hrefs for the project-scoped tabs with no project in context, but Notes still resolves", () => {
    const ctx: TabContext = {
      projectId: null,
      route: null,
      pathname: "/notes",
    };
    const hrefs = TABS.map((tab) =>
      tab.kind === "link" ? tab.href(ctx) : null
    );
    expect(hrefs).toEqual([null, null, null, NOTES_HREF, null, null]);
  });

  it("gates collection and track long-press shortcuts to editors", () => {
    const viewerCtx = ctxAt("collection/all", { canEdit: false });
    const editorCtx = ctxAt("collection/all", { canEdit: true });
    const collections = TABS.find((t) => t.id === "collections")!;
    const tracks = TABS.find((t) => t.id === "tracks")!;
    if (collections.kind !== "link" || tracks.kind !== "link") {
      throw new Error("expected link tabs");
    }
    expect(collections.longPressHref?.(viewerCtx)).toBeNull();
    expect(tracks.longPressHref?.(viewerCtx)).toBeNull();
    expect(collections.longPressHref?.(editorCtx)).toBe(
      "/project/7/collection/new"
    );
    expect(tracks.longPressHref?.(editorCtx)).toBe("/project/7/track/new");
  });

  it("Search is the only palette tab", () => {
    expect(
      TABS.filter((tab) => tab.kind === "palette").map((t) => t.id)
    ).toEqual(["search"]);
  });
});

describe("dockTabs", () => {
  const ids = (list: readonly DockTabId[]) =>
    dockTabs(list).map((tab) => tab.id);

  it("shows Home, Collections, Tracks, Notes, Search by default (leaving opt-in studio off)", () => {
    expect(ids(DEFAULT_SHELL.dockTabs)).toEqual([
      "home",
      "collections",
      "tracks",
      "notes",
      "search",
    ]);
  });

  it("orders the tabs as listed and leaves out any not listed", () => {
    expect(ids(["search", "tracks"])).toEqual(["search", "tracks"]);
  });

  it("shows a tab listed twice once", () => {
    expect(ids(["notes", "notes", "tracks"])).toEqual(["notes", "tracks"]);
  });

  it("passes over an id no tab answers to", () => {
    expect(ids(["tracks", "mixer" as DockTabId])).toEqual(["tracks"]);
  });

  it("gives a bar of fewer than two tabs just those", () => {
    expect(ids(["notes"])).toEqual(["notes"]);
    expect(ids([])).toEqual([]);
  });
});
