import { beforeEach, describe, expect, it, mock } from "bun:test";

mock.module("server-only", () => ({}));

const getSavedViews =
  mock<
    (
      projectId: number,
      kind: string
    ) => Promise<Array<{ id: number; config: { query: string } }>>
  >();
mock.module("@/actions/saved-views", () => ({ getSavedViews }));

const { DEFAULT_EFFECTIVE_SETTINGS, effectiveSettings } =
  await import("@/lib/settings/effective");
let settings = DEFAULT_EFFECTIVE_SETTINGS;
mock.module("@/lib/settings/server", () => ({
  cachedEffectiveSettings: async () => settings,
}));

const { defaultViewTarget } = await import("./index");
const { entityModule } = await import("@/entities");
const { ENTITY_LISTS } = await import("./lists");

const PROJECT_ID = 7;

beforeEach(() => {
  settings = DEFAULT_EFFECTIVE_SETTINGS;
  getSavedViews.mockReset();
  getSavedViews.mockResolvedValue([]);
});

describe("defaultViewTarget", () => {
  it("redirects a bare live URL to the built-in view when nothing is set", async () => {
    const target = await defaultViewTarget(
      "track",
      entityModule("track"),
      ENTITY_LISTS.track,
      PROJECT_ID,
      "live"
    );

    expect(target).toBe(`/project/${PROJECT_ID}/track/all?view=list`);
  });

  it("carries a bare URL's peek into the target", async () => {
    const target = await defaultViewTarget(
      "track",
      entityModule("track"),
      ENTITY_LISTS.track,
      PROJECT_ID,
      "live",
      "5"
    );

    expect(target).toBe(`/project/${PROJECT_ID}/track/all?view=list&peek=5`);
  });

  it("carries a kind's own columns, sort and grouping settings into the target", async () => {
    settings = effectiveSettings(
      {
        "tables.trackColumns": { isrc: false, bpm: true },
        "tables.trackSort": "title.asc",
        "tables.trackGrouping": "status",
      },
      "v1"
    );

    const target = await defaultViewTarget(
      "track",
      entityModule("track"),
      ENTITY_LISTS.track,
      PROJECT_ID,
      "live"
    );

    expect(target).toBe(
      `/project/${PROJECT_ID}/track/all?sort=title.asc&cols=-isrc%2Cbpm&group=status&view=list`
    );
  });

  it("opens on board when the kind's default view is board", async () => {
    settings = effectiveSettings({ "tables.trackView": "board" }, "v1");

    const target = await defaultViewTarget(
      "track",
      entityModule("track"),
      ENTITY_LISTS.track,
      PROJECT_ID,
      "live"
    );

    expect(target).toBe(`/project/${PROJECT_ID}/track/all?view=board`);
  });

  it("sessions have no board setting, so their default is always list", async () => {
    const target = await defaultViewTarget(
      "session",
      entityModule("session"),
      ENTITY_LISTS.session,
      PROJECT_ID,
      "live"
    );

    expect(target).toBe(`/project/${PROJECT_ID}/session/all?view=list`);
  });

  it("adds the tracks table's default archived visibility on the live scope", async () => {
    settings = effectiveSettings({ "tables.archived": "include" }, "v1");

    const target = await defaultViewTarget(
      "track",
      entityModule("track"),
      ENTITY_LISTS.track,
      PROJECT_ID,
      "live"
    );

    expect(target).toBe(
      `/project/${PROJECT_ID}/track/all?view=list&archived=include`
    );
  });

  it("never adds archived on the archived scope — the route already fixes it", async () => {
    settings = effectiveSettings({ "tables.archived": "include" }, "v1");

    const target = await defaultViewTarget(
      "track",
      entityModule("track"),
      ENTITY_LISTS.track,
      PROJECT_ID,
      "archived"
    );

    expect(target).toBe(`/project/${PROJECT_ID}/track/archived?view=list`);
  });

  it("uses the default saved view's own query over the per-kind settings", async () => {
    settings = effectiveSettings(
      {
        "tables.defaultSavedView": { [String(PROJECT_ID)]: { track: 42 } },
        "tables.trackSort": "title.asc",
      },
      "v1"
    );
    getSavedViews.mockResolvedValue([
      { id: 42, config: { query: "status=3" } },
    ]);

    const target = await defaultViewTarget(
      "track",
      entityModule("track"),
      ENTITY_LISTS.track,
      PROJECT_ID,
      "live"
    );

    expect(target).toBe(`/project/${PROJECT_ID}/track/all?status=3&view=list`);
  });

  it("a default saved view opens on list even when the kind's own default is board", async () => {
    settings = effectiveSettings(
      {
        "tables.defaultSavedView": { [String(PROJECT_ID)]: { track: 42 } },
        "tables.trackView": "board",
      },
      "v1"
    );
    getSavedViews.mockResolvedValue([
      { id: 42, config: { query: "status=3" } },
    ]);

    const target = await defaultViewTarget(
      "track",
      entityModule("track"),
      ENTITY_LISTS.track,
      PROJECT_ID,
      "live"
    );

    expect(target).toBe(`/project/${PROJECT_ID}/track/all?status=3&view=list`);
  });

  it("falls through to the per-kind settings when the default saved view is gone", async () => {
    settings = effectiveSettings(
      {
        "tables.defaultSavedView": { [String(PROJECT_ID)]: { track: 42 } },
        "tables.trackSort": "title.asc",
      },
      "v1"
    );
    getSavedViews.mockResolvedValue([]); // 42 no longer exists

    const target = await defaultViewTarget(
      "track",
      entityModule("track"),
      ENTITY_LISTS.track,
      PROJECT_ID,
      "live"
    );

    expect(target).toBe(
      `/project/${PROJECT_ID}/track/all?sort=title.asc&view=list`
    );
  });
});
