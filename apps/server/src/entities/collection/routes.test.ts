import { eq } from "drizzle-orm";
import { describe, expect, it } from "bun:test";
import { db } from "../../db/index.js";
import { withProjectPolicyForTest } from "../../db/queries/project-policy.js";
import { tracks } from "../../db/schema/tracks.js";
import { setupSuite } from "../../test/fixtures.js";

const suite = setupSuite("Collection");
const {
  requireProject,
  request,
  expectAccess,
  mkTrack,
  mkCollection,
  mkStatus,
  mkPrimaryAudioWithLoudness,
  uploadAsset,
} = suite;

describe("collections", () => {
  it("matches a search term's underscore literally, not as a wildcard", async () => {
    requireProject();
    await mkCollection("esc_col literal");
    await mkCollection("escXcol wildcard");

    const res = await request(
      "owner",
      `/projects/${suite.projectId}/collections/paginated?q=esc_col`
    );
    expect(res.status).toBe(200);
    const page = (await res.json()) as {
      rows: { title: string }[];
      rowCount: number;
    };
    expect(page.rows.map((r) => r.title)).toEqual(["esc_col literal"]);
    expect(page.rowCount).toBe(1);
  });

  it("creates, reads, updates a collection and manages its tracks", async () => {
    requireProject();
    const collectionId = await mkCollection("CRUD Collection");

    const fetched = await request("viewer", `/collections/${collectionId}`);
    expect(fetched.status).toBe(200);
    expect((await fetched.json()).id).toBe(collectionId);

    const patched = await request("owner", `/collections/${collectionId}`, {
      method: "PATCH",
      body: JSON.stringify({ title: "Patched Collection" }),
    });
    expect(patched.status).toBe(200);
    expect((await patched.json()).title).toBe("Patched Collection");

    const trackA = await mkTrack("Coll A");
    const trackB = await mkTrack("Coll B");
    for (const [trackId, trackNumber] of [
      [trackA, 1],
      [trackB, 2],
    ] as const) {
      const res = await request(
        "owner",
        `/collections/${collectionId}/tracks`,
        {
          method: "POST",
          body: JSON.stringify({ trackId, trackNumber }),
        }
      );
      expect(res.status).toBe(200);
    }

    const tracks = await request(
      "viewer",
      `/collections/${collectionId}/tracks`
    );
    expect(tracks.status).toBe(200);
    expect(await tracks.json()).toHaveLength(2);

    const totals = await request(
      "viewer",
      `/collections/${collectionId}/status`
    );
    expect(totals.status).toBe(200);
    const totalsBody = await totals.json();
    expect(totalsBody.totalStatus).toBeTypeOf("number");
    expect(totalsBody.runtimeMs).toBeTypeOf("number");
    expect(totalsBody.runtimeComplete).toBeTypeOf("boolean");
    // Neither track has a primary audio yet, so there is nothing to measure.
    expect(totalsBody.loudness).toBeNull();
    expect(totalsBody.spectrum).toBeNull();

    const removed = await request(
      "owner",
      `/collections/${collectionId}/tracks/${trackB}`,
      { method: "DELETE" }
    );
    expect(removed.status).toBe(204);
    const after = await (
      await request("owner", `/collections/${collectionId}/tracks`)
    ).json();
    expect(after).toHaveLength(1);
  });

  it("deleting a collection answers 204 with no body", async () => {
    requireProject();
    const collectionId = await mkCollection("Doomed Collection");

    const deleted = await request("owner", `/collections/${collectionId}`, {
      method: "DELETE",
    });
    expect(deleted.status).toBe(204);
    expect(await deleted.text()).toBe("");

    expect(
      (await request("owner", `/collections/${collectionId}`)).status
    ).toBe(404);
  });

  it("patching statusId sets the status", async () => {
    requireProject();
    const collectionId = await mkCollection("Status Patch Collection");
    const status = await mkStatus("Collection Status", 40);

    const patched = await request("owner", `/collections/${collectionId}`, {
      method: "PATCH",
      body: JSON.stringify({ statusId: status.id }),
    });
    expect(patched.status).toBe(200);
    expect((await patched.json()).statusId).toBe(status.id);
  });

  it("a status from another project is refused", async () => {
    requireProject();
    const collectionId = await mkCollection("Foreign Status Collection");

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

    const res = await request("owner", `/collections/${collectionId}`, {
      method: "PATCH",
      body: JSON.stringify({ statusId: foreignStatusId }),
    });
    expect(res.status).toBe(404);
  });

  it("derives notesText from the notes document, ignoring a sent value", async () => {
    requireProject();

    const created = await request("owner", "/collections", {
      method: "POST",
      body: JSON.stringify({
        title: "Generated Column Collection",
        projectId: suite.projectId,
        notes: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "liner notes" }],
          },
        ],
        notesText: "hand-written notes text",
      }),
    });
    expect(created.status).toBe(201);
    const collection = await created.json();
    expect(collection.notesText).toBe("liner notes");
  });

  it("reports the loudness spread of a collection's primary audios", async () => {
    requireProject();
    const collectionId = await mkCollection("Loudness Collection");
    const t1 = await mkTrack("Loud 1");
    const t2 = await mkTrack("Loud 2");
    const t3 = await mkTrack("Loud 3");

    for (const [trackId, trackNumber] of [
      [t1, 3],
      [t2, 2],
      [t3, 1],
    ] as const) {
      await request("owner", `/collections/${collectionId}/tracks`, {
        method: "POST",
        body: JSON.stringify({ trackId, trackNumber }),
      });
    }

    await mkPrimaryAudioWithLoudness(t1, -20);
    await mkPrimaryAudioWithLoudness(t2, -10);
    await mkPrimaryAudioWithLoudness(t3, -16);

    const res = await request("viewer", `/collections/${collectionId}/status`);
    expect(res.status).toBe(200);
    const { loudness } = await res.json();
    expect(loudness).toEqual({
      min: -20,
      max: -10,
      median: -16,
      measured: 3,
      total: 3,
      tracks: [
        { id: t3, title: "Loud 3", lufs: -16 },
        { id: t2, title: "Loud 2", lufs: -10 },
        { id: t1, title: "Loud 1", lufs: -20 },
      ],
    });
  });

  it("averages the measured spectra of a collection's primary audios", async () => {
    requireProject();
    const collectionId = await mkCollection("Spectrum Collection");
    const quiet = await mkTrack("Spectrum Quiet");
    const loud = await mkTrack("Spectrum Loud");

    for (const [trackId, trackNumber] of [
      [quiet, 1],
      [loud, 2],
    ] as const) {
      await request("owner", `/collections/${collectionId}/tracks`, {
        method: "POST",
        body: JSON.stringify({ trackId, trackNumber }),
      });
    }

    const hz = [20, 200, 2000];
    await mkPrimaryAudioWithLoudness(quiet, -20, { hz, db: [-20, -20, -20] });
    await mkPrimaryAudioWithLoudness(loud, -10, { hz, db: [0, 0, 0] });

    const res = await request("viewer", `/collections/${collectionId}/status`);
    expect(res.status).toBe(200);
    const { spectrum } = await res.json();

    expect(spectrum.hz).toEqual(hz);
    // The mean is taken in the power domain, so 0 dB and −20 dB average −3.
    expect(spectrum.mean[0]).toBeCloseTo(-3, 1);
    expect(spectrum.min[0]).toBe(-20);
    expect(spectrum.max[0]).toBe(0);
    expect(spectrum.measured).toBe(2);
    expect(spectrum.total).toBe(2);
  });

  it("reports the tempo spread and every track's detected key", async () => {
    requireProject();
    const collectionId = await mkCollection("Tempo Key Collection");
    const slow = await mkTrack("Tempo Slow");
    const fast = await mkTrack("Tempo Fast");
    const unmeasured = await mkTrack("Tempo Unmeasured");

    for (const [trackId, trackNumber] of [
      [slow, 1],
      [fast, 2],
      [unmeasured, 3],
    ] as const) {
      await request("owner", `/collections/${collectionId}/tracks`, {
        method: "POST",
        body: JSON.stringify({ trackId, trackNumber }),
      });
    }

    await mkPrimaryAudioWithLoudness(slow, -14, undefined, {
      bpm: 90,
      musicalKey: "C major",
    });
    await mkPrimaryAudioWithLoudness(fast, -14, undefined, {
      bpm: 128,
      musicalKey: "C major",
    });

    const res = await request("viewer", `/collections/${collectionId}/status`);
    expect(res.status).toBe(200);
    const { tempo, keys } = await res.json();

    expect(tempo).toEqual({
      min: 90,
      max: 128,
      median: 109,
      measured: 2,
      tracks: [
        { id: slow, title: "Tempo Slow", bpm: 90 },
        { id: fast, title: "Tempo Fast", bpm: 128 },
      ],
    });
    expect(keys).toEqual([
      { id: slow, title: "Tempo Slow", key: "C major" },
      { id: fast, title: "Tempo Fast", key: "C major" },
    ]);
  });

  it("reorders a collection track by setting its number", async () => {
    requireProject();
    const collectionId = await mkCollection("Reorder Collection");
    const t1 = await mkTrack("R1");
    const t2 = await mkTrack("R2");
    const t3 = await mkTrack("R3");

    for (const [trackId, trackNumber] of [
      [t1, 1],
      [t2, 2],
      [t3, 3],
    ] as const) {
      const res = await request(
        "owner",
        `/collections/${collectionId}/tracks`,
        {
          method: "POST",
          body: JSON.stringify({ trackId, trackNumber }),
        }
      );
      expect(res.status).toBe(200);
    }

    const numbers = async () => {
      const rows = (await (
        await request("owner", `/collections/${collectionId}/tracks`)
      ).json()) as { id: number; trackNumber: number }[];
      return Object.fromEntries(rows.map((r) => [r.id, r.trackNumber]));
    };

    // Setting a number that another track already holds swaps the two.
    const single = await request(
      "owner",
      `/collections/${collectionId}/tracks/${t1}/number`,
      { method: "PATCH", body: JSON.stringify({ trackNumber: 3 }) }
    );
    expect(single.status).toBe(200);
    const afterSingle = await numbers();
    expect(afterSingle[t1]).toBe(3);
    expect(afterSingle[t3]).toBe(1);
  });

  it("keeps an archived track listed, numbered and counted in its collection", async () => {
    requireProject();
    const collectionId = await mkCollection("Archived Member Collection");
    const done = await mkStatus("Archived Member Complete", 100);
    const live = await mkTrack("AM live");
    const shelved = await mkTrack("AM shelved");
    for (const [trackId, trackNumber] of [
      [live, 1],
      [shelved, 2],
    ] as const) {
      const res = await request(
        "owner",
        `/collections/${collectionId}/tracks`,
        {
          method: "POST",
          body: JSON.stringify({ trackId, trackNumber }),
        }
      );
      expect(res.status).toBe(200);
    }
    const patched = await request("owner", `/tracks/${shelved}`, {
      method: "PATCH",
      body: JSON.stringify({ statusId: done.id }),
    });
    expect(patched.status).toBe(200);
    await db
      .update(tracks)
      .set({ archivedAt: new Date() })
      .where(eq(tracks.id, shelved));

    const listed = (await (
      await request("owner", `/collections/${collectionId}/tracks`)
    ).json()) as {
      id: number;
      trackNumber: number;
      archivedAt: string | null;
    }[];
    expect(listed.map((t) => [t.id, t.trackNumber])).toEqual([
      [live, 1],
      [shelved, 2],
    ]);
    expect(listed.map((t) => t.archivedAt !== null)).toEqual([false, true]);

    const status = await (
      await request("owner", `/collections/${collectionId}/status`)
    ).json();
    expect(status).toMatchObject({ trackCount: 2, completeTrackCount: 1 });
  });

  it("gates collection endpoints by role", async () => {
    requireProject();
    const collectionId = await mkCollection("Gated Collection");
    const trackId = await mkTrack("Gated Coll Track");
    const asset = await uploadAsset("collection-attachment.jpeg");

    await expectAccess("GET", `/collections/${collectionId}`, { viewer: 200 });
    await expectAccess("GET", `/collections/${collectionId}/tracks`, {
      viewer: 200,
    });
    await expectAccess(
      "GET",
      `/collections/${collectionId}/status`,
      { viewer: 200 },
      undefined,
      (body) => {
        const totals = body as {
          totalStatus: number;
          runtimeMs: number;
          runtimeComplete: boolean;
          trackCount: number;
          completeTrackCount: number;
        };
        expect(totals.totalStatus).toBeTypeOf("number");
        expect(totals.runtimeMs).toBeTypeOf("number");
        expect(totals.runtimeComplete).toBeTypeOf("boolean");
        expect(totals.completeTrackCount).toBeLessThanOrEqual(
          totals.trackCount
        );
      }
    );
    await expectAccess("GET", `/collections/${collectionId}/audios/primary`, {
      viewer: 200,
    });

    await expectAccess(
      "POST",
      "/collections",
      { viewer: 403, editor: 201 },
      { title: "Editor Collection", projectId: suite.projectId }
    );
    await expectAccess(
      "PATCH",
      `/collections/${collectionId}`,
      { viewer: 403, editor: 200 },
      { title: "Editor Renamed Collection" }
    );
    await expectAccess(
      "POST",
      `/collections/${collectionId}/attachments`,
      { viewer: 403, editor: 201 },
      { assetId: asset.id }
    );
    await expectAccess(
      "POST",
      `/collections/${collectionId}/tracks`,
      { viewer: 403, editor: 200 },
      { trackId, trackNumber: 1 }
    );
    await expectAccess(
      "PATCH",
      `/collections/${collectionId}/tracks/${trackId}/number`,
      { viewer: 403, editor: 200 },
      { trackNumber: 2 }
    );
    await expectAccess(
      "DELETE",
      `/collections/${collectionId}/tracks/${trackId}`,
      {
        viewer: 403,
        editor: 204,
      }
    );
  });

  it("404s a collection that does not exist", async () => {
    requireProject();
    const res = await request("owner", "/collections/99999999");
    expect(res.status).toBe(404);
  });

  it("409s attaching the same asset to a collection twice", async () => {
    requireProject();
    const collectionId = await mkCollection("Twice Attached Collection");
    const asset = await uploadAsset("collection-attachment-twice.jpeg");
    const attach = () =>
      request("owner", `/collections/${collectionId}/attachments`, {
        method: "POST",
        body: JSON.stringify({ assetId: asset.id }),
      });

    expect((await attach()).status).toBe(201);
    expect((await attach()).status).toBe(409);
  });

  it("404s removing a track the collection does not hold", async () => {
    requireProject();
    const collectionId = await mkCollection("Unheld Track Collection");
    const trackId = await mkTrack("Never Added Track");

    const res = await request(
      "owner",
      `/collections/${collectionId}/tracks/${trackId}`,
      { method: "DELETE" }
    );
    expect(res.status).toBe(404);
  });
});

describe("collection create under the project's defaults", () => {
  async function createCollection(body: Record<string, unknown>) {
    const res = await request("editor", "/collections", {
      method: "POST",
      body: JSON.stringify({ projectId: suite.projectId, ...body }),
    });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: number };
    return (await (await request("owner", `/collections/${id}`)).json()) as {
      statusId?: number;
      labels: { id: number }[];
    };
  }

  it("fills an omitted status and the labels from the project's defaults", async () => {
    requireProject();
    const status = await mkStatus("Default Collection Status");
    const labelRes = await request(
      "owner",
      `/projects/${suite.projectId}/labels`,
      { method: "POST", body: JSON.stringify({ name: "default-collection" }) }
    );
    const label = (await labelRes.json()) as { id: number };

    const collection = await withProjectPolicyForTest(
      suite.projectId,
      { defaults: { collectionStatusId: status.id, labelIds: [label.id] } },
      () => createCollection({ title: "Defaulted Collection" })
    );

    expect(collection.statusId).toBe(status.id);
    expect(collection.labels.map((l) => l.id)).toEqual([label.id]);
  });

  it("keeps a status the body names, null included", async () => {
    requireProject();
    const status = await mkStatus("Unused Collection Default");

    const collection = await withProjectPolicyForTest(
      suite.projectId,
      { defaults: { collectionStatusId: status.id } },
      () => createCollection({ title: "Statusless Collection", statusId: null })
    );

    // The detail leaves a null status out rather than sending null.
    expect(collection.statusId).toBeUndefined();
  });

  it("falls to the column default when the default status is gone", async () => {
    requireProject();
    const collection = await withProjectPolicyForTest(
      suite.projectId,
      { defaults: { collectionStatusId: 2_000_000_000 } },
      () => createCollection({ title: "Missing Default Collection" })
    );

    expect(collection.statusId).toBe(1);
  });
});
