import { describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { bulkSelectionSchema } from "../../db/queries/pagination.js";
import { withProjectPolicyForTest } from "../../db/queries/project-policy.js";
import { recordRevisions } from "../../db/queries/saves.js";
import { saves } from "../../db/schema/saves.js";
import { sessions } from "../../db/schema/sessions.js";
import { tracks } from "../../db/schema/tracks.js";
import { setupSuite } from "../../test/fixtures.js";
import { holdTransaction } from "../../test/held-transaction.js";
import {
  bulkMoveSessions,
  selectSessionIds,
  updateSession,
} from "./queries.js";

const suite = setupSuite("Session");
const {
  requireProject,
  request,
  expectAccess,
  mkTrack,
  mkSession,
  uploadAsset,
} = suite;

/** A sample as the detail reports it with no bytes held by the hub. */
const unheld = <S extends object>(sample: S) => ({
  ...sample,
  held: false,
  object: null,
});

describe("sessions", () => {
  it("matches a search term's underscore literally, not as a wildcard", async () => {
    requireProject();
    await mkSession({ name: "esc_ses literal" });
    await mkSession({ name: "escXses wildcard" });

    const res = await request(
      "owner",
      `/projects/${suite.projectId}/sessions/paginated?q=esc_ses`
    );
    expect(res.status).toBe(200);
    const page = (await res.json()) as {
      rows: { name: string }[];
      rowCount: number;
    };
    expect(page.rows.map((r) => r.name)).toEqual(["esc_ses literal"]);
    expect(page.rowCount).toBe(1);
  });

  it("creates, reads, updates, and deletes a session", async () => {
    requireProject();

    const created = await request("owner", "/sessions", {
      method: "POST",
      body: JSON.stringify({
        name: "My Session",
        daw: "ableton",
        projectId: suite.projectId,
      }),
    });
    expect(created.status).toBe(201);
    const session = await created.json();
    expect(session.name).toBe("My Session");

    const fetched = await request("viewer", `/sessions/${session.id}`);
    expect(fetched.status).toBe(200);
    expect((await fetched.json()).id).toBe(session.id);

    const patched = await request("owner", `/sessions/${session.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "Patched" }),
    });
    expect(patched.status).toBe(200);
    expect((await patched.json()).name).toBe("Patched");

    const deleted = await request("owner", `/sessions/${session.id}`, {
      method: "DELETE",
    });
    expect(deleted.status).toBe(204);
  });

  it("reports how many saves have been recorded, independent of the saves page size", async () => {
    requireProject();

    const localFilepath = `/mix/revcount-${Date.now()}.als`;
    const session = await mkSession({
      name: `Save Count Session ${Date.now()}`,
      localFilepath,
    });

    const bare = await request("viewer", `/sessions/${session.id}`);
    expect(bare.status).toBe(200);
    expect((await bare.json()).saveCount).toBe(0);

    const saveTimes = [1, 2, 3].map((n) => Date.UTC(2026, 6, n, 10, 0, 0));
    for (const at of saveTimes) {
      await recordRevisions([
        {
          sessionId: session.id,
          projectId: suite.projectId,
          fileUpdatedAt: new Date(at),
          source: "scan",
        },
      ]);
    }

    const fetched = await request("viewer", `/sessions/${session.id}`);
    expect(fetched.status).toBe(200);
    expect((await fetched.json()).saveCount).toBe(saveTimes.length);
  });

  it("ignores notesText sent in a create body", async () => {
    requireProject();

    const created = await request("owner", "/sessions", {
      method: "POST",
      body: JSON.stringify({
        name: "Generated Column Session",
        daw: "ableton",
        projectId: suite.projectId,
        notesText: "hand-written notes text",
      }),
    });
    expect(created.status).toBe(201);
    const session = await created.json();
    expect(session.notesText).toBeNull();
  });

  it("stores a session fingerprint and returns it in the project list", async () => {
    requireProject();

    const stamp = Date.now();
    const session = await mkSession({
      name: `fp-print-${stamp}`,
      fingerprint: `512:${stamp}-first`,
    });

    const patched = await request("owner", `/sessions/${session.id}`, {
      method: "PATCH",
      body: JSON.stringify({ fingerprint: `512:${stamp}-second` }),
    });
    expect(patched.status).toBe(200);
    expect((await patched.json()).fingerprint).toBe(`512:${stamp}-second`);

    const list = await request(
      "viewer",
      `/projects/${suite.projectId}/sessions`
    );
    expect(list.status).toBe(200);
    const rows = (await list.json()) as {
      id: number;
      fingerprint: string | null;
    }[];
    expect(rows.find((r) => r.id === session.id)?.fingerprint).toBe(
      `512:${stamp}-second`
    );
  });

  it("round-trips the structured DAW metadata columns", async () => {
    requireProject();

    const created = await request("owner", "/sessions", {
      method: "POST",
      body: JSON.stringify({
        name: "Metadata Session",
        daw: "ableton",
        projectId: suite.projectId,
        tempo: "128.5",
        timeSignature: "4/4",
        rootNote: "C#",
        scale: "Minor",
        tracksCount: 12,
        scenesCount: 4,
        dawVersion: "Ableton Live 12.4.2",
      }),
    });
    expect(created.status).toBe(201);
    const session = await created.json();
    expect(session.tempo).toBe("128.5");
    expect(session.timeSignature).toBe("4/4");
    expect(session.rootNote).toBe("C#");
    expect(session.scale).toBe("Minor");
    expect(session.tracksCount).toBe(12);
    expect(session.scenesCount).toBe(4);
    expect(session.dawVersion).toBe("Ableton Live 12.4.2");

    const fetched = await (
      await request("owner", `/sessions/${session.id}`)
    ).json();
    expect(fetched.tracksCount).toBe(12);

    const patched = await (
      await request("owner", `/sessions/${session.id}`, {
        method: "PATCH",
        body: JSON.stringify({ tracksCount: 15 }),
      })
    ).json();
    expect(patched.tracksCount).toBe(15);
    expect(patched.timeSignature).toBe("4/4");
  });

  describe("samples", () => {
    const kick = {
      path: "/samples/kick.wav",
      kind: "project",
      status: "present",
    } as const;
    const snare = {
      path: "/samples/snare.wav",
      kind: "library",
      status: "unknown",
    } as const;
    const hat = {
      path: "/samples/hat.wav",
      kind: "outside",
      status: "missing",
    } as const;

    const detail = async (id: number) =>
      (await request("owner", `/sessions/${id}`)).json();
    const patch = (id: number, body: object) =>
      request("owner", `/sessions/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });

    it("round-trips a session's samples through create, GET and PATCH", async () => {
      requireProject();

      const created = await request("owner", "/sessions", {
        method: "POST",
        body: JSON.stringify({
          name: "Sampled Session",
          daw: "ableton",
          projectId: suite.projectId,
          samples: [kick, snare],
        }),
      });
      expect(created.status).toBe(201);
      const session = await created.json();
      expect(session).not.toHaveProperty("samples");

      expect((await detail(session.id)).samples).toEqual(
        [kick, snare].map(unheld)
      );

      const replaced = await patch(session.id, { samples: [hat] });
      expect(replaced.status).toBe(200);
      expect((await detail(session.id)).samples).toEqual([hat].map(unheld));
    });

    it("leaves the samples alone on a PATCH without them and empties them on null", async () => {
      requireProject();
      const created = await request("owner", "/sessions", {
        method: "POST",
        body: JSON.stringify({
          name: "Kept Samples",
          daw: "ableton",
          projectId: suite.projectId,
          samples: [kick],
        }),
      });
      const { id } = await created.json();

      await patch(id, { tempo: "140" });
      expect((await detail(id)).samples).toEqual([kick].map(unheld));

      await patch(id, { samples: null });
      expect((await detail(id)).samples).toEqual([]);
    });

    it("carries an empty list for a session with no samples", async () => {
      requireProject();
      const session = await mkSession({ name: "No Samples", daw: "manual" });
      expect((await detail(session.id)).samples).toEqual([]);
    });

    it("keeps samples out of the paginated listing", async () => {
      requireProject();
      const created = await request("owner", "/sessions", {
        method: "POST",
        body: JSON.stringify({
          name: "Listed Samples",
          daw: "ableton",
          projectId: suite.projectId,
          samples: [kick],
        }),
      });
      const { id } = await created.json();

      const page = await request(
        "owner",
        `/projects/${suite.projectId}/sessions/paginated`
      );
      const { rows } = (await page.json()) as {
        rows: Record<string, unknown>[];
      };
      const row = rows.find((r) => r.id === id);
      expect(row).toBeDefined();
      expect(row).not.toHaveProperty("samples");
      expect(row).not.toHaveProperty("samplePaths");
    });

    it("refuses more than 500 samples", async () => {
      requireProject();
      const session = await mkSession({ name: "Too Many", daw: "manual" });
      const samples = Array.from({ length: 501 }, (_, i) => ({
        ...kick,
        path: `/samples/${i}.wav`,
      }));
      expect((await patch(session.id, { samples })).status).toBe(400);
    });

    it("refuses a sample with an unknown kind", async () => {
      requireProject();
      const session = await mkSession({ name: "Bad Kind", daw: "manual" });
      const bad = { ...kick, kind: "elsewhere" };
      expect((await patch(session.id, { samples: [bad] })).status).toBe(400);
    });
  });

  it("stores one spelling of the musical key however a writer spells it", async () => {
    requireProject();
    const session = await mkSession({ name: "Keyed Session", daw: "ableton" });

    const patched = await request("owner", `/sessions/${session.id}`, {
      method: "PATCH",
      body: JSON.stringify({ rootNote: "A♯", scale: "major" }),
    });
    expect(patched.status).toBe(200);
    const row = await patched.json();
    expect(row.rootNote).toBe("A#");
    expect(row.scale).toBe("Major");
  });

  it("refuses a root note that names no pitch", async () => {
    requireProject();
    const session = await mkSession({ name: "Unkeyed Session", daw: "manual" });

    const patched = await request("owner", `/sessions/${session.id}`, {
      method: "PATCH",
      body: JSON.stringify({ rootNote: "X" }),
    });
    expect(patched.status).toBe(400);
  });

  it("leaves the structured columns null when they are not supplied", async () => {
    requireProject();
    const session = await mkSession({ name: "Bare Session", daw: "manual" });
    const row = await (
      await request("owner", `/sessions/${session.id}`)
    ).json();
    expect(row.tempo).toBeNull();
    expect(row.timeSignature).toBeNull();
    expect(row.tracksCount).toBeNull();
    expect(row.dawVersion).toBeNull();
    expect(row.samples).toEqual([]);
    expect(row.structure).toBeNull();
  });

  it("round-trips a parsed session structure on create and update", async () => {
    requireProject();

    const structure = {
      tracks: [
        { kind: "audio", name: "2 VOCALS", devices: ["Reverb", "Serum 2"] },
        { kind: "midi", name: "3 Lead", devices: ["Simpler"] },
      ],
      clips: { audio: 12, midi: 4 },
    };

    const created = await request("owner", "/sessions", {
      method: "POST",
      body: JSON.stringify({
        name: "Structured Session",
        daw: "ableton",
        projectId: suite.projectId,
        structure,
      }),
    });
    expect(created.status).toBe(201);
    const session = await created.json();
    expect(session.structure).toEqual(structure);

    const fetched = await (
      await request("owner", `/sessions/${session.id}`)
    ).json();
    expect(fetched.structure).toEqual(structure);

    const truncated = { ...structure, tracks: [], truncated: true };
    const patched = await (
      await request("owner", `/sessions/${session.id}`, {
        method: "PATCH",
        body: JSON.stringify({ structure: truncated }),
      })
    ).json();
    expect(patched.structure).toEqual(truncated);
  });

  it("omits the structure from session listings", async () => {
    requireProject();
    await mkSession({
      name: `Listed Structure ${Date.now()}`,
      structure: { tracks: [], clips: { audio: 0, midi: 0 } },
    });

    const page = await (
      await request(
        "owner",
        `/projects/${suite.projectId}/sessions/paginated?limit=50`
      )
    ).json();
    expect(page.rows.length).toBeGreaterThan(0);
    expect(page.rows[0]).not.toHaveProperty("structure");
  });

  it("409s attaching the same asset to a session twice", async () => {
    requireProject();
    const session = await mkSession({ name: "Twice Attached Session" });
    const asset = await uploadAsset("session-attachment-twice.jpeg");
    const attach = () =>
      request("owner", `/sessions/${session.id}/attachments`, {
        method: "POST",
        body: JSON.stringify({ assetId: asset.id }),
      });

    expect((await attach()).status).toBe(201);
    expect((await attach()).status).toBe(409);
  });

  it("409s a second session claiming the same local filepath", async () => {
    requireProject();
    const localFilepath = `/tmp/duplicate-${Date.now()}.als`;
    const create = () =>
      request("owner", "/sessions", {
        method: "POST",
        body: JSON.stringify({
          name: "Filepath Claim",
          daw: "ableton",
          projectId: suite.projectId,
          localFilepath,
        }),
      });

    expect((await create()).status).toBe(201);
    expect((await create()).status).toBe(409);
  });

  it("gates session endpoints by role", async () => {
    requireProject();
    const session = await mkSession({ name: "Gated Session" });
    const asset = await uploadAsset("session-gate.jpeg");

    await expectAccess("GET", `/sessions/${session.id}`, { viewer: 200 });

    await expectAccess(
      "POST",
      "/sessions",
      { viewer: 403, editor: 201 },
      { name: "Editor Session", daw: "ableton", projectId: suite.projectId }
    );
    await expectAccess(
      "PATCH",
      `/sessions/${session.id}`,
      { viewer: 403, editor: 200 },
      { name: "Editor Renamed Session" }
    );
    await expectAccess(
      "POST",
      `/sessions/${session.id}/attachments`,
      { viewer: 403, editor: 201 },
      { assetId: asset.id }
    );

    await expectAccess("DELETE", `/sessions/${session.id}`, {
      viewer: 403,
      editor: 204,
    });
  });
});

describe("sessions list: archived tracks and saves", () => {
  type Row = {
    id: number;
    name: string;
    archived: boolean;
    lastSaveAt: string | null;
    saveCount: number;
  };
  type Page = {
    rows: Row[];
    rowCount: number;
    facets: Record<string, Record<string, number>>;
  };

  /**
   * Four sessions named `ArchList …`: two saves on a live track's session, one
   * save on an unlinked one, an unlinked one never saved, and one save on an
   * archived track's session.
   */
  async function mkFixture() {
    const liveTrack = await mkTrack("ArchList Live Track");
    const archivedTrack = await mkTrack("ArchList Archived Track");
    await db
      .update(tracks)
      .set({ archivedAt: new Date() })
      .where(eq(tracks.id, archivedTrack));
    const live = await mkSession({ name: "ArchList live", trackId: liveTrack });
    const saved = await mkSession({ name: "ArchList saved unlinked" });
    const never = await mkSession({ name: "ArchList never saved" });
    const archived = await mkSession({
      name: "ArchList archived",
      trackId: archivedTrack,
    });
    const save = (sessionId: number, at: string) => ({
      sessionId,
      projectId: suite.projectId,
      fileUpdatedAt: new Date(at),
      source: "scan" as const,
    });
    await db
      .insert(saves)
      .values([
        save(live.id, "2026-01-01T00:00:00.000Z"),
        save(live.id, "2026-03-01T00:00:00.000Z"),
        save(saved.id, "2026-02-01T00:00:00.000Z"),
        save(archived.id, "2026-04-01T00:00:00.000Z"),
      ]);
    return { liveTrack, archivedTrack, live, saved, never, archived };
  }
  let fixture: ReturnType<typeof mkFixture> | undefined;
  const seed = () => (fixture ??= mkFixture());

  const page = async (params = ""): Promise<Page> => {
    const res = await request(
      "owner",
      `/projects/${suite.projectId}/sessions/paginated?q=ArchList&${params}`
    );
    expect(res.status).toBe(200);
    return (await res.json()) as Page;
  };
  const ids = (p: Page) => p.rows.map((r) => r.id);

  it("hides sessions of an archived track by default and keeps unlinked ones", async () => {
    requireProject();
    const f = await seed();

    const p = await page();
    expect(ids(p).sort((x, y) => x - y)).toEqual(
      [f.live.id, f.saved.id, f.never.id].sort((x, y) => x - y)
    );
    expect(p.rowCount).toBe(3);
    expect(p.rows.every((r) => !r.archived)).toBe(true);
    expect(p.facets.daw).toEqual({ ableton: 3 });
    expect(p.facets.track).toEqual({ [f.liveTrack]: 1 });
  });

  it("lists only sessions of archived tracks under archived=only", async () => {
    requireProject();
    const f = await seed();

    const p = await page("archived=only");
    expect(ids(p)).toEqual([f.archived.id]);
    expect(p.rowCount).toBe(1);
    expect(p.rows[0]!.archived).toBe(true);
    expect(p.facets.track).toEqual({ [f.archivedTrack]: 1 });
  });

  it("lists every session under archived=include", async () => {
    requireProject();
    const f = await seed();

    const p = await page("archived=include");
    expect(p.rowCount).toBe(4);
    expect(p.facets.daw).toEqual({ ableton: 4 });
    const archivedById = new Map(p.rows.map((r) => [r.id, r.archived]));
    expect(archivedById.get(f.archived.id)).toBe(true);
    expect(archivedById.get(f.live.id)).toBe(false);
    expect(archivedById.get(f.never.id)).toBe(false);
  });

  it("lists a named archived track's sessions under a track filter", async () => {
    requireProject();
    const f = await seed();

    const named = await page(`track=${f.archivedTrack}`);
    expect(ids(named)).toEqual([f.archived.id]);
    expect(named.rows[0]!.archived).toBe(true);
    expect(await page(`track=${f.archivedTrack}&archived=only`)).toMatchObject({
      rowCount: 1,
    });
    expect((await page(`track=${f.liveTrack}&archived=only`)).rowCount).toBe(0);
  });

  it("reaches a named archived track's sessions from an all-matching selection", async () => {
    requireProject();
    const f = await seed();
    // As the bulk routes parse a body's selection.
    const all = (params: Record<string, string>) =>
      selectSessionIds(
        suite.projectId,
        bulkSelectionSchema.parse({ all: true, ...params })
      );

    expect(
      await all({ q: "ArchList", track: String(f.archivedTrack) })
    ).toEqual([f.archived.id]);
    expect(await all({ q: "ArchList" })).not.toContain(f.archived.id);
  });

  it("rejects an unknown archived scope", async () => {
    requireProject();
    const res = await request(
      "owner",
      `/projects/${suite.projectId}/sessions/paginated?archived=bogus`
    );
    expect(res.status).toBe(400);
  });

  it("carries each session's newest save and its number of saves", async () => {
    requireProject();
    const f = await seed();

    const byId = new Map((await page()).rows.map((r) => [r.id, r]));
    expect(byId.get(f.live.id)).toMatchObject({
      lastSaveAt: "2026-03-01T00:00:00.000Z",
      saveCount: 2,
    });
    expect(byId.get(f.saved.id)).toMatchObject({
      lastSaveAt: "2026-02-01T00:00:00.000Z",
      saveCount: 1,
    });
    expect(byId.get(f.never.id)).toMatchObject({
      lastSaveAt: null,
      saveCount: 0,
    });
  });

  it("sorts by the newest save and by the number of saves", async () => {
    requireProject();
    const f = await seed();

    // A never-saved session sorts last in both directions.
    expect(ids(await page("sort=lastSaveAt.asc"))).toEqual([
      f.saved.id,
      f.live.id,
      f.never.id,
    ]);
    expect(ids(await page("sort=lastSaveAt.desc"))).toEqual([
      f.live.id,
      f.saved.id,
      f.never.id,
    ]);
    expect(ids(await page("sort=saveCount.asc"))).toEqual([
      f.never.id,
      f.saved.id,
      f.live.id,
    ]);
    expect(ids(await page("sort=saveCount.desc"))).toEqual([
      f.live.id,
      f.saved.id,
      f.never.id,
    ]);
  });
});

describe("session create under the project's defaults", () => {
  const newSessionMain = { defaults: { newSessionMain: true } };

  const isMain = async (id: number) =>
    (
      (await (await request("owner", `/sessions/${id}`)).json()) as {
        main: boolean;
      }
    ).main;

  it("makes a new linked session the track's main, taking over from the one before", async () => {
    requireProject();
    const trackId = await mkTrack("Main By Default");
    const before = await mkSession({ trackId, main: true });

    const created = await withProjectPolicyForTest(
      suite.projectId,
      newSessionMain,
      () => mkSession({ trackId, name: "Takes Over" })
    );

    expect(created.main).toBe(true);
    expect(await isMain(before.id)).toBe(false);
  });

  it("keeps main off when the body says so, and leaves an unlinked session alone", async () => {
    requireProject();
    const trackId = await mkTrack("Named Not Main");
    const before = await mkSession({ trackId, main: true });

    const [named, unlinked] = await withProjectPolicyForTest(
      suite.projectId,
      newSessionMain,
      async () => [
        await mkSession({ trackId, name: "Not Main", main: false }),
        await mkSession({ name: "No Track" }),
      ]
    );

    expect(named!.main).toBe(false);
    expect(unlinked!.main).toBe(false);
    expect(await isMain(before.id)).toBe(true);
  });

  it("leaves a new linked session off main under the default policy", async () => {
    requireProject();
    const trackId = await mkTrack("Main Off By Default");
    const before = await mkSession({ trackId, main: true });

    const created = await mkSession({ trackId, name: "Stays Aside" });

    expect(created.main).toBe(false);
    expect(await isMain(before.id)).toBe(true);
  });
});

describe("session inbox triage, unassigned filter, and main promotion", () => {
  it("accepts and clears inboxDismissedAt as an ISO string on PATCH /sessions/:id", async () => {
    requireProject();
    const session = await mkSession({ name: "Inbox Dismiss" });
    const stamp = "2026-11-28T08:00:00.000Z";

    const dismissed = await request("editor", `/sessions/${session.id}`, {
      method: "PATCH",
      body: JSON.stringify({ inboxDismissedAt: stamp }),
    });
    expect(dismissed.status).toBe(200);
    expect((await dismissed.json()).inboxDismissedAt).toBe(stamp);

    const restored = await request("editor", `/sessions/${session.id}`, {
      method: "PATCH",
      body: JSON.stringify({ inboxDismissedAt: null }),
    });
    expect(restored.status).toBe(200);
    expect((await restored.json()).inboxDismissedAt).toBeNull();

    const invalid = await request("editor", `/sessions/${session.id}`, {
      method: "PATCH",
      body: JSON.stringify({ inboxDismissedAt: "not-a-date" }),
    });
    expect(invalid.status).toBe(400);
  });

  it("filters paginated sessions by unassigned=true and unassigned=false", async () => {
    requireProject();
    const trackId = await mkTrack("Filter Unassigned Track");
    const linked = await mkSession({
      name: "UnassignedFilter Linked",
      trackId,
    });
    const orphan = await mkSession({ name: "UnassignedFilter Orphan" });

    const onlyUnassigned = (await (
      await request(
        "viewer",
        `/projects/${suite.projectId}/sessions/paginated?q=UnassignedFilter&unassigned=true`
      )
    ).json()) as { rows: { id: number }[]; rowCount: number };
    expect(onlyUnassigned.rows.map((r) => r.id)).toEqual([orphan.id]);
    expect(onlyUnassigned.rowCount).toBe(1);

    const onlyAssigned = (await (
      await request(
        "viewer",
        `/projects/${suite.projectId}/sessions/paginated?q=UnassignedFilter&unassigned=false`
      )
    ).json()) as { rows: { id: number }[]; rowCount: number };
    expect(onlyAssigned.rows.map((r) => r.id)).toEqual([linked.id]);
    expect(onlyAssigned.rowCount).toBe(1);
  });

  it("clears prior main session when PATCH sets { trackId, main: true }", async () => {
    requireProject();
    const trackId = await mkTrack("Patch Main Track");
    const oldMain = await mkSession({
      trackId,
      main: true,
      name: "Old Main",
    });
    const incoming = await mkSession({ name: "Incoming Main" });

    const res = await request("editor", `/sessions/${incoming.id}`, {
      method: "PATCH",
      body: JSON.stringify({ trackId, main: true }),
    });
    expect(res.status).toBe(200);
    const updated = await res.json();
    expect(updated.trackId).toBe(trackId);
    expect(updated.main).toBe(true);

    const oldAfter = await (
      await request("viewer", `/sessions/${oldMain.id}`)
    ).json();
    expect(oldAfter.main).toBe(false);
  });

  it("clears prior main session when PATCH sets { main: true } without trackId", async () => {
    requireProject();
    const trackId = await mkTrack("Promote Main Track");
    const oldMain = await mkSession({
      trackId,
      main: true,
      name: "Old Main 2",
    });
    const secondary = await mkSession({
      trackId,
      main: false,
      name: "Secondary Session",
    });

    const res = await request("editor", `/sessions/${secondary.id}`, {
      method: "PATCH",
      body: JSON.stringify({ main: true }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).main).toBe(true);

    const oldAfter = await (
      await request("viewer", `/sessions/${oldMain.id}`)
    ).json();
    expect(oldAfter.main).toBe(false);
  });

  it("locks sessionId and retries when { main: true } promotes an unlinked session concurrently linked to a track", async () => {
    requireProject();
    const trackId = await mkTrack("Concurrent Unlinked Promote Track");
    const oldMain = await mkSession({
      trackId,
      main: true,
      name: "Existing Track Main",
    });
    const unlinked = await mkSession({
      main: false,
      name: "Unlinked Promoted Concurrently",
    });

    const held = await holdTransaction(async (tx) => {
      await tx
        .update(sessions)
        .set({ trackId })
        .where(eq(sessions.id, unlinked.id));
    });

    const promotedPromise = updateSession(unlinked.id, { main: true });
    await held.blocking();
    await held.commit();

    const promoted = await promotedPromise;
    expect(promoted.trackId).toBe(trackId);
    expect(promoted.main).toBe(true);

    const [oldRow] = await db
      .select({ main: sessions.main })
      .from(sessions)
      .where(eq(sessions.id, oldMain.id));
    expect(oldRow?.main).toBe(false);
  });

  it("serializes concurrent { trackId, main: true } promotions on a track with an existing main", async () => {
    requireProject();
    const trackId = await mkTrack("Concurrent Main Race Track");
    const oldMain = await mkSession({
      trackId,
      main: true,
      name: "Prior Main",
    });
    const s1 = await mkSession({ main: false, name: "Racer One" });
    const s2 = await mkSession({ main: false, name: "Racer Two" });

    const held = await holdTransaction(async (tx) => {
      await tx
        .select({ id: sessions.id })
        .from(sessions)
        .where(eq(sessions.id, s1.id))
        .for("update");
    });

    const p1 = updateSession(s1.id, { trackId, main: true });
    await held.blocking();
    const p2 = updateSession(s2.id, { trackId, main: true });
    await held.blocking(2);
    await held.commit();

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.trackId).toBe(trackId);
    expect(r2.trackId).toBe(trackId);

    const rows = await db
      .select({ id: sessions.id, main: sessions.main })
      .from(sessions)
      .where(eq(sessions.trackId, trackId));
    expect(rows.filter((r) => r.main).map((r) => r.id)).toEqual([s2.id]);
    expect(rows.find((r) => r.id === oldMain.id)?.main).toBe(false);
    expect(rows.find((r) => r.id === s1.id)?.main).toBe(false);
  });

  it("serializes concurrent { trackId, main: true } and { main: true } promotions on a track with no prior main", async () => {
    requireProject();
    const trackId = await mkTrack("Concurrent No-Prior-Main Track");
    const s1 = await mkSession({ main: false, name: "No-Main Racer One" });
    const s2 = await mkSession({ main: false, name: "No-Main Racer Two" });
    const s3 = await mkSession({
      trackId,
      main: false,
      name: "No-Main Racer Three",
    });

    const results = await Promise.all([
      request("editor", `/sessions/${s1.id}`, {
        method: "PATCH",
        body: JSON.stringify({ trackId, main: true }),
      }),
      request("editor", `/sessions/${s2.id}`, {
        method: "PATCH",
        body: JSON.stringify({ trackId, main: true }),
      }),
      request("editor", `/sessions/${s3.id}`, {
        method: "PATCH",
        body: JSON.stringify({ main: true }),
      }),
    ]);
    for (const res of results) {
      expect(res.status).toBe(200);
    }

    const rows = await db
      .select({ id: sessions.id, main: sessions.main })
      .from(sessions)
      .where(eq(sessions.trackId, trackId));
    expect(rows.filter((r) => r.main)).toHaveLength(1);
  });

  it("links an unlinked main: true session without 23505 when { trackId } omits main", async () => {
    requireProject();
    const occupiedTrack = await mkTrack("Occupied Main Track");
    const existingMain = await mkSession({
      trackId: occupiedTrack,
      main: true,
      name: "Occupied Existing Main",
    });
    const unlinkedMainA = await mkSession({
      main: true,
      name: "Unlinked Main A",
    });
    const emptyTrack = await mkTrack("Empty Main Track");
    const unlinkedMainB = await mkSession({
      main: true,
      name: "Unlinked Main B",
    });

    const resA = await request("editor", `/sessions/${unlinkedMainA.id}`, {
      method: "PATCH",
      body: JSON.stringify({ trackId: occupiedTrack }),
    });
    expect(resA.status).toBe(200);
    const bodyA = await resA.json();
    expect(bodyA.trackId).toBe(occupiedTrack);
    expect(bodyA.main).toBe(false);

    const [existingAfter] = await db
      .select({ main: sessions.main })
      .from(sessions)
      .where(eq(sessions.id, existingMain.id));
    expect(existingAfter?.main).toBe(true);

    const resB = await request("editor", `/sessions/${unlinkedMainB.id}`, {
      method: "PATCH",
      body: JSON.stringify({ trackId: emptyTrack }),
    });
    expect(resB.status).toBe(200);
    const bodyB = await resB.json();
    expect(bodyB.trackId).toBe(emptyTrack);
    expect(bodyB.main).toBe(true);
  });

  it("serializes concurrent bulkMoveSessions promotions on a track with an existing main", async () => {
    requireProject();
    const trackId = await mkTrack("Concurrent BulkMove Main Track");
    const oldMain = await mkSession({
      trackId,
      main: true,
      name: "BulkMove Prior Main",
    });
    const s1 = await mkSession({ main: false, name: "BulkMove Racer One" });
    const s2 = await mkSession({ main: false, name: "BulkMove Racer Two" });

    const held = await holdTransaction(async (tx) => {
      await tx
        .select({ id: sessions.id })
        .from(sessions)
        .where(eq(sessions.id, oldMain.id))
        .for("update");
    });

    const p1 = bulkMoveSessions(
      [{ sessionId: s1.id, trackId, main: true }],
      suite.projectId,
      suite.owner.userId
    );
    await held.blocking();
    const p2 = bulkMoveSessions(
      [{ sessionId: s2.id, trackId, main: true }],
      suite.projectId,
      suite.owner.userId
    );
    await held.blocking(2);
    await held.commit();

    await Promise.all([p1, p2]);

    const rows = await db
      .select({ id: sessions.id, main: sessions.main })
      .from(sessions)
      .where(eq(sessions.trackId, trackId));
    expect(rows.filter((r) => r.main)).toHaveLength(1);
    expect(rows.find((r) => r.id === oldMain.id)?.main).toBe(false);
  });
});
