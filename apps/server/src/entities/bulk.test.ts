import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { bulkSelectionSchema } from "../db/queries/pagination.js";
import { levelByName } from "../db/queries/priority-levels.js";
import { tracks } from "../db/schema/tracks.js";
import { setBindParamLimitForTest } from "../lib/chunk.js";
import type { Actor, Caller } from "../test/fixtures.js";
import { ENTITIES } from "./index.js";
import { setupSuite } from "../test/fixtures.js";

const suite = setupSuite("Bulk");
const {
  owner,
  editor,
  requireProject,
  request,
  requestAs,
  expectAccess,
  mkTrack,
  mkCollection,
  mkSession,
  mkStatus,
} = suite;

describe("bulk actions", () => {
  it("applies one patch to a list of track ids", async () => {
    requireProject();
    const a = await mkTrack("Bulk A");
    const b = await mkTrack("Bulk B");
    const c = await mkTrack("Bulk C");
    const status = await mkStatus("Bulk Target");

    const res = await request("owner", "/tracks/bulk", {
      method: "PATCH",
      body: JSON.stringify({
        projectId: suite.projectId,
        selection: { ids: [a, b] },
        patch: { statusId: status.id },
      }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ updated: 2 });

    const [aRow, bRow, cRow] = await Promise.all(
      [a, b, c].map(async (id) =>
        (await request("owner", `/tracks/${id}`)).json()
      )
    );
    expect(aRow.statusId).toBe(status.id);
    expect(bRow.statusId).toBe(status.id);
    expect(cRow.statusId).not.toBe(status.id);
  });

  it("select-all-matching honours the filter and stays inside the project", async () => {
    requireProject();
    const keep = await mkStatus("Bulk Keep");
    const move = await mkStatus("Bulk Move");
    const m1 = await mkTrack("SAM match 1");
    const m2 = await mkTrack("SAM match 2");
    const other = await mkTrack("SAM other");

    // Pin two tracks to `keep` so the filter has something to select.
    await request("owner", "/tracks/bulk", {
      method: "PATCH",
      body: JSON.stringify({
        projectId: suite.projectId,
        selection: { ids: [m1, m2] },
        patch: { statusId: keep.id },
      }),
    });

    const res = await request("owner", "/tracks/bulk", {
      method: "PATCH",
      body: JSON.stringify({
        projectId: suite.projectId,
        selection: { all: true, status: String(keep.id) },
        patch: { statusId: move.id },
      }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).updated).toBe(2);

    const otherRow = await (await request("owner", `/tracks/${other}`)).json();
    expect(otherRow.statusId).not.toBe(move.id);
  });

  it("rejects a bulk patch from a viewer and an outsider", async () => {
    requireProject();
    const t = await mkTrack("Bulk Gated");
    await expectAccess(
      "PATCH",
      "/tracks/bulk",
      { viewer: 403, editor: 200 },
      {
        projectId: suite.projectId,
        selection: { ids: [t] },
        patch: { title: "bulk-renamed" },
      }
    );
  });

  it("bulk-adds many tracks to a collection, ignoring existing members", async () => {
    requireProject();
    const col = await mkCollection("Bulk Add Target");
    const t1 = await mkTrack("BA 1");
    const t2 = await mkTrack("BA 2");

    await request("owner", `/collections/${col}/tracks`, {
      method: "POST",
      body: JSON.stringify({ trackId: t1 }),
    });

    const res = await request("owner", `/collections/${col}/tracks/bulk`, {
      method: "POST",
      body: JSON.stringify({ trackIds: [t1, t2] }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ added: 1 });

    const tracks = (await (
      await request("owner", `/collections/${col}/tracks`)
    ).json()) as { id: number }[];
    expect(tracks.map((t) => t.id).sort()).toEqual([t1, t2].sort());
  });

  it("bulk-updates collections and sessions too", async () => {
    requireProject();
    const status = await mkStatus("Bulk Coll Status");
    const c1 = await mkCollection("Bulk Coll 1");
    const c2 = await mkCollection("Bulk Coll 2");
    const collRes = await request("owner", "/collections/bulk", {
      method: "PATCH",
      body: JSON.stringify({
        projectId: suite.projectId,
        selection: { ids: [c1, c2] },
        patch: { statusId: status.id },
      }),
    });
    expect(collRes.status).toBe(200);
    expect((await collRes.json()).updated).toBe(2);

    const s1 = await mkSession({ name: "Bulk Sess 1" });
    const s2 = await mkSession({ name: "Bulk Sess 2" });
    const sessRes = await request("owner", "/sessions/bulk", {
      method: "PATCH",
      body: JSON.stringify({
        projectId: suite.projectId,
        selection: { ids: [s1.id, s2.id] },
        patch: { daw: "logic-pro" },
      }),
    });
    expect(sessRes.status).toBe(200);
    expect((await sessRes.json()).updated).toBe(2);
  });
});

describe("bulk labels", () => {
  async function mkLabel(name: string, projectId = suite.projectId) {
    const res = await request("owner", `/projects/${projectId}/labels`, {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    return (await res.json()) as { id: number; name: string };
  }

  async function labelNames(trackId: number): Promise<string[]> {
    const row = (await (
      await request("owner", `/tracks/${trackId}`)
    ).json()) as { labels: { name: string }[] };
    return row.labels.map((l) => l.name).sort();
  }

  const bulkLabels = (
    body: Record<string, unknown>,
    caller: Caller = "owner"
  ) =>
    request(caller, "/tracks/bulk/labels", {
      method: "PATCH",
      body: JSON.stringify({ projectId: suite.projectId, ...body }),
    });

  it("adds a label to a selection without touching a row's other labels", async () => {
    requireProject();
    const a = await mkLabel("Bulk Label A");
    const b = await mkLabel("Bulk Label B");
    const t1 = await mkTrack("Bulk Labels T1");
    const t2 = await mkTrack("Bulk Labels T2");

    await request("owner", `/tracks/${t1}/labels`, {
      method: "PUT",
      body: JSON.stringify({ labelIds: [a.id] }),
    });

    const res = await bulkLabels({
      selection: { ids: [t1, t2] },
      add: [b.id],
      remove: [],
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ updated: 2 });

    expect(await labelNames(t1)).toEqual(
      ["Bulk Label A", "Bulk Label B"].sort()
    );
    expect(await labelNames(t2)).toEqual(["Bulk Label B"]);
  });

  it("removes a label from a select-all-matching filter and leaves the rest alone", async () => {
    requireProject();
    const label = await mkLabel("Bulk Label Remove");
    const status = await mkStatus("Bulk Labels Status");
    const m1 = await mkTrack("Bulk Labels Filter M1");
    const m2 = await mkTrack("Bulk Labels Filter M2");
    const other = await mkTrack("Bulk Labels Filter Other");

    for (const id of [m1, m2, other]) {
      await request("owner", `/tracks/${id}/labels`, {
        method: "PUT",
        body: JSON.stringify({ labelIds: [label.id] }),
      });
    }
    await request("owner", "/tracks/bulk", {
      method: "PATCH",
      body: JSON.stringify({
        projectId: suite.projectId,
        selection: { ids: [m1, m2] },
        patch: { statusId: status.id },
      }),
    });

    const res = await bulkLabels({
      selection: { all: true, status: String(status.id) },
      add: [],
      remove: [label.id],
    });
    expect(res.status).toBe(200);
    expect((await res.json()).updated).toBe(2);

    expect(await labelNames(m1)).toEqual([]);
    expect(await labelNames(m2)).toEqual([]);
    expect(await labelNames(other)).toEqual(["Bulk Label Remove"]);
  });

  it("does not count a row that already carries every add label", async () => {
    requireProject();
    const label = await mkLabel("Bulk Label Noop");
    const already = await mkTrack("Bulk Labels Already");
    const fresh = await mkTrack("Bulk Labels Fresh");
    await request("owner", `/tracks/${already}/labels`, {
      method: "PUT",
      body: JSON.stringify({ labelIds: [label.id] }),
    });

    const res = await bulkLabels({
      selection: { ids: [already, fresh] },
      add: [label.id],
      remove: [],
    });
    expect(res.status).toBe(200);
    expect((await res.json()).updated).toBe(1);
  });

  it("refuses a label id in both add and remove", async () => {
    requireProject();
    const label = await mkLabel("Bulk Label Overlap");
    const t = await mkTrack("Bulk Labels Overlap");

    const res = await bulkLabels({
      selection: { ids: [t] },
      add: [label.id],
      remove: [label.id],
    });
    expect(res.status).toBe(400);
  });

  it("refuses a label from another project", async () => {
    requireProject();
    const created = await request("owner", "/projects", {
      method: "POST",
      body: JSON.stringify({
        name: `Bulk Labels Other ${Date.now()}`,
        links: [],
      }),
    });
    const otherProjectId = (await created.json()).id as number;
    const foreign = await mkLabel("Bulk Label Foreign", otherProjectId);
    const t = await mkTrack("Bulk Labels Foreign Target");

    const res = await bulkLabels({
      selection: { ids: [t] },
      add: [foreign.id],
      remove: [],
    });
    expect(res.status).toBe(400);

    await request("owner", `/projects/${otherProjectId}`, {
      method: "DELETE",
    });
  });

  it("refuses a viewer", async () => {
    requireProject();
    const label = await mkLabel("Bulk Label Viewer");
    const t = await mkTrack("Bulk Labels Viewer");

    await expectAccess(
      "PATCH",
      "/tracks/bulk/labels",
      { viewer: 403, editor: 200 },
      {
        projectId: suite.projectId,
        selection: { ids: [t] },
        add: [label.id],
        remove: [],
      }
    );
  });

  it("writes every row across a selection larger than one bind-parameter chunk", async () => {
    requireProject();
    const label = await mkLabel("Bulk Label Chunked");
    const trackIds = await Promise.all(
      Array.from({ length: 5 }, (_, i) => mkTrack(`Bulk Labels Chunk ${i}`))
    );

    // Low enough that the insert, the before/after reads and the remove
    // delete each split this 5-track selection across several chunks.
    setBindParamLimitForTest(5);
    try {
      const addRes = await bulkLabels({
        selection: { ids: trackIds },
        add: [label.id],
        remove: [],
      });
      expect(addRes.status).toBe(200);
      expect((await addRes.json()).updated).toBe(5);
      for (const id of trackIds) {
        expect(await labelNames(id)).toEqual(["Bulk Label Chunked"]);
      }

      const removeRes = await bulkLabels({
        selection: { ids: trackIds },
        add: [],
        remove: [label.id],
      });
      expect(removeRes.status).toBe(200);
      expect((await removeRes.json()).updated).toBe(5);
      for (const id of trackIds) {
        expect(await labelNames(id)).toEqual([]);
      }
    } finally {
      setBindParamLimitForTest(undefined);
    }
  });
});

describe("bulk delete", () => {
  /**
   * A project of the suite owner's own, so a selection can name rows the
   * gated project does not hold and the endpoint can be seen ignoring them.
   */
  let otherProjectId: number;
  let otherTrackId: number;
  let fixtureError: unknown = null;

  const requireFixture = () => {
    requireProject();
    if (fixtureError) {
      throw new Error(`bulk delete fixture failed: ${String(fixtureError)}`);
    }
  };

  beforeAll(async () => {
    if (suite.setUpFailed) return;
    try {
      const created = await request("owner", "/projects", {
        method: "POST",
        body: JSON.stringify({
          name: `Bulk Delete Other ${Date.now()}`,
          links: [],
        }),
      });
      otherProjectId = (await created.json()).id as number;

      const track = await request("owner", "/tracks", {
        method: "POST",
        body: JSON.stringify({
          title: "Foreign Track",
          artists: [],
          projectId: otherProjectId,
        }),
      });
      otherTrackId = (await track.json()).id as number;
    } catch (error) {
      fixtureError = error;
    }
  });

  afterAll(async () => {
    if (otherProjectId == null) return;
    await request("owner", `/projects/${otherProjectId}`, { method: "DELETE" });
  });

  const bulkDelete = (
    resource: string,
    selection: unknown,
    caller: Caller = "owner",
    scope = suite.projectId
  ) =>
    request(caller, `/${resource}/bulk`, {
      method: "DELETE",
      body: JSON.stringify({ projectId: scope, selection }),
    });

  it("deletes exactly the tracks an id list names", async () => {
    requireFixture();
    const doomed = [
      await mkTrack("Bulk Doomed A"),
      await mkTrack("Bulk Doomed B"),
    ];
    const spared = await mkTrack("Bulk Spared");

    const res = await bulkDelete("tracks", { ids: doomed });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: 2 });

    for (const id of doomed) {
      expect((await request("owner", `/tracks/${id}`)).status).toBe(404);
    }
    expect((await request("owner", `/tracks/${spared}`)).status).toBe(200);
  });

  it("deletes only the rows a filter selection matches", async () => {
    requireFixture();
    const status = await mkStatus("Bulk Filter");
    const matching = await mkTrack("Bulk Filtered In");
    const other = await mkTrack("Bulk Filtered Out");

    await request("owner", `/tracks/${matching}`, {
      method: "PATCH",
      body: JSON.stringify({ statusId: status.id }),
    });

    const res = await bulkDelete("tracks", { all: true, status: status.id });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: 1 });

    expect((await request("owner", `/tracks/${matching}`)).status).toBe(404);
    expect((await request("owner", `/tracks/${other}`)).status).toBe(200);
  });

  it("ignores ids belonging to another project and leaves them out of the count", async () => {
    requireFixture();
    const mine = await mkTrack("Bulk Mine");

    const res = await bulkDelete("tracks", { ids: [mine, otherTrackId] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: 1 });

    expect((await request("owner", `/tracks/${mine}`)).status).toBe(404);
    expect((await request("owner", `/tracks/${otherTrackId}`)).status).toBe(
      200
    );
  });

  it("refuses a viewer", async () => {
    requireFixture();
    const track = await mkTrack("Bulk Viewer Refused");

    const res = await bulkDelete("tracks", { ids: [track] }, "viewer");
    expect(res.status).toBe(403);
    expect((await request("owner", `/tracks/${track}`)).status).toBe(200);
  });

  it("writes one deleted activity row per track removed", async () => {
    requireFixture();
    const ids = [
      await mkTrack("Bulk Logged A"),
      await mkTrack("Bulk Logged B"),
    ];

    await bulkDelete("tracks", { ids });

    for (const id of ids) {
      const feed = await (
        await request(
          "owner",
          `/projects/${suite.projectId}/activity?entityType=track&entityId=${id}`
        )
      ).json();
      const deletions = feed.filter(
        (row: { action: string }) => row.action === "deleted"
      );
      expect(deletions).toHaveLength(1);
      expect(deletions[0].user?.id).toBe(owner.userId);
    }
  });

  it("deletes collections without taking their tracks with them", async () => {
    requireFixture();
    const collectionId = await mkCollection("Bulk Collection");
    const trackId = await mkTrack("Bulk Collection Track");
    await request("owner", `/collections/${collectionId}/tracks`, {
      method: "POST",
      body: JSON.stringify({ trackId }),
    });

    const res = await bulkDelete("collections", { ids: [collectionId] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: 1 });

    expect(
      (await request("owner", `/collections/${collectionId}`)).status
    ).toBe(404);
    expect((await request("owner", `/tracks/${trackId}`)).status).toBe(200);
  });

  it("deletes sessions an id list names", async () => {
    requireFixture();
    const session = await mkSession({ name: "Bulk Session" });

    const res = await bulkDelete("sessions", { ids: [session.id] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: 1 });
    expect((await request("owner", `/sessions/${session.id}`)).status).toBe(
      404
    );
  });
});

describe("moving an entity between projects", () => {
  /**
   * A second project the suite owner and editor both belong to, so a move has
   * somewhere legitimate to land, and a third the viewer is only a viewer in,
   * so the target-side role check has something to refuse.
   */
  let targetProjectId: number;
  let fixtureError: unknown = null;

  const requireFixture = () => {
    requireProject();
    if (fixtureError) {
      throw new Error(`move fixture failed: ${String(fixtureError)}`);
    }
  };

  /** Invites `actor` into `intoProject` at `role`, the way a real user joins. */
  async function join(
    actor: Actor,
    intoProject: number,
    role: "editor" | "viewer"
  ) {
    const invited = await request("owner", `/projects/${intoProject}/invites`, {
      method: "POST",
      body: JSON.stringify({ email: actor.email, role }),
    });
    const { token } = await invited.json();
    await requestAs(actor, `/invites/${token}/accept`, { method: "POST" });
  }

  beforeAll(async () => {
    if (suite.setUpFailed) return;
    try {
      const created = await request("owner", "/projects", {
        method: "POST",
        body: JSON.stringify({
          name: `Move Target ${Date.now()}`,
          links: [],
        }),
      });
      targetProjectId = (await created.json()).id as number;
      await join(editor, targetProjectId, "viewer");
    } catch (error) {
      fixtureError = error;
    }
  });

  afterAll(async () => {
    if (targetProjectId == null) return;
    await request("owner", `/projects/${targetProjectId}`, {
      method: "DELETE",
    });
  });

  const move = (
    resource: string,
    id: number,
    intoProject: number,
    caller: Caller = "owner"
  ) =>
    request(caller, `/${resource}/${id}/move`, {
      method: "POST",
      body: JSON.stringify({ projectId: intoProject }),
    });

  const moveBulk = (
    resource: string,
    selection: unknown,
    intoProject: number,
    caller: Caller = "owner"
  ) =>
    request(caller, `/${resource}/bulk/move`, {
      method: "POST",
      body: JSON.stringify({
        projectId: suite.projectId,
        selection,
        targetProjectId: intoProject,
      }),
    });

  it("re-homes a track and answers with the moved row", async () => {
    requireFixture();
    const trackId = await mkTrack("Route Move Track");

    const res = await move("tracks", trackId, targetProjectId);
    expect(res.status).toBe(200);
    expect((await res.json()).projectId).toBe(targetProjectId);

    const read = await request("owner", `/tracks/${trackId}`);
    expect((await read.json()).projectId).toBe(targetProjectId);
  });

  it("re-homes a collection and a session", async () => {
    requireFixture();
    const collectionId = await mkCollection("Route Move Collection");
    const session = await mkSession({ name: "Route Move Session" });

    const movedCollection = await move(
      "collections",
      collectionId,
      targetProjectId
    );
    expect(movedCollection.status).toBe(200);
    expect((await movedCollection.json()).projectId).toBe(targetProjectId);

    const movedSession = await move("sessions", session.id, targetProjectId);
    expect(movedSession.status).toBe(200);
    expect((await movedSession.json()).projectId).toBe(targetProjectId);
  });

  it("refuses a caller who is not an editor in the target project", async () => {
    requireFixture();
    const trackId = await mkTrack("Route Move Refused");

    const res = await move("tracks", trackId, targetProjectId, "editor");
    expect(res.status).toBe(403);

    const read = await request("owner", `/tracks/${trackId}`);
    expect((await read.json()).projectId).toBe(suite.projectId);
  });

  it("refuses a target project the caller cannot see, without saying so", async () => {
    requireFixture();
    const trackId = await mkTrack("Route Move Unseen");

    const res = await move("tracks", trackId, 2_000_000_000);
    expect(res.status).toBe(403);
  });

  it("refuses a move into the project the entity is already in", async () => {
    requireFixture();
    const trackId = await mkTrack("Route Move No-op");

    const res = await move("tracks", trackId, suite.projectId);
    expect(res.status).toBe(400);
  });

  it("refuses a viewer in the source project", async () => {
    requireFixture();
    const trackId = await mkTrack("Route Move Viewer");

    const res = await move("tracks", trackId, targetProjectId, "viewer");
    expect(res.status).toBe(403);
  });

  it("records the move in both projects' feeds", async () => {
    requireFixture();
    const trackId = await mkTrack("Route Move Logged");

    await move("tracks", trackId, targetProjectId);

    for (const feedProject of [suite.projectId, targetProjectId]) {
      const feed = await (
        await request(
          "owner",
          `/projects/${feedProject}/activity?entityType=track&entityId=${trackId}`
        )
      ).json();
      const moved = feed.find(
        (row: { action: string; changes?: Record<string, unknown> }) =>
          row.action === "updated" && row.changes?.projectId
      );
      expect(moved.changes.projectId).toEqual({
        from: suite.projectId,
        to: targetProjectId,
      });
    }
  });

  it("moves an explicit id selection into another project", async () => {
    requireFixture();
    const a = await mkTrack("Bulk Move A");
    const b = await mkTrack("Bulk Move B");

    const res = await moveBulk("tracks", { ids: [a, b] }, targetProjectId);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      moved: 2,
      droppedFields: [],
      priorityFallbacks: [],
    });

    const read = await request("owner", `/tracks/${a}`);
    expect((await read.json()).projectId).toBe(targetProjectId);
  });

  it("moves the select-all-matching filtered set", async () => {
    requireFixture();
    const status = await mkStatus("Bulk Move Filtered");
    const a = await mkTrack("Bulk Move Filtered A");
    const b = await mkTrack("Bulk Move Filtered B");
    await mkTrack("Bulk Move Filtered Unselected");
    await request("owner", "/tracks/bulk", {
      method: "PATCH",
      body: JSON.stringify({
        projectId: suite.projectId,
        selection: { ids: [a, b] },
        patch: { statusId: status.id },
      }),
    });

    const res = await moveBulk(
      "tracks",
      { all: true, status: String(status.id) },
      targetProjectId
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      moved: 2,
      droppedFields: [],
      priorityFallbacks: [],
    });
  });

  it("answers 200 { moved: 0 } for a selection nothing matches, spending no transaction", async () => {
    requireFixture();

    const res = await moveBulk(
      "tracks",
      { all: true, status: -1 },
      targetProjectId
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      moved: 0,
      droppedFields: [],
      priorityFallbacks: [],
    });
  });

  it("refuses a caller who is not an editor in the target project", async () => {
    requireFixture();
    const trackId = await mkTrack("Bulk Move Refused");

    const res = await moveBulk(
      "tracks",
      { ids: [trackId] },
      targetProjectId,
      "editor"
    );
    expect(res.status).toBe(403);

    const read = await request("owner", `/tracks/${trackId}`);
    expect((await read.json()).projectId).toBe(suite.projectId);
  });

  it("refuses a viewer in the source project", async () => {
    requireFixture();
    const trackId = await mkTrack("Bulk Move Viewer");

    const res = await moveBulk(
      "tracks",
      { ids: [trackId] },
      targetProjectId,
      "viewer"
    );
    expect(res.status).toBe(403);
  });
});

describe("selectIds", () => {
  it("resolves an id list to only the ids within the project", async () => {
    requireProject();
    const mine = await mkTrack("SelectIds Mine");
    await mkTrack("SelectIds Other Not Selected");

    const ids = await ENTITIES.track.list!.selectIds(suite.projectId, {
      ids: [mine, mine + 1_000_000],
    });
    expect(ids).toEqual([mine]);
  });

  it("resolves select-all-matching to the filtered set, ordered by id", async () => {
    requireProject();
    const status = await mkStatus("SelectIds Status");
    const a = await mkTrack("SelectIds Filtered A");
    const b = await mkTrack("SelectIds Filtered B");
    await mkTrack("SelectIds Unfiltered");

    await request("owner", "/tracks/bulk", {
      method: "PATCH",
      body: JSON.stringify({
        projectId: suite.projectId,
        selection: { ids: [a, b] },
        patch: { statusId: status.id },
      }),
    });

    const selection = bulkSelectionSchema.parse({
      all: true,
      status: String(status.id),
    });
    const ids = await ENTITIES.track.list!.selectIds(
      suite.projectId,
      selection
    );
    expect(ids).toEqual([a, b].sort((x, y) => x - y));
  });

  it("returns an empty list when nothing matches", async () => {
    requireProject();
    const ids = await ENTITIES.track.list!.selectIds(suite.projectId, {
      ids: [9_999_999],
    });
    expect(ids).toEqual([]);
  });

  it("resolves collection and session ids the same way", async () => {
    requireProject();
    const c1 = await mkCollection("SelectIds Collection 1");
    const c2 = await mkCollection("SelectIds Collection 2");
    const collIds = await ENTITIES.collection.list!.selectIds(suite.projectId, {
      ids: [c2, c1],
    });
    expect(collIds).toEqual([c1, c2].sort((x, y) => x - y));

    const s1 = await mkSession({ name: "SelectIds Session 1" });
    const sessIds = await ENTITIES.session.list!.selectIds(suite.projectId, {
      ids: [s1.id],
    });
    expect(sessIds).toEqual([s1.id]);
  });
});

describe("bulk archive and unarchive", () => {
  let otherProjectId: number;
  let otherTrackId: number;
  let fixtureError: unknown = null;

  const requireFixture = () => {
    requireProject();
    if (fixtureError) {
      throw new Error(`bulk archive fixture failed: ${String(fixtureError)}`);
    }
  };

  beforeAll(async () => {
    if (suite.setUpFailed) return;
    try {
      const created = await request("owner", "/projects", {
        method: "POST",
        body: JSON.stringify({
          name: `Bulk Archive Other ${Date.now()}`,
          links: [],
        }),
      });
      otherProjectId = (await created.json()).id as number;

      const track = await request("owner", "/tracks", {
        method: "POST",
        body: JSON.stringify({
          title: "Archive Foreign Track",
          artists: [],
          projectId: otherProjectId,
        }),
      });
      otherTrackId = (await track.json()).id as number;
    } catch (error) {
      fixtureError = error;
    }
  });

  afterAll(async () => {
    if (otherProjectId == null) return;
    await request("owner", `/projects/${otherProjectId}`, { method: "DELETE" });
  });

  const setArchived = (
    verb: "archive" | "unarchive",
    selection: unknown,
    caller: Caller = "owner"
  ) =>
    request(caller, `/tracks/bulk/${verb}`, {
      method: "POST",
      body: JSON.stringify({ projectId: suite.projectId, selection }),
    });

  const archivedAtOf = async (ids: number[]) => {
    const rows = await db
      .select({ id: tracks.id, archivedAt: tracks.archivedAt })
      .from(tracks)
      .where(inArray(tracks.id, ids));
    return new Map(rows.map((row) => [row.id, row.archivedAt]));
  };

  const actionsOf = async (trackId: number) => {
    const feed = (await (
      await request(
        "owner",
        `/projects/${suite.projectId}/activity?entityType=track&entityId=${trackId}`
      )
    ).json()) as { action: string }[];
    return feed.map((row) => row.action);
  };

  it("archives the selected tracks, answers what changed and logs one archived row each", async () => {
    requireFixture();
    const a = await mkTrack("Archive A");
    const b = await mkTrack("Archive B");
    await mkSession({ name: "Archive A 1", trackId: a });
    await mkSession({ name: "Archive A 2", trackId: a });
    await mkSession({ name: "Archive B 1", trackId: b });

    const res = await setArchived("archive", { ids: [a, b] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ids: [a, b].sort((x, y) => x - y),
      sessionCount: 3,
    });

    const archivedAt = await archivedAtOf([a, b]);
    expect(archivedAt.get(a)).toBeInstanceOf(Date);
    expect(archivedAt.get(b)).toBeInstanceOf(Date);
    for (const id of [a, b]) {
      expect(
        (await actionsOf(id)).filter((action) => action === "archived")
      ).toHaveLength(1);
    }
  });

  it("answers empty and logs nothing when the tracks are already archived", async () => {
    requireFixture();
    const t = await mkTrack("Archive Twice");
    await setArchived("archive", { ids: [t] });
    const first = (await archivedAtOf([t])).get(t);

    const res = await setArchived("archive", { ids: [t] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ids: [], sessionCount: 0 });

    expect((await archivedAtOf([t])).get(t)).toEqual(first);
    expect(
      (await actionsOf(t)).filter((action) => action === "archived")
    ).toHaveLength(1);
  });

  it("unarchives the tracks and logs an unarchived row each", async () => {
    requireFixture();
    const t = await mkTrack("Archive Undo");
    await mkSession({ name: "Archive Undo 1", trackId: t });
    await setArchived("archive", { ids: [t] });

    const res = await setArchived("unarchive", { ids: [t] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ids: [t], sessionCount: 1 });

    expect((await archivedAtOf([t])).get(t)).toBeNull();
    expect(
      (await actionsOf(t)).filter((action) => action === "unarchived")
    ).toHaveLength(1);

    const again = await setArchived("unarchive", { ids: [t] });
    expect(await again.json()).toEqual({ ids: [], sessionCount: 0 });
    expect(
      (await actionsOf(t)).filter((action) => action === "unarchived")
    ).toHaveLength(1);
  });

  it("answers only the rows that changed for a mixed selection", async () => {
    requireFixture();
    const archived = await mkTrack("Archive Mixed Done");
    const live = await mkTrack("Archive Mixed Live");
    await setArchived("archive", { ids: [archived] });

    const res = await setArchived("archive", { ids: [archived, live] });
    expect(await res.json()).toEqual({ ids: [live], sessionCount: 0 });
    expect(
      (await actionsOf(archived)).filter((action) => action === "archived")
    ).toHaveLength(1);
    expect(
      (await actionsOf(live)).filter((action) => action === "archived")
    ).toHaveLength(1);
  });

  it("resolves an all-matching selection through the list's filters", async () => {
    requireFixture();
    const hit = await mkTrack("Archive Filter Hit");
    const miss = await mkTrack("Archive Other Miss");

    const res = await setArchived("archive", {
      all: true,
      q: "Archive Filter Hit",
    });
    expect(await res.json()).toEqual({ ids: [hit], sessionCount: 0 });
    expect((await archivedAtOf([miss])).get(miss)).toBeNull();
  });

  it("ignores an id from another project", async () => {
    requireFixture();
    const own = await mkTrack("Archive Own");

    const res = await setArchived("archive", { ids: [own, otherTrackId] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ids: [own], sessionCount: 0 });
    expect((await archivedAtOf([otherTrackId])).get(otherTrackId)).toBeNull();

    const alone = await setArchived("archive", { ids: [otherTrackId] });
    expect(await alone.json()).toEqual({ ids: [], sessionCount: 0 });
  });

  it("refuses a viewer and an outsider, and lets an editor through", async () => {
    requireFixture();
    const t = await mkTrack("Archive Gated");
    for (const verb of ["archive", "unarchive"] as const) {
      await expectAccess(
        "POST",
        `/tracks/bulk/${verb}`,
        { viewer: 403, editor: 200 },
        { projectId: suite.projectId, selection: { ids: [t] } }
      );
    }
  });
});

describe("session selections and archived tracks", () => {
  /** A live-track session, an archived-track session and an unlinked one, all named `prefix …`. */
  async function mkArchiveSessions(prefix: string) {
    const liveTrack = await mkTrack(`${prefix} Live Track`);
    const archivedTrack = await mkTrack(`${prefix} Archived Track`);
    await db
      .update(tracks)
      .set({ archivedAt: new Date() })
      .where(eq(tracks.id, archivedTrack));
    const live = await mkSession({
      name: `${prefix} live`,
      trackId: liveTrack,
    });
    const archived = await mkSession({
      name: `${prefix} archived`,
      trackId: archivedTrack,
    });
    const unlinked = await mkSession({ name: `${prefix} unlinked` });
    return { live: live.id, archived: archived.id, unlinked: unlinked.id };
  }

  it("an id list reaches a session of an archived track", async () => {
    requireProject();
    const s = await mkArchiveSessions("ArchSel Ids");

    const res = await request("owner", "/sessions/bulk", {
      method: "PATCH",
      body: JSON.stringify({
        projectId: suite.projectId,
        selection: { ids: [s.archived, s.live] },
        patch: { daw: "logic-pro" },
      }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ updated: 2 });

    const ids = await ENTITIES.session.list!.selectIds(suite.projectId, {
      ids: [s.archived],
    });
    expect(ids).toEqual([s.archived]);
  });

  it("select-all-matching follows its archived filter", async () => {
    requireProject();
    const s = await mkArchiveSessions("ArchSel All");
    const selectAll = (filters: Record<string, string> = {}) =>
      ENTITIES.session.list!.selectIds(
        suite.projectId,
        bulkSelectionSchema.parse({ all: true, q: "ArchSel All", ...filters })
      );
    const sorted = (ids: number[]) => [...ids].sort((x, y) => x - y);

    expect(await selectAll()).toEqual(sorted([s.live, s.unlinked]));
    expect(await selectAll({ archived: "only" })).toEqual([s.archived]);
    expect(await selectAll({ archived: "include" })).toEqual(
      sorted([s.live, s.archived, s.unlinked])
    );
    expect(await selectAll({ archived: "bogus" })).toEqual(
      sorted([s.live, s.unlinked])
    );

    const res = await request("owner", "/sessions/bulk", {
      method: "PATCH",
      body: JSON.stringify({
        projectId: suite.projectId,
        selection: { all: true, q: "ArchSel All" },
        patch: { daw: "logic-pro" },
      }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ updated: 2 });
  });
});

describe("track bulk archive scope", () => {
  const archive = (trackId: number) =>
    db
      .update(tracks)
      .set({ archivedAt: new Date() })
      .where(eq(tracks.id, trackId));

  /** The suite project's level of this name, from the scale it starts with. */
  const level = async (name: string) =>
    (await levelByName(suite.projectId, name))!.id;

  const priorityOf = async (trackId: number) =>
    (
      await db
        .select({ priorityId: tracks.priorityId })
        .from(tracks)
        .where(eq(tracks.id, trackId))
    )[0]?.priorityId;

  const patchPriority = async (
    selection: Record<string, unknown>,
    levelName: string
  ) =>
    request("owner", "/tracks/bulk", {
      method: "PATCH",
      body: JSON.stringify({
        projectId: suite.projectId,
        selection,
        patch: { priorityId: await level(levelName) },
      }),
    });

  it("reaches an archived track named by id", async () => {
    requireProject();
    const archived = await mkTrack("BulkArc ById");
    await archive(archived);

    const res = await patchPriority({ ids: [archived] }, "High");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ updated: 1 });
    expect(await priorityOf(archived)).toBe(await level("High"));
  });

  it("skips archived tracks in an all-matching selection unless it asks for them", async () => {
    requireProject();
    const live = await mkTrack("BulkArcAll live");
    const archived = await mkTrack("BulkArcAll gone");
    await archive(archived);

    const byDefault = await patchPriority(
      { all: true, q: "BulkArcAll" },
      "High"
    );
    expect(await byDefault.json()).toEqual({ updated: 1 });
    expect(await priorityOf(live)).toBe(await level("High"));
    expect(await priorityOf(archived)).toBe(await level("None"));

    const onlyArchived = await patchPriority(
      { all: true, q: "BulkArcAll", archived: "only" },
      "Low"
    );
    expect(await onlyArchived.json()).toEqual({ updated: 1 });
    expect(await priorityOf(live)).toBe(await level("High"));
    expect(await priorityOf(archived)).toBe(await level("Low"));
  });
});
