import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { ListTrack } from "@workspace/api/api";

// The table module imports much of the actions layer; the archive commands
// are swapped so a run's arguments can be read.
mock.module("server-only", () => ({}));
const realArchive = await import("@/entities/track/archive");
const archiveTracks = mock();
const unarchiveTracks = mock();
mock.module("@/entities/track/archive", () => ({
  ...realArchive,
  archiveTracks,
  unarchiveTracks,
}));
mock.module("next/navigation", () => ({
  useRouter: mock(() => ({ refresh: mock() })),
  usePathname: mock(),
  useParams: mock(() => ({})),
  useSearchParams: mock(() => new URLSearchParams()),
}));

const { trackTableActions } = await import("./table");
const { archivedScopeOf } = await import("./api");
const { trackTable } = await import("./table");
const { selectionScopeOf } = await import("@/entities/api");
const { trackColumns } = await import("./columns");
const { fieldKind } = await import("@/fields");

const router = { refresh: mock() };
const live = { id: 1, title: "Live one", archivedAt: null } as ListTrack;
const archived = {
  id: 2,
  title: "Archived one",
  archivedAt: "2026-09-01T00:00:00.000Z",
} as ListTrack;

const actions = () => trackTableActions(7, [live, archived], router as never);
const action = (id: string) => {
  const found = actions().find((a) => a.id === id);
  if (!found) throw new Error(`no ${id} action`);
  return found;
};

beforeEach(() => {
  archiveTracks.mockReset();
  unarchiveTracks.mockReset();
});

describe("track table pageQuery archived scope", () => {
  it("includes archived tracks when scoped to a collection", () => {
    const scope = { collectionId: 3, collections: [] };

    expect(trackTable.pageQuery({}, scope).archived).toBe("include");
    expect(archivedScopeOf(scope)).toBe("include");
  });

  it("lets the scope's own value win over the collection default", () => {
    const scope = {
      collectionId: 3,
      archived: "only" as const,
      collections: [],
    };

    expect(trackTable.pageQuery({}, scope).archived).toBe("only");
  });

  it("leaves it absent with no collection and no scope value", () => {
    expect(trackTable.pageQuery({}).archived).toBeUndefined();
    expect(
      trackTable.pageQuery({}, { collections: [] }).archived
    ).toBeUndefined();
  });
});

describe("track table selection scope", () => {
  // The params a "select all N" selection carries beside the URL's filters.
  const scopeOf = (scope?: Parameters<typeof trackTable.pageQuery>[1]) =>
    selectionScopeOf(trackTable.pageQuery({}, scope));

  it("carries the archived page's scope, so the server resolves archived tracks", () => {
    expect(scopeOf({ archived: "only", collections: [] })).toEqual({
      archived: "only",
    });
  });

  it("carries a collection's own scope", () => {
    expect(scopeOf({ collectionId: 3, collections: [] })).toEqual({
      archived: "include",
      collection: "3",
    });
  });

  it("carries nothing for the live list", () => {
    expect(scopeOf({ collections: [] })).toEqual({});
    expect(scopeOf()).toEqual({});
  });
});

describe("trackTableActions", () => {
  it("offers Archive only for a live row", () => {
    const archive = action("archive");

    expect(archive.offered(live)).toBe(true);
    expect(archive.offered(archived)).toBe(false);
  });

  it("offers Unarchive only for an archived row", () => {
    const unarchive = action("unarchive");

    expect(unarchive.offered(archived)).toBe(true);
    expect(unarchive.offered(live)).toBe(false);
  });

  it("passes the row's title on a one-row run", async () => {
    await action("archive").run({ ids: [1] });
    await action("unarchive").run({ ids: [2] });

    expect(archiveTracks).toHaveBeenCalledWith({
      projectId: 7,
      selection: { ids: [1] },
      title: "Live one",
      router,
    });
    expect(unarchiveTracks).toHaveBeenCalledWith({
      projectId: 7,
      selection: { ids: [2] },
      title: "Archived one",
      router,
    });
  });

  it("passes no title on a multi-row or select-all run", async () => {
    await action("archive").run({ ids: [1, 2] });
    await action("archive").run({ all: true });

    expect(archiveTracks.mock.calls[0]?.[0].title).toBeUndefined();
    expect(archiveTracks.mock.calls[1]?.[0].title).toBeUndefined();
  });
});

describe("track artists column", () => {
  const artistsValue = (row: ListTrack) => {
    const column = trackColumns(7, [], undefined, mock(), mock()).find(
      (c) => c.id === "artists"
    ) as { accessorFn: (row: ListTrack) => unknown } | undefined;
    if (!column) throw new Error("no artists column");
    return column.accessorFn(row);
  };

  // The editable cell shows the `list` kind's formatting of the column's
  // value, and an empty format renders as "—".
  it("hands the list cell a value it formats as the artists", () => {
    const value = artistsValue({ ...live, artists: ["Ana", "Ben"] });

    expect(fieldKind("list").format(value as string[], {})).toBe("Ana, Ben");
  });

  it("reads a track with no artists as an empty list", () => {
    expect(artistsValue({ ...live, artists: [] })).toEqual([]);
  });
});
