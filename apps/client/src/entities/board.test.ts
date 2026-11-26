import type { TableSearchParams } from "@/lib/table-params";
import { beforeEach, describe, expect, it, mock } from "bun:test";

import type { EntityBoardDefinition } from "./table-types";

// The definitions' modules import much of the actions layer, and a module
// mock must carry every export the graph names, so the real modules are
// spread and only the two page actions are swapped.
mock.module("server-only", () => ({}));
const realTracks = await import("@/actions/tracks");
const realProjects = await import("@/actions/projects");

const getTracksPageForProject = mock();
mock.module("@/actions/tracks", () => ({
  ...realTracks,
  getTracksPageForProject,
}));

const getCollectionsPageForProject = mock();
mock.module("@/actions/projects", () => ({
  ...realProjects,
  getCollectionsPageForProject,
}));

mock.module("next/navigation", () => ({
  useRouter: mock(() => ({ refresh: mock() })),
  usePathname: mock(),
  useParams: mock(() => ({})),
  useSearchParams: mock(() => new URLSearchParams()),
}));

const { collectionTable } = await import("./collection/table");
const { trackTable } = await import("./track/table");

const trackBoard: EntityBoardDefinition<"track"> = trackTable.board;
const collectionBoard: EntityBoardDefinition<"collection"> =
  collectionTable.board;

const query = (filters: TableSearchParams) => ({
  page: 2,
  pageSize: 50,
  status: 7,
  filters,
});

beforeEach(() => {
  getTracksPageForProject.mockReset();
  getCollectionsPageForProject.mockReset();
});

describe("trackTable.board.fetchPage", () => {
  it("passes the column's status and page with every filter", async () => {
    getTracksPageForProject.mockResolvedValue({ rows: [], rowCount: 0 });

    await trackBoard.fetchPage(
      3,
      query({ q: "demo", relation: "remix", label: 4, artist: "Ana" })
    );

    expect(getTracksPageForProject).toHaveBeenCalledWith(3, {
      page: 2,
      pageSize: 50,
      status: 7,
      collection: undefined,
      q: "demo",
      relation: "remix",
      label: 4,
      artist: "Ana",
    });
  });

  it("uses the collection filter when there is no scope", async () => {
    getTracksPageForProject.mockResolvedValue({ rows: [], rowCount: 0 });

    await trackBoard.fetchPage(3, query({ collection: 9 }));

    expect(getTracksPageForProject.mock.calls[0]?.[1].collection).toBe(9);
  });

  it("lets the scope's collection win over the collection filter", async () => {
    getTracksPageForProject.mockResolvedValue({ rows: [], rowCount: 0 });

    await trackBoard.fetchPage(3, query({ collection: 9 }), {
      collectionId: 5,
      collections: [],
    });

    expect(getTracksPageForProject.mock.calls[0]?.[1].collection).toBe(5);
  });

  it("returns only the rows and the count on success", async () => {
    const rows = [{ id: 1 }];
    getTracksPageForProject.mockResolvedValue({
      rows,
      rowCount: 1,
      page: 2,
      pageSize: 50,
    });

    expect<unknown>(await trackBoard.fetchPage(3, query({}))).toEqual({
      rows,
      rowCount: 1,
    });
  });

  it("returns the action's error unchanged", async () => {
    const error = { error: "Failed to load tracks" };
    getTracksPageForProject.mockResolvedValue(error);

    expect(await trackBoard.fetchPage(3, query({}))).toBe(error);
  });
});

describe("collectionTable.board.fetchPage", () => {
  it("forwards the status and page and only the search filter", async () => {
    getCollectionsPageForProject.mockResolvedValue({ rows: [], rowCount: 0 });

    await collectionBoard.fetchPage(
      3,
      query({ q: "ep", label: 4, artist: "Ana" })
    );

    expect(getCollectionsPageForProject).toHaveBeenCalledWith(3, {
      page: 2,
      pageSize: 50,
      status: 7,
      q: "ep",
    });
  });

  it("returns the action's error unchanged", async () => {
    const error = { error: "Failed to load collections" };
    getCollectionsPageForProject.mockResolvedValue(error);

    expect(await collectionBoard.fetchPage(3, query({}))).toBe(error);
  });
});
