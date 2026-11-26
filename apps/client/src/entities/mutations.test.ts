import { describe, expect, it, mock } from "bun:test";

import type { Mutation } from "@/lib/mutation";
import type { ActionError, Track } from "@workspace/api/api";

type Call = { path: string; init: unknown };

/** A canned openapi-fetch result, `data`/`error` matching the response's status. */
type CannedResult = { data?: unknown; error?: unknown; response: Response };

const ok = (data: unknown = { ok: true }): CannedResult => ({
  data,
  response: new Response(JSON.stringify(data), {
    status: 200,
    headers: { "content-type": "application/json" },
  }),
});

const calls: Call[] = [];
const method = (path: string, init: unknown) => {
  calls.push({ path, init });
  return Promise.resolve(ok());
};

mock.module("@/lib/browser-api", () => ({
  browserApi: {
    GET: mock(method),
    POST: mock(method),
    PATCH: mock(method),
    PUT: mock(method),
    DELETE: mock(method),
  },
}));

const {
  patchEntityField,
  patchEntityFields,
  createEntity,
  removeEntity,
  bulkPatchEntities,
  bulkRemoveEntities,
  bulkSetEntityLabels,
  bulkMoveEntities,
  setEntityLabels,
  moveEntity,
  linkTracksToCollection,
  addTrackRelation,
  removeTrackRelation,
  createSavedView,
  deleteSavedView,
  collectionTracksChanged,
} = await import("./mutations");

describe("patchEntityField", () => {
  it("invalidates the route on a status cell edit on a kind with a status", () => {
    expect(patchEntityField("track", 1, "statusId", 2).invalidates).toEqual([
      "route",
    ]);
    expect(
      patchEntityField("collection", 1, "statusId", 2).invalidates
    ).toEqual(["route"]);
  });

  it("invalidates nothing for a statusId edit on a kind with no status", () => {
    expect(patchEntityField("session", 1, "statusId", 2).invalidates).toEqual(
      []
    );
  });

  it("invalidates nothing for any other cell edit", () => {
    expect(patchEntityField("track", 1, "title", "New").invalidates).toEqual(
      []
    );
  });

  it("patches the row through ENTITY_API on run", async () => {
    calls.length = 0;
    const mutation = patchEntityField("track", 5, "title", "New");

    await mutation.run();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe("/api/tracks/{id}");
  });
});

describe("patchEntityFields", () => {
  it("always invalidates the route", () => {
    expect(
      patchEntityFields("session", 1, { name: "New" }).invalidates
    ).toEqual(["route"]);
    expect(
      patchEntityFields("track", 1, { statusId: null }).invalidates
    ).toEqual(["route"]);
  });
});

describe("createEntity", () => {
  it("invalidates the route unless told otherwise", () => {
    expect(
      createEntity("track", { title: "New", projectId: 1 }).invalidates
    ).toEqual(["route"]);
    expect(
      createEntity("track", { title: "New", projectId: 1 }, []).invalidates
    ).toEqual([]);
  });

  it("resolves to the created row's own kind, not every table row", () => {
    // Type-level: `createEntity` is generic in its kind, so a widened return
    // here would leave every caller narrowing a union of three row types.
    const mutation: Mutation<Track | ActionError> = createEntity("track", {
      title: "New",
      projectId: 1,
    });

    expect(mutation.invalidates).toEqual(["route"]);
  });

  it("creates the row through ENTITY_API on run", async () => {
    calls.length = 0;
    const mutation = createEntity("session", {
      name: "New",
      daw: "ableton",
      projectId: 1,
    });

    await mutation.run();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe("/api/sessions");
  });
});

describe("route-invalidating mutations", () => {
  it("removeEntity invalidates the route", () => {
    expect(removeEntity("track", 1).invalidates).toEqual(["route"]);
  });

  it("bulkPatchEntities invalidates the route", () => {
    expect(
      bulkPatchEntities("track", 1, { ids: [1, 2] }, { statusId: 2 })
        .invalidates
    ).toEqual(["route"]);
  });

  it("bulkRemoveEntities invalidates the route", () => {
    expect(bulkRemoveEntities("track", 1, { ids: [1, 2] }).invalidates).toEqual(
      ["route"]
    );
  });

  it("bulkSetEntityLabels invalidates the route", () => {
    expect(
      bulkSetEntityLabels(
        "track",
        1,
        { ids: [1, 2] },
        { add: [3], remove: [4] }
      ).invalidates
    ).toEqual(["route"]);
  });

  it("bulkMoveEntities invalidates the route", () => {
    expect(
      bulkMoveEntities("track", 1, { ids: [1, 2] }, 2).invalidates
    ).toEqual(["route"]);
  });

  it("setEntityLabels invalidates the route", () => {
    expect(setEntityLabels("track", 1, { labelIds: [1] }).invalidates).toEqual([
      "route",
    ]);
  });

  it("addTrackRelation invalidates the route", () => {
    expect(addTrackRelation(1, 2, 3).invalidates).toEqual(["route"]);
  });

  it("removeTrackRelation invalidates the route", () => {
    expect(removeTrackRelation(1, 2).invalidates).toEqual(["route"]);
  });

  it("createSavedView invalidates the route", () => {
    expect(
      createSavedView(1, "track", "My view", "status:open").invalidates
    ).toEqual(["route"]);
  });

  it("deleteSavedView invalidates the route", () => {
    expect(deleteSavedView(1, 2).invalidates).toEqual(["route"]);
  });
});

describe("linkTracksToCollection", () => {
  it("invalidates the route and the collection's track list", () => {
    expect(linkTracksToCollection(1, [2, 3]).invalidates).toEqual([
      "route",
      "collection-tracks",
    ]);
  });

  it("links tracks through the collection api on run", async () => {
    calls.length = 0;
    const mutation = linkTracksToCollection(1, [2, 3]);

    await mutation.run();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe("/api/collections/{id}/tracks/bulk");
  });
});

describe("moveEntity", () => {
  it("invalidates nothing", () => {
    expect(moveEntity("track", 1, 2).invalidates).toEqual([]);
  });
});

describe("collectionTracksChanged", () => {
  it("touches no API and invalidates only the collection's track list", async () => {
    calls.length = 0;
    const mutation = collectionTracksChanged();

    expect(mutation.invalidates).toEqual(["collection-tracks"]);
    expect(await mutation.run()).toEqual({ ok: true });
    expect(calls).toHaveLength(0);
  });
});
