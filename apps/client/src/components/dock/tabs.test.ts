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
    ["session/all", "sessions"],
    ["session/7", "sessions"],
  ])("lights one tab for /%s", (path, expected) => {
    expect(activeTabs(ctxAt(path))).toEqual([expected]);
  });

  it("lights nothing on the project root (Project moved into the switcher)", () => {
    expect(
      activeTabs({
        projectId: 7,
        route: { kind: "project" },
        pathname: "/project/7",
      })
    ).toEqual([]);
  });

  it("lights nothing on a project page no tab covers", () => {
    expect(activeTabs(ctxAt("plugins"))).toEqual([]);
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
      "/project/7/collection/all",
      "/project/7/track/all",
      NOTES_HREF,
      "/project/7/session/all",
      null,
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
    expect(hrefs).toEqual([null, null, NOTES_HREF, null, null]);
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

  it("is every tab in the order it has always stood, by default", () => {
    expect(ids(DEFAULT_SHELL.dockTabs)).toEqual(TABS.map((tab) => tab.id));
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
