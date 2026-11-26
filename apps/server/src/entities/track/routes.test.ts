import { existsSync } from "node:fs";
import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "bun:test";
import { db } from "../../db/index.js";
import { addTrackRelation } from "../../db/queries/track-relations.js";
import { trackRelationTypes } from "../../db/schema/track-relation-types.js";
import { levelByName } from "../../db/queries/priority-levels.js";
import { withProjectPolicyForTest } from "../../db/queries/project-policy.js";
import { relationTypeByName } from "../../db/queries/track-relation-types.js";
import { assets } from "../../db/schema/assets.js";
import { entityLabels } from "../../db/schema/labels.js";
import { saves } from "../../db/schema/saves.js";
import { statuses } from "../../db/schema/statuses.js";
import { trackAudios, tracks } from "../../db/schema/tracks.js";
import { type Actor, onDiskPath, setupSuite } from "../../test/fixtures.js";
import { makeAudible, settleJobs } from "../../test/media.js";

const suite = setupSuite("Track");
const {
  requireProject,
  request,
  expectAccess,
  mkTrack,
  mkCollection,
  mkSession,
  mkStatus,
  mkPrimaryAudioWithLoudness,
  uploadAsset,
} = suite;

/**
 * Links a fresh audio to a track, lets analysis run, and returns the
 * spectrogram PNG's stored key — a stable point to check that a cascading
 * delete removed the file along with the row that named it.
 */
async function analysedSpectrogramKey(
  trackId: number,
  name: string
): Promise<string> {
  const asset = await uploadAsset(name);
  await makeAudible(asset.assetPath);

  const linked = await request("owner", `/tracks/${trackId}/audios`, {
    method: "POST",
    body: JSON.stringify({ assetIds: [asset.id] }),
  });
  expect(linked.status).toBe(201);
  await settleJobs((await linked.json()).analysisJobIds);

  const [row] = await db
    .select({ spectrogramKey: trackAudios.spectrogramKey })
    .from(trackAudios)
    .where(eq(trackAudios.assetId, asset.id));
  if (!row?.spectrogramKey) {
    throw new Error("expected the linked audio to have a spectrogram key");
  }
  return row.spectrogramKey;
}

describe("tracks", () => {
  it("matches a search term's underscore literally, not as a wildcard", async () => {
    requireProject();
    await mkTrack("esc_trk literal");
    await mkTrack("escXtrk wildcard");

    const res = await request(
      "owner",
      `/projects/${suite.projectId}/tracks/paginated?q=esc_trk`
    );
    expect(res.status).toBe(200);
    const page = (await res.json()) as {
      rows: { title: string }[];
      rowCount: number;
    };
    expect(page.rows.map((r) => r.title)).toEqual(["esc_trk literal"]);
    expect(page.rowCount).toBe(1);
  });

  it("creates, reads, updates, and deletes a track", async () => {
    requireProject();

    const created = await request("owner", "/tracks", {
      method: "POST",
      body: JSON.stringify({
        title: "CRUD Track",
        artists: ["Artist 1", "Artist 2"],
        projectId: suite.projectId,
      }),
    });
    expect(created.status).toBe(201);
    const track = await created.json();
    expect(track.title).toBe("CRUD Track");
    expect(track.artists).toEqual(["Artist 1", "Artist 2"]);

    const fetched = await (
      await request("viewer", `/tracks/${track.id}`)
    ).json();
    expect(fetched.id).toBe(track.id);

    const patched = await request("owner", `/tracks/${track.id}`, {
      method: "PATCH",
      body: JSON.stringify({ title: "Patched" }),
    });
    expect(patched.status).toBe(200);
    expect((await patched.json()).title).toBe("Patched");

    const deleted = await request("owner", `/tracks/${track.id}`, {
      method: "DELETE",
    });
    expect(deleted.status).toBe(204);
    expect(await deleted.text()).toBe("");
  });

  it("patching statusId sets the status", async () => {
    requireProject();
    const trackId = await mkTrack("Status Patch Track");
    const status = await mkStatus("Track Status");

    const patched = await request("owner", `/tracks/${trackId}`, {
      method: "PATCH",
      body: JSON.stringify({ statusId: status.id }),
    });
    expect(patched.status).toBe(200);
    expect((await patched.json()).statusId).toBe(status.id);
  });

  it("a status from another project is refused", async () => {
    requireProject();
    const trackId = await mkTrack("Foreign Status Track");

    const otherProject = await request("owner", "/projects", {
      method: "POST",
      body: JSON.stringify({
        name: `Foreign Status Project ${Date.now()}`,
        links: [],
      }),
    });
    const otherProjectId = (await otherProject.json()).id as number;

    const foreignStatus = await request("owner", "/statuses", {
      method: "POST",
      body: JSON.stringify({
        name: "Foreign Status",
        percentage: 50,
        projectId: otherProjectId,
      }),
    });
    expect(foreignStatus.status).toBe(201);
    const { id: foreignStatusId } = (await foreignStatus.json()) as {
      id: number;
    };

    const res = await request("owner", `/tracks/${trackId}`, {
      method: "PATCH",
      body: JSON.stringify({ statusId: foreignStatusId }),
    });
    expect(res.status).toBe(404);
  });

  it("removes a track's spectrogram PNGs when it is deleted", async () => {
    requireProject();
    const trackId = await mkTrack("Spectrogram Delete Track");
    const key = await analysedSpectrogramKey(
      trackId,
      "track-delete-spectrogram.wav"
    );
    expect(existsSync(onDiskPath(key))).toBe(true);

    const deleted = await request("owner", `/tracks/${trackId}`, {
      method: "DELETE",
    });
    expect(deleted.status).toBe(204);
    expect(await deleted.text()).toBe("");

    // The track's versions cascade away with it, so the PNG one of them
    // named has to be cleaned up too rather than left behind under
    // `static/analysis/`.
    expect(existsSync(onDiskPath(key))).toBe(false);
  });

  it("removes a bulk-deleted track's spectrogram PNGs too", async () => {
    requireProject();
    const trackId = await mkTrack("Bulk Spectrogram Track");
    const key = await analysedSpectrogramKey(
      trackId,
      "bulk-delete-spectrogram.wav"
    );
    expect(existsSync(onDiskPath(key))).toBe(true);

    const bulk = await request("owner", "/tracks/bulk", {
      method: "DELETE",
      body: JSON.stringify({
        projectId: suite.projectId,
        selection: { ids: [trackId] },
      }),
    });
    expect(bulk.status).toBe(200);

    expect(existsSync(onDiskPath(key))).toBe(false);
  });

  it("derives key and bpm from the track's main session", async () => {
    requireProject();
    const trackId = await mkTrack("Music Meta Track");

    const fresh = await (await request("viewer", `/tracks/${trackId}`)).json();
    expect(fresh.key).toBeNull();
    expect(fresh.keyTonic).toBeNull();
    expect(fresh.keyScale).toBeNull();
    expect(fresh.bpm).toBeNull();

    // A non-main session must not contribute — only the main one does.
    await mkSession({
      trackId,
      main: false,
      tempo: "90",
      rootNote: "A",
      scale: "Major",
    });
    const stillBare = await (
      await request("viewer", `/tracks/${trackId}`)
    ).json();
    expect(stillBare.key).toBeNull();
    expect(stillBare.bpm).toBeNull();

    await mkSession({
      trackId,
      main: true,
      tempo: "128.5",
      rootNote: "C#",
      scale: "Minor",
    });
    const withMain = await (
      await request("viewer", `/tracks/${trackId}`)
    ).json();
    expect(withMain.key).toBe("C# Minor");
    expect(withMain.keyTonic).toBe("C#");
    expect(withMain.keyScale).toBe("Minor");
    expect(withMain.bpm).toBe("128.5");

    // The listing and the summaries carry the same halves as the detail.
    const halves = { key: "C# Minor", keyTonic: "C#", keyScale: "Minor" };
    const listing = (await (
      await request(
        "viewer",
        `/projects/${suite.projectId}/tracks/paginated?q=Music%20Meta%20Track`
      )
    ).json()) as { rows: { id: number }[] };
    expect(listing.rows.find((row) => row.id === trackId)).toMatchObject(
      halves
    );
    const summaries = (await (
      await request("viewer", `/projects/${suite.projectId}/tracks/summary`)
    ).json()) as { id: number }[];
    expect(summaries.find((row) => row.id === trackId)).toMatchObject(halves);
  });

  it("gates track endpoints by role", async () => {
    requireProject();
    const trackId = await mkTrack("Gated Track");

    await expectAccess("GET", `/tracks/${trackId}`, { viewer: 200 });
    await expectAccess("GET", `/tracks/${trackId}/attachments`, {
      viewer: 200,
    });
    await expectAccess("GET", `/tracks/${trackId}/audios`, { viewer: 200 });
    await expectAccess("GET", `/tracks/${trackId}/candidate-audios`, {
      viewer: 200,
    });

    await expectAccess(
      "PATCH",
      `/tracks/${trackId}`,
      { viewer: 403, editor: 200 },
      { title: "Editor Renamed" }
    );
    // Creating a track names its project in the body, so the gate reads the
    // body rather than the path.
    await expectAccess(
      "POST",
      "/tracks",
      { viewer: 403, editor: 201 },
      { title: "Body-scoped", artists: [], projectId: suite.projectId }
    );

    await expectAccess("DELETE", `/tracks/${trackId}`, {
      viewer: 403,
      editor: 204,
    });
  });

  it("answers an outsider the same 404 a nonexistent track id gets, never 403", async () => {
    requireProject();
    const trackId = await mkTrack("Invisible To Outsiders");

    const forReal = await request("outsider", `/tracks/${trackId}`);
    const forMissing = await request("outsider", "/tracks/999999999");

    expect(forReal.status).toBe(404);
    expect(forMissing.status).toBe(404);
    const { error: realError } = (await forReal.json()) as { error: string };
    const { error: missingError } = (await forMissing.json()) as {
      error: string;
    };
    expect(realError).toBe(missingError);
  });

  it("400s a malformed track id", async () => {
    requireProject();
    const res = await request("owner", "/tracks/not-a-number");
    expect(res.status).toBe(400);
  });

  // A track's response carries a non-null `status`, so a null one is refused
  // at the door rather than stored and 500ing every read of the track.
  it("refuses a null status on create and edit", async () => {
    requireProject();
    const created = await request("owner", "/tracks", {
      method: "POST",
      body: JSON.stringify({
        title: "Statusless",
        projectId: suite.projectId,
        statusId: null,
      }),
    });
    expect(created.status).toBe(400);

    const t = await mkTrack("Keeps its status");
    const edited = await request("owner", `/tracks/${t}`, {
      method: "PATCH",
      body: JSON.stringify({ statusId: null }),
    });
    expect(edited.status).toBe(400);
    expect((await request("owner", `/tracks/${t}`)).status).toBe(200);
  });

  it("ignores notesText sent in a create body", async () => {
    requireProject();

    const created = await request("owner", "/tracks", {
      method: "POST",
      body: JSON.stringify({
        title: "Generated Column Track",
        artists: [],
        projectId: suite.projectId,
        notesText: "hand-written notes text",
      }),
    });
    expect(created.status).toBe(201);
    const track = await created.json();
    expect(track.notesText).toBeNull();
  });

  it("lists a track's attachments as a plain asset list", async () => {
    requireProject();
    const trackId = await mkTrack("Attachments Track");
    const a1 = await uploadAsset("att-1.jpeg");
    const a2 = await uploadAsset("att-2.jpeg");

    for (const id of [a1.id, a2.id]) {
      const res = await request("owner", `/tracks/${trackId}/attachments`, {
        method: "POST",
        body: JSON.stringify({ assetId: id }),
      });
      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({ message: "Attachment added" });
    }

    const list = await request("viewer", `/tracks/${trackId}/attachments`);
    expect(list.status).toBe(200);
    const rows = (await list.json()) as { id: number }[];
    expect(rows.map((r) => r.id).sort()).toEqual([a1.id, a2.id].sort());
  });

  it("409s attaching the same asset to a track twice", async () => {
    requireProject();
    const trackId = await mkTrack("Twice Attached Track");
    const asset = await uploadAsset("track-attachment-twice.jpeg");
    const attach = () =>
      request("owner", `/tracks/${trackId}/attachments`, {
        method: "POST",
        body: JSON.stringify({ assetId: asset.id }),
      });

    expect((await attach()).status).toBe(201);
    expect((await attach()).status).toBe(409);

    const rows = (await (
      await request("owner", `/tracks/${trackId}/attachments`)
    ).json()) as { id: number }[];
    expect(rows).toHaveLength(1);
  });

  it("links an audio asset and returns the queued analysis job's id", async () => {
    requireProject();
    const trackId = await mkTrack("Audio Link Track");
    const asset = await uploadAsset("bounce.wav");

    const res = await request("owner", `/tracks/${trackId}/audios`, {
      method: "POST",
      body: JSON.stringify({ assetIds: [asset.id] }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      audios: { id: number; asset: { id: number } }[];
      analysisJobIds: number[];
    };
    expect(body.audios).toHaveLength(1);
    expect(body.audios[0]!.asset.id).toBe(asset.id);
    expect(body.analysisJobIds).toHaveLength(1);
    expect(Number.isInteger(body.analysisJobIds[0])).toBe(true);
  });

  it("queues no analysis job for an asset that is not audio", async () => {
    requireProject();
    const trackId = await mkTrack("Non-Audio Link Track");
    const asset = await uploadAsset("cover.jpeg");

    const res = await request("owner", `/tracks/${trackId}/audios`, {
      method: "POST",
      body: JSON.stringify({ assetIds: [asset.id] }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      audios: unknown[];
      analysisJobIds: number[];
    };
    expect(body.audios).toHaveLength(0);
    expect(body.analysisJobIds).toHaveLength(0);
  });
});

/** The suite project's relation type of this name, as `{ id, name }`. */
async function relationType(name: string) {
  const type = await relationTypeByName(suite.projectId, name);
  if (!type) throw new Error(`no relation type "${name}"`);
  return { id: type.id, name: type.name };
}

describe("track relations", () => {
  it("links two tracks and exposes the relation from both ends", async () => {
    requireProject();
    const remix = await mkTrack("The Remix");
    const original = await mkTrack("The Original");
    const type = await relationType("remix");

    const created = await request("owner", `/tracks/${remix}/relations`, {
      method: "POST",
      body: JSON.stringify({ toTrackId: original, relationTypeId: type.id }),
    });
    expect(created.status).toBe(201);
    const relation = await created.json();
    expect(relation).toMatchObject({
      fromTrackId: remix,
      toTrackId: original,
      relationTypeId: type.id,
      relationType: type,
    });

    const remixView = await (
      await request("viewer", `/tracks/${remix}`)
    ).json();
    expect(remixView.relations).toContainEqual(
      expect.objectContaining({
        direction: "from",
        relationType: type,
        otherTrack: expect.objectContaining({ id: original }),
      })
    );

    const originalView = await (
      await request("viewer", `/tracks/${original}`)
    ).json();
    expect(originalView.relations).toContainEqual(
      expect.objectContaining({
        direction: "to",
        relationType: type,
        otherTrack: expect.objectContaining({ id: remix }),
      })
    );

    const removed = await request(
      "owner",
      `/tracks/${original}/relations/${relation.id}`,
      { method: "DELETE" }
    );
    expect(removed.status).toBe(204);

    const after = await (await request("viewer", `/tracks/${remix}`)).json();
    expect(after.relations).toHaveLength(0);
  });

  it("rejects a self-relation", async () => {
    requireProject();
    const t = await mkTrack("Narcissus");
    const res = await request("owner", `/tracks/${t}/relations`, {
      method: "POST",
      body: JSON.stringify({
        toTrackId: t,
        relationTypeId: (await relationType("edit")).id,
      }),
    });
    expect(res.status).toBe(400);
  });

  it("refuses another project's relation type with a 400, and a missing one", async () => {
    requireProject();
    const a = await mkTrack("Foreign Type From");
    const b = await mkTrack("Foreign Type To");
    const elsewhere = await suite.throwawayProject("Foreign Relation Type");
    const foreign = await relationTypeByName(elsewhere.id, "remix");

    for (const relationTypeId of [foreign!.id, 2_000_000_000]) {
      const res = await request("owner", `/tracks/${a}/relations`, {
        method: "POST",
        body: JSON.stringify({ toTrackId: b, relationTypeId }),
      });
      expect(res.status).toBe(400);
    }
    const res = await request("owner", `/tracks/${a}/relations`, {
      method: "POST",
      body: JSON.stringify({ toTrackId: b }),
    });
    expect(res.status).toBe(400);

    const view = await (await request("viewer", `/tracks/${a}`)).json();
    expect(view.relations).toEqual([]);
  });

  it("answers a relation whose type was deleted after the check with the same 400", async () => {
    requireProject();
    const a = await mkTrack("Raced Type From");
    const b = await mkTrack("Raced Type To");
    const [gone] = await db
      .insert(trackRelationTypes)
      .values({ projectId: suite.projectId, name: "raced away", rank: 999 })
      .returning();
    await db
      .delete(trackRelationTypes)
      .where(eq(trackRelationTypes.id, gone!.id));

    const raced = await addTrackRelation(
      { fromTrackId: a, toTrackId: b, relationTypeId: gone!.id },
      suite.owner.userId
    ).catch((error: unknown) => error);
    expect(raced).toBeInstanceOf(HTTPException);
    expect((raced as HTTPException).status).toBe(400);
    expect((raced as HTTPException).message).toBe(
      "Relation type not found in this project"
    );
  });

  it("lets a foreign-key failure on the other track through unmapped", async () => {
    requireProject();
    const a = await mkTrack("Missing To Track");
    const raced = await addTrackRelation(
      {
        fromTrackId: a,
        toTrackId: 2_000_000_000,
        relationTypeId: (await relationType("remix")).id,
      },
      suite.owner.userId
    ).catch((error: unknown) => error);
    expect(raced).not.toBeInstanceOf(HTTPException);
  });

  it("rejects a duplicate relation of the same type", async () => {
    requireProject();
    const a = await mkTrack("Dupe From");
    const b = await mkTrack("Dupe To");
    const body = JSON.stringify({
      toTrackId: b,
      relationTypeId: (await relationType("cover")).id,
    });

    const first = await request("owner", `/tracks/${a}/relations`, {
      method: "POST",
      body,
    });
    expect(first.status).toBe(201);

    const second = await request("owner", `/tracks/${a}/relations`, {
      method: "POST",
      body,
    });
    expect(second.status).toBe(409);

    // A different relation type between the same pair is allowed.
    const other = await request("owner", `/tracks/${a}/relations`, {
      method: "POST",
      body: JSON.stringify({
        toTrackId: b,
        relationTypeId: (await relationType("live version")).id,
      }),
    });
    expect(other.status).toBe(201);
  });

  it("gates relation endpoints by role", async () => {
    requireProject();
    const a = await mkTrack("Rel Gate A");
    const b = await mkTrack("Rel Gate B");

    await expectAccess(
      "POST",
      `/tracks/${a}/relations`,
      { viewer: 403, editor: 201 },
      { toTrackId: b, relationTypeId: (await relationType("rework")).id }
    );

    const { relations } = await (
      await request("viewer", `/tracks/${a}`)
    ).json();
    await expectAccess("DELETE", `/tracks/${a}/relations/${relations[0].id}`, {
      viewer: 403,
      editor: 204,
    });
  });

  it("lists and sorts tracks by their primary audio's loudness", async () => {
    requireProject();
    const collectionId = await mkCollection("LUFS Sort Collection");
    const quiet = await mkTrack("LUFS Quiet");
    const loud = await mkTrack("LUFS Loud");
    const unmeasured = await mkTrack("LUFS Unmeasured");
    for (const [trackNumber, trackId] of [quiet, loud, unmeasured].entries()) {
      await request("owner", `/collections/${collectionId}/tracks`, {
        method: "POST",
        body: JSON.stringify({ trackId, trackNumber: trackNumber + 1 }),
      });
    }
    await mkPrimaryAudioWithLoudness(quiet, -18.5);
    await mkPrimaryAudioWithLoudness(loud, -9);

    const page = async (sort: string) =>
      (
        await (
          await request(
            "viewer",
            `/projects/${suite.projectId}/tracks/paginated?collection=${collectionId}&sort=${sort}`
          )
        ).json()
      ).rows as { id: number; lufs: number | null }[];

    const ascending = await page("lufs");
    expect(ascending.map((r) => r.id)).toEqual([quiet, loud, unmeasured]);
    expect(ascending.map((r) => r.lufs)).toEqual([-18.5, -9, null]);

    const descending = await page("lufs.desc");
    expect(descending.map((r) => r.id)).toEqual([loud, quiet, unmeasured]);
  });

  it("carries the primary audio's duplicate flag as the version it duplicates", async () => {
    requireProject();
    const trackId = await mkTrack("Duplicate Version Track");

    const [originalAsset, duplicateAsset] = await Promise.all([
      db
        .insert(assets)
        .values({
          name: "original.wav",
          type: "audio/wav",
          size: 0,
          assetPath: `./static/assets/dup-original-${crypto.randomUUID()}.wav`,
          projectId: suite.projectId,
        })
        .returning({ id: assets.id }),
      db
        .insert(assets)
        .values({
          name: "duplicate.wav",
          type: "audio/wav",
          size: 0,
          assetPath: `./static/assets/dup-copy-${crypto.randomUUID()}.wav`,
          projectId: suite.projectId,
        })
        .returning({ id: assets.id }),
    ]);

    const [original] = await db
      .insert(trackAudios)
      .values({
        trackId,
        assetId: originalAsset[0]!.id,
        version: 1,
        isPrimary: false,
      })
      .returning({ id: trackAudios.id });
    await db.insert(trackAudios).values({
      trackId,
      assetId: duplicateAsset[0]!.id,
      version: 2,
      isPrimary: true,
      duplicateOfId: original!.id,
    });

    const res = await request(
      "viewer",
      `/projects/${suite.projectId}/tracks/paginated?q=Duplicate Version Track`
    );
    const { rows } = await res.json();
    const row = rows.find((r: { id: number }) => r.id === trackId);

    expect(row.duplicateOfVersion).toBe(1);
  });

  it("filters the paginated track list by relation", async () => {
    requireProject();
    const derivative = await mkTrack("Filter Derivative");
    const source = await mkTrack("Filter Source");
    const unrelated = await mkTrack("Filter Unrelated");

    const remaster = await relationType("remaster");
    const rework = await relationType("rework");
    await request("owner", `/tracks/${derivative}/relations`, {
      method: "POST",
      body: JSON.stringify({ toTrackId: source, relationTypeId: remaster.id }),
    });
    const page = async (relation: string) => {
      const res = await request(
        "owner",
        `/projects/${suite.projectId}/tracks/paginated?relation=${encodeURIComponent(relation)}&pageSize=200`
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      return {
        ids: body.rows.map((r: { id: number }) => r.id) as number[],
        facet: body.facets.relation as Record<string, number>,
      };
    };

    const any = await page("any");
    expect(any.ids).toEqual(expect.arrayContaining([derivative, source]));
    expect(any.ids).not.toContain(unrelated);
    expect(any.facet.any).toBeGreaterThanOrEqual(2);
    expect(any.facet[remaster.id]).toBeGreaterThanOrEqual(2);

    const remastered = await page(String(remaster.id));
    expect(remastered.ids).toEqual(
      expect.arrayContaining([derivative, source])
    );
    expect(remastered.ids).not.toContain(unrelated);

    const reworked = await page(String(rework.id));
    expect(reworked.ids).not.toContain(derivative);

    // A value that is neither `any` nor an id (a saved view holding an old
    // kind name) is no filter at all.
    const stale = await page("remaster");
    expect(stale.ids).toEqual(
      expect.arrayContaining([derivative, source, unrelated])
    );
  });

  it("bulk-selects by a relation type id and ignores a value that is not one", async () => {
    requireProject();
    const derivative = await mkTrack("Bulk Relation Derivative");
    const source = await mkTrack("Bulk Relation Source");
    const bystander = await mkTrack("Bulk Relation Bystander");
    const acoustic = await relationType("acoustic");
    await request("owner", `/tracks/${derivative}/relations`, {
      method: "POST",
      body: JSON.stringify({ toTrackId: source, relationTypeId: acoustic.id }),
    });

    const explicitOf = async (id: number) =>
      (await (await request("viewer", `/tracks/${id}`)).json()).explicit;
    const bulkExplicit = (relation: string, explicit: boolean) =>
      request("owner", "/tracks/bulk", {
        method: "PATCH",
        body: JSON.stringify({
          projectId: suite.projectId,
          selection: { all: true, relation, q: "Bulk Relation" },
          patch: { explicit },
        }),
      });

    expect((await bulkExplicit(String(acoustic.id), true)).status).toBe(200);
    expect(await explicitOf(derivative)).toBe(true);
    expect(await explicitOf(source)).toBe(true);
    expect(await explicitOf(bystander)).toBe(false);

    expect((await bulkExplicit("acoustic", true)).status).toBe(200);
    expect(await explicitOf(bystander)).toBe(true);
  });

  it("marks a track explicit and filters, counts and bulk-selects by it", async () => {
    requireProject();
    const created = await request("owner", "/tracks", {
      method: "POST",
      body: JSON.stringify({
        title: "Explicit Created",
        projectId: suite.projectId,
        explicit: true,
      }),
    });
    expect(created.status).toBe(201);
    const explicitTrack = (await created.json()) as {
      id: number;
      explicit: boolean;
    };
    expect(explicitTrack.explicit).toBe(true);

    const clean = await mkTrack("Explicit Clean");
    const cleanDetail = await (
      await request("viewer", `/tracks/${clean}`)
    ).json();
    expect(cleanDetail.explicit).toBe(false);

    const patched = await request("owner", `/tracks/${clean}`, {
      method: "PATCH",
      body: JSON.stringify({ explicit: true }),
    });
    expect((await patched.json()).explicit).toBe(true);
    await request("owner", `/tracks/${clean}`, {
      method: "PATCH",
      body: JSON.stringify({ explicit: false }),
    });

    const page = async (query: string) =>
      (await (
        await request(
          "viewer",
          `/projects/${suite.projectId}/tracks/paginated?pageSize=200&${query}`
        )
      ).json()) as {
        rows: { id: number; explicit: boolean }[];
        facets: { explicit: Record<string, number> };
      };

    const explicitPage = await page("explicit=true");
    const explicitIds = explicitPage.rows.map((r) => r.id);
    expect(explicitIds).toContain(explicitTrack.id);
    expect(explicitIds).not.toContain(clean);
    expect(explicitPage.rows.every((r) => r.explicit)).toBe(true);
    // The facet ignores its own filter, so both buckets stay countable.
    expect(explicitPage.facets.explicit.true).toBeGreaterThanOrEqual(1);
    expect(explicitPage.facets.explicit.false).toBeGreaterThanOrEqual(1);

    const cleanIds = (await page("explicit=false")).rows.map((r) => r.id);
    expect(cleanIds).toContain(clean);
    expect(cleanIds).not.toContain(explicitTrack.id);

    const sorted = (await page("sort=explicit.desc")).rows;
    expect(sorted[0]?.explicit).toBe(true);

    const high = (await levelByName(suite.projectId, "High"))!;
    const bulk = await request("owner", "/tracks/bulk", {
      method: "PATCH",
      body: JSON.stringify({
        projectId: suite.projectId,
        selection: { all: true, explicit: "true" },
        patch: { priorityId: high.id },
      }),
    });
    expect(bulk.status).toBe(200);
    const cleanAfterBulk = await (
      await request("viewer", `/tracks/${clean}`)
    ).json();
    expect(cleanAfterBulk.priority.name).toBe("None");
  });
});

describe("tracks list archive scope and saves", () => {
  type PageRow = {
    id: number;
    archivedAt: string | null;
    lastSaveAt: string | null;
    saveCount: number;
  };
  type Page = {
    rows: PageRow[];
    rowCount: number;
    facets: { status: Record<string, number> };
  };

  const page = async (query: string) =>
    (await (
      await request(
        "viewer",
        `/projects/${suite.projectId}/tracks/paginated?pageSize=200&${query}`
      )
    ).json()) as Page;

  const archive = (trackId: number) =>
    db
      .update(tracks)
      .set({ archivedAt: new Date() })
      .where(eq(tracks.id, trackId));

  /** Records one save per timestamp on the session, straight to the rows. */
  const seedSaves = (sessionId: number, times: Date[]) =>
    db.insert(saves).values(
      times.map((fileUpdatedAt) => ({
        sessionId,
        projectId: suite.projectId,
        fileUpdatedAt,
        source: "scan" as const,
      }))
    );

  const sum = (counts: Record<string, number>) =>
    Object.values(counts).reduce((a, b) => a + b, 0);

  it("leaves archived tracks out of the rows, the count and the facets by default", async () => {
    requireProject();
    const live = await mkTrack("arcscope live");
    const archived = await mkTrack("arcscope gone");
    await archive(archived);

    const byDefault = await page("q=arcscope");
    expect(byDefault.rows.map((r) => r.id)).toEqual([live]);
    expect(byDefault.rowCount).toBe(1);
    expect(sum(byDefault.facets.status)).toBe(1);

    const only = await page("q=arcscope&archived=only");
    expect(only.rows.map((r) => r.id)).toEqual([archived]);
    expect(only.rowCount).toBe(1);
    expect(sum(only.facets.status)).toBe(1);
    expect(only.rows[0]?.archivedAt).not.toBeNull();

    const both = await page("q=arcscope&archived=include&sort=id.asc");
    expect(both.rows.map((r) => r.id)).toEqual([live, archived]);
    expect(both.rowCount).toBe(2);
    expect(sum(both.facets.status)).toBe(2);
    expect(both.rows[0]?.archivedAt).toBeNull();
  });

  it("rejects an unknown archived scope", async () => {
    requireProject();
    const res = await request(
      "viewer",
      `/projects/${suite.projectId}/tracks/paginated?archived=yes`
    );
    expect(res.status).toBe(400);
  });

  it("carries the newest save and the save count across the track's sessions", async () => {
    requireProject();
    const saved = await mkTrack("savestats saved");
    const unsaved = await mkTrack("savestats unsaved");
    const first = await mkSession({ trackId: saved });
    const second = await mkSession({ trackId: saved });
    const newest = new Date("2026-03-03T10:00:00.000Z");
    await seedSaves(first.id, [
      new Date("2026-03-01T10:00:00.000Z"),
      new Date("2026-03-02T10:00:00.000Z"),
    ]);
    await seedSaves(second.id, [newest]);

    const rows = (await page("q=savestats")).rows;
    expect(rows.find((r) => r.id === saved)).toMatchObject({
      lastSaveAt: newest.toISOString(),
      saveCount: 3,
    });
    expect(rows.find((r) => r.id === unsaved)).toMatchObject({
      lastSaveAt: null,
      saveCount: 0,
    });
  });

  it("sorts by last save and save count both ways, plain and grouped", async () => {
    requireProject();
    // `many` has more saves but the older newest save, so the two keys
    // order the pair oppositely.
    const many = await mkTrack("savesort many");
    const recent = await mkTrack("savesort recent");
    const manySession = await mkSession({ trackId: many });
    const recentSession = await mkSession({ trackId: recent });
    await seedSaves(manySession.id, [
      new Date("2026-04-01T10:00:00.000Z"),
      new Date("2026-04-02T10:00:00.000Z"),
    ]);
    await seedSaves(recentSession.id, [new Date("2026-04-05T10:00:00.000Z")]);

    const cases: [string, number[]][] = [
      ["lastSaveAt.asc", [many, recent]],
      ["lastSaveAt.desc", [recent, many]],
      ["saveCount.asc", [recent, many]],
      ["saveCount.desc", [many, recent]],
    ];
    for (const [sort, expected] of cases) {
      const plain = await page(`q=savesort&sort=${sort}`);
      expect(plain.rows.map((r) => r.id)).toEqual(expected);
      const grouped = await page(`q=savesort&sort=${sort}&groupBy=priority`);
      expect(grouped.rows.map((r) => r.id)).toEqual(expected);
    }
  });

  it("ranks rows inside a many-to-many group by the active sort, both ways", async () => {
    requireProject();
    // The later-created track sorts first by title, so title order and id
    // order disagree; `mkTrack` gives both the same artist, so they share a group.
    const zed = await mkTrack("artistsort zed");
    const alpha = await mkTrack("artistsort alpha");

    const asc = await page("q=artistsort&sort=title.asc&groupBy=artist");
    expect(asc.rows.map((r) => r.id)).toEqual([alpha, zed]);
    const desc = await page("q=artistsort&sort=title.desc&groupBy=artist");
    expect(desc.rows.map((r) => r.id)).toEqual([zed, alpha]);
  });
});

describe("track create under the project's defaults", () => {
  async function mkLabel(
    name: string,
    as: Actor = suite.owner,
    projectId = suite.projectId
  ) {
    const res = await suite.requestAs(as, `/projects/${projectId}/labels`, {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    expect(res.status).toBe(201);
    return (await res.json()) as { id: number; name: string };
  }

  async function createTrack(body: Record<string, unknown>) {
    const res = await request("editor", "/tracks", {
      method: "POST",
      body: JSON.stringify({ projectId: suite.projectId, ...body }),
    });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: number };
    return (await (await request("owner", `/tracks/${id}`)).json()) as {
      statusId: number;
      artists: string[];
      explicit: boolean;
      labels: { id: number }[];
    };
  }

  it("fills an omitted status, artists, explicit flag and labels from the project's defaults", async () => {
    requireProject();
    const status = await mkStatus("Default Track Status");
    const label = await mkLabel("default-track-label");

    const track = await withProjectPolicyForTest(
      suite.projectId,
      {
        defaults: {
          trackStatusId: status.id,
          labelIds: [label.id],
          artists: ["House Band"],
          explicit: true,
        },
      },
      () => createTrack({ title: "Defaulted Track" })
    );

    expect(track.statusId).toBe(status.id);
    expect(track.artists).toEqual(["House Band"]);
    expect(track.explicit).toBe(true);
    expect(track.labels.map((l) => l.id)).toEqual([label.id]);
  });

  it("keeps the status, artists and explicit flag a body names over the defaults", async () => {
    requireProject();
    const named = await mkStatus("Named Track Status");
    const defaulted = await mkStatus("Unused Default Status");

    const track = await withProjectPolicyForTest(
      suite.projectId,
      {
        defaults: {
          trackStatusId: defaulted.id,
          artists: ["House Band"],
          explicit: true,
        },
      },
      () =>
        createTrack({
          title: "Named Track",
          statusId: named.id,
          artists: [],
          explicit: false,
        })
    );

    expect(track.statusId).toBe(named.id);
    expect(track.artists).toEqual([]);
    expect(track.explicit).toBe(false);
  });

  it("skips a default status and labels the project no longer has, falling to the column default", async () => {
    requireProject();
    const elsewhere = await suite.throwawayProject("Foreign Defaults");
    const foreignLabel = await mkLabel(
      "foreign-default",
      elsewhere.owner,
      elsewhere.id
    );
    const gone = await mkLabel("deleted-default");
    const removed = await request(
      "owner",
      `/projects/${suite.projectId}/labels/${gone.id}`,
      { method: "DELETE" }
    );
    expect(removed.ok).toBe(true);
    const [foreignStatus] = await db
      .insert(statuses)
      .values({ name: "Foreign Status", projectId: elsewhere.id })
      .returning({ id: statuses.id });

    const track = await withProjectPolicyForTest(
      suite.projectId,
      {
        defaults: {
          trackStatusId: foreignStatus!.id,
          labelIds: [gone.id, foreignLabel.id],
        },
      },
      () => createTrack({ title: "Skipped Defaults Track" })
    );

    expect(track.statusId).toBe(1);
    expect(track.labels).toEqual([]);
  });
});

describe("track facets under the label and artist filters", () => {
  type Row = {
    id: number;
    statusId: number;
    priorityId: number;
    explicit: boolean;
    artists: string[];
    labels: { id: number }[];
  };
  type Page = {
    rows: Row[];
    facets: Record<string, Record<string, number>>;
  };

  const page = async (query: string) =>
    (await (
      await request(
        "viewer",
        `/projects/${suite.projectId}/tracks/paginated?pageSize=200&${query}`
      )
    ).json()) as Page;

  /** How many of `rows` fall under each key `keysOf` gives them. */
  const tally = (rows: Row[], keysOf: (row: Row) => (string | number)[]) => {
    const counts: Record<string, number> = {};
    for (const row of rows) {
      for (const key of new Set(keysOf(row))) {
        counts[key] = (counts[key] ?? 0) + 1;
      }
    }
    return counts;
  };

  /**
   * Four tracks that differ on the label, the artist, the status, the
   * priority and the explicit flag, and a relation from each of two of them
   * to the fourth. Only `both` carries the label and the artist.
   */
  const seed = async () => {
    const artist = `facetdrift${Math.random().toString(36).slice(2, 8)}`;
    const labelRes = await request(
      "owner",
      `/projects/${suite.projectId}/labels`,
      { method: "POST", body: JSON.stringify({ name: artist }) }
    );
    const label = (await labelRes.json()) as { id: number };
    const high = (await levelByName(suite.projectId, "High"))!;
    const status = await mkStatus("Facet Drift");
    const remaster = await relationType("remaster");

    const create = async (body: Record<string, unknown>) => {
      const res = await request("owner", "/tracks", {
        method: "POST",
        body: JSON.stringify({ projectId: suite.projectId, ...body }),
      });
      expect(res.status).toBe(201);
      return ((await res.json()) as { id: number }).id;
    };
    const both = await create({
      title: `${artist} both`,
      artists: [artist],
      statusId: status.id,
      priorityId: high.id,
      explicit: true,
    });
    const labelOnly = await create({
      title: `${artist} label`,
      artists: ["Someone Else"],
    });
    await db.insert(entityLabels).values(
      [both, labelOnly].map((entityId) => ({
        labelId: label.id,
        entityType: "track" as const,
        entityId,
      }))
    );
    const artistOnly = await create({
      title: `${artist} artist`,
      artists: [artist],
    });
    const neither = await create({
      title: `${artist} neither`,
      artists: ["Someone Else"],
      statusId: status.id,
      priorityId: high.id,
      explicit: true,
    });
    for (const from of [both, artistOnly]) {
      const linked = await request("owner", `/tracks/${from}/relations`, {
        method: "POST",
        body: JSON.stringify({
          toTrackId: neither,
          relationTypeId: remaster.id,
        }),
      });
      expect(linked.status).toBe(201);
    }
    return { artist, label, remaster, both, labelOnly, artistOnly };
  };

  it("counts each facet over the rows every other active filter leaves", async () => {
    requireProject();
    const { artist, label, remaster, both, labelOnly, artistOnly } =
      await seed();

    const filtered = await page(`label=${label.id}&artist=${artist}`);
    expect(filtered.rows.map((r) => r.id)).toEqual([both]);
    expect(filtered.facets.status).toEqual(
      tally(filtered.rows, (r) => [r.statusId])
    );
    expect(filtered.facets.priority).toEqual(
      tally(filtered.rows, (r) => [r.priorityId])
    );
    expect(filtered.facets.explicit).toEqual(
      tally(filtered.rows, (r) => [String(r.explicit)])
    );
    // `both` is the only filtered track with a relation; the track it links
    // to carries neither the label nor the artist.
    expect(filtered.facets.relation).toEqual({ any: 1, [remaster.id]: 1 });

    // The label and artist facets each ignore their own filter only.
    const byArtist = await page(`artist=${artist}`);
    expect(byArtist.rows.map((r) => r.id).sort()).toEqual(
      [both, artistOnly].sort()
    );
    expect(filtered.facets.label).toEqual(
      tally(byArtist.rows, (r) => r.labels.map((l) => l.id))
    );
    const byLabel = await page(`label=${label.id}`);
    expect(byLabel.rows.map((r) => r.id).sort()).toEqual(
      [both, labelOnly].sort()
    );
    expect(filtered.facets.artist).toEqual(
      tally(byLabel.rows, (r) => r.artists)
    );
  });

  it("keeps the status and relation facets narrowed by the label filter alone", async () => {
    requireProject();
    const { label, remaster, both, labelOnly } = await seed();

    const byLabel = await page(`label=${label.id}`);
    expect(byLabel.rows.map((r) => r.id).sort()).toEqual(
      [both, labelOnly].sort()
    );
    expect(byLabel.facets.status).toEqual(
      tally(byLabel.rows, (r) => [r.statusId])
    );
    expect(byLabel.facets.relation).toEqual({ any: 1, [remaster.id]: 1 });
  });
});
