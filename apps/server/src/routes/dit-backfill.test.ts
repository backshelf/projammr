import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { and, asc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { recordRevisions } from "../db/queries/saves.js";
import { projectScope, usageFor } from "../db/queries/storage-usage.js";
import { activity } from "../db/schema/activity.js";
import { saves } from "../db/schema/saves.js";
import { sessions } from "../db/schema/sessions.js";
import {
  adoptNewSet,
  hashOf,
  pushSaves,
  savePayload,
  trackSeeds,
} from "../test/dit-history.js";
import { setupSuite } from "../test/fixtures.js";
import {
  restoreInstancePolicy,
  stubInstancePolicy,
} from "../test/instance-policy.js";
import {
  callTool,
  ensureMcpServerListening,
  mintMcpToken,
} from "../test/mcp.js";

const suite = setupSuite("Dit backfill");
const { owner, requireProject, request, expectAccess, mkSession, mkTrack } =
  suite;
const { seedObjects, removeSeeded } = trackSeeds();

afterAll(removeSeeded);
afterEach(restoreInstancePolicy);

const T0 = Date.UTC(2026, 5, 1);
const MINUTE = 60_000;

const post = (path: string, body: unknown) =>
  request("owner", path, { method: "POST", body: JSON.stringify(body) });

const savesOf = (sessionId: number) =>
  db
    .select()
    .from(saves)
    .where(eq(saves.sessionId, sessionId))
    .orderBy(asc(saves.fileUpdatedAt));

async function sessionRow(id: number) {
  const [row] = await db.select().from(sessions).where(eq(sessions.id, id));
  return row!;
}

/** A save with no content, `minutes` past `T0`, as the scanner or the app recorded it. */
const scannerSave = (
  sessionId: number,
  minutes: number,
  source: "scan" | "backup" | "app",
  extra: Record<string, unknown> = {}
) => ({
  sessionId,
  projectId: suite.projectId,
  fileUpdatedAt: new Date(T0 + minutes * MINUTE),
  source,
  machineName: "scanner box",
  ...extra,
});

/** The minutes past `T0` of each save a session holds, oldest first. */
const minutesOf = async (sessionId: number) =>
  (await savesOf(sessionId)).map(
    (row) => (row.fileUpdatedAt.getTime() - T0) / MINUTE
  );

const metaOf = (overrides: Record<string, unknown> = {}) => ({
  tempo: "120",
  timeSignature: "4/4",
  rootNote: "F#",
  scale: "Minor",
  tracksCount: 3,
  scenesCount: 1,
  dawVersion: "12.1",
  structure: null,
  samplePaths: null,
  ...overrides,
});

describe("the backfill's candidate sessions", () => {
  const path = () => `/projects/${suite.projectId}/sessions/dit-candidates`;

  type Candidate = {
    id: number;
    name: string;
    trackId: number | null;
    trackTitle: string | null;
    localFilepath: string | null;
    localFileMachineName: string | null;
    fingerprints: string[];
    lastSaveAt: string | null;
  };

  it("lists the Ableton sessions no repo holds with their path, track, fingerprints and newest save", async () => {
    requireProject();
    const trackId = await mkTrack("Candidate track");
    const candidate = await mkSession({
      name: "Candidate",
      trackId,
      localFilepath: "/Music/Candidate.als",
      localFileMachineName: "scanner box",
      fingerprint: "100:current",
    });
    const bare = await mkSession({ name: "Bare candidate" });
    await recordRevisions([
      scannerSave(candidate.id, 0, "scan", { fingerprint: "100:old" }),
      scannerSave(candidate.id, 1, "scan", { fingerprint: "100:current" }),
      scannerSave(candidate.id, 2, "backup", { fingerprint: "100:backup" }),
    ]);

    const res = await request("viewer", path());
    expect(res.status).toBe(200);
    const { sessions: listed } = (await res.json()) as {
      sessions: Candidate[];
    };

    const found = listed.find((row) => row.id === candidate.id)!;
    expect(found).toMatchObject({
      name: "Candidate",
      trackId,
      trackTitle: "Candidate track",
      localFilepath: "/Music/Candidate.als",
      localFileMachineName: "scanner box",
    });
    expect([...found.fingerprints].sort()).toEqual(["100:current", "100:old"]);
    expect(new Date(found.lastSaveAt!).getTime()).toBe(T0 + 2 * MINUTE);
    expect(listed.find((row) => row.id === bare.id)).toMatchObject({
      trackId: null,
      trackTitle: null,
      fingerprints: [],
      lastSaveAt: null,
    });
  });

  it("leaves out a session a repo holds and one of another DAW", async () => {
    requireProject();
    const bound = await adoptNewSet(suite, "Already bound");
    const other = await mkSession({ name: "Other DAW", daw: "reaper" });

    const { sessions: listed } = (await (
      await request("owner", path())
    ).json()) as { sessions: Candidate[] };

    const ids = listed.map((row) => row.id);
    expect(ids).not.toContain(bound.sessionId);
    expect(ids).not.toContain(other.id);
  });

  it("is open to a viewer and hidden from a stranger", async () => {
    requireProject();
    await expectAccess("GET", path(), { viewer: 200, editor: 200, owner: 200 });
  });
});

describe("POST /projects/:id/repos/storage-check", () => {
  const path = () => `/projects/${suite.projectId}/repos/storage-check`;
  const check = (objects: { hash: string; size: number }[]) =>
    post(path(), { objects });

  it("counts only the bytes of objects no repo of the caller's projects holds", async () => {
    requireProject();
    const set = await adoptNewSet(suite, "Storage held");
    const held = [hashOf("storage-held-a"), hashOf("storage-held-b")];
    await seedObjects(set.repoId, owner.userId, held);

    const res = await check([
      { hash: held[0]!, size: 100 },
      { hash: held[1]!, size: 200 },
      { hash: hashOf("storage-new"), size: 300 },
      { hash: hashOf("storage-new"), size: 300 },
      { hash: hashOf("storage-other"), size: 40 },
    ]);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ bytes: 340, held: 2 });
  });

  it("answers null for the room left when neither the project nor the caller has a cap", async () => {
    requireProject();
    const res = await check([{ hash: hashOf("storage-uncapped"), size: 1 }]);

    expect(await res.json()).toEqual({
      bytes: 1,
      held: 0,
      remainingBytes: null,
    });
  });

  it("answers the room the project's cap leaves", async () => {
    requireProject();
    const used = await usageFor(projectScope(suite.projectId));
    stubInstancePolicy({
      limits: { projectCapGb: (used + 5_000) / 1024 ** 3 },
    });

    const res = await check([{ hash: hashOf("storage-capped"), size: 7_000 }]);

    expect(await res.json()).toMatchObject({
      bytes: 7_000,
      remainingBytes: 5_000,
    });
  });

  it("takes no more than 10,000 objects and refuses a viewer", async () => {
    requireProject();
    const many = Array.from({ length: 10_001 }, (_, index) => ({
      hash: hashOf(`storage-many-${index}`),
      size: 1,
    }));
    expect((await check(many)).status).toBe(400);

    await expectAccess(
      "POST",
      path(),
      { editor: 200, owner: 200, viewer: 403 },
      { objects: [] }
    );
  });
});

describe("a quiet adopt", () => {
  const activityOf = (sessionId: number) =>
    db
      .select()
      .from(activity)
      .where(
        and(
          eq(activity.entityType, "session"),
          eq(activity.entityId, sessionId)
        )
      );

  it("creates the session and logs nothing, where an ordinary adopt logs it", async () => {
    requireProject();
    const repo = await (
      await post(`/projects/${suite.projectId}/repos`, { name: "Quiet" })
    ).json();

    const quiet = await post(`/repos/${repo.id}/sets`, {
      ditSetId: "set-quiet",
      fileName: "Quiet.als",
      quiet: true,
    });
    expect(quiet.status).toBe(201);
    expect(await activityOf((await quiet.json()).sessionId)).toEqual([]);

    const loud = await post(`/repos/${repo.id}/sets`, {
      ditSetId: "set-loud",
      fileName: "Loud.als",
    });
    expect(await activityOf((await loud.json()).sessionId)).toHaveLength(1);
  });
});

describe("the scanner's backup-stamped saves", () => {
  it("are superseded by the copy dit records just before them", async () => {
    requireProject();
    const set = await adoptNewSet(suite, "Supersede");
    await recordRevisions([scannerSave(set.sessionId, 5, "backup")]);

    const copy = savePayload("copy", T0);
    expect((await pushSaves(suite, set, "main", [copy])).status).toBe(200);

    expect(await minutesOf(set.sessionId)).toEqual([0]);
    expect((await savesOf(set.sessionId))[0]).toMatchObject({
      hash: copy.hash,
      source: "dit",
    });
  });

  it("stay when another save lies between the copy and them", async () => {
    requireProject();
    const set = await adoptNewSet(suite, "Between");
    await recordRevisions([
      scannerSave(set.sessionId, 2, "scan"),
      scannerSave(set.sessionId, 5, "backup"),
    ]);

    const copy = savePayload("copy", T0);
    expect((await pushSaves(suite, set, "main", [copy])).status).toBe(200);

    expect(await minutesOf(set.sessionId)).toEqual([0, 2, 5]);
  });

  it("keep the second of two stamps after one copy, the first lying between it and the copy", async () => {
    requireProject();
    const set = await adoptNewSet(suite, "Missing copy");
    await recordRevisions([
      scannerSave(set.sessionId, 5, "backup"),
      scannerSave(set.sessionId, 9, "backup"),
    ]);

    const copy = savePayload("copy", T0);
    expect((await pushSaves(suite, set, "main", [copy])).status).toBe(200);

    expect(await minutesOf(set.sessionId)).toEqual([0, 9]);
  });

  it("go one at a time as their copies arrive, and a repeat push removes no more", async () => {
    requireProject();
    const set = await adoptNewSet(suite, "One by one");
    await recordRevisions([
      scannerSave(set.sessionId, 2, "backup"),
      scannerSave(set.sessionId, 4, "backup"),
    ]);

    const first = savePayload("first", T0);
    await pushSaves(suite, set, "main", [first]);
    expect(await minutesOf(set.sessionId)).toEqual([0, 4]);

    await pushSaves(suite, set, "main", [first]);
    expect(await minutesOf(set.sessionId)).toEqual([0, 4]);

    await pushSaves(suite, set, "main", [
      savePayload("second", T0 + 3 * MINUTE),
    ]);
    expect(await minutesOf(set.sessionId)).toEqual([0, 3]);
  });

  it("are the only saves superseded: a scan or app row after a copy stays", async () => {
    requireProject();
    const set = await adoptNewSet(suite, "Only backups");
    await recordRevisions([
      scannerSave(set.sessionId, 5, "scan"),
      scannerSave(set.sessionId, 6, "app"),
    ]);

    await pushSaves(suite, set, "main", [savePayload("copy", T0)]);

    expect(await minutesOf(set.sessionId)).toEqual([0, 5, 6]);
  });
});

describe("a session's DAW facts", () => {
  it("become those of the newest save, and an older save pushed later leaves them", async () => {
    requireProject();
    const set = await adoptNewSet(suite, "Facts");
    const structure = {
      tracks: [{ kind: "audio", name: "Lead", devices: ["Serum 2"] }],
      plugins: { "Serum 2": { host: "vst3", manufacturer: "Xfer" } },
    };

    const older = savePayload("older", T0, {
      meta: metaOf({ tempo: "100", rootNote: "C", scale: "Major" }),
    });
    const newest = savePayload("newest", T0 + 2 * MINUTE, {
      meta: metaOf({ tempo: "140", structure }),
    });
    expect((await pushSaves(suite, set, "main", [older, newest])).status).toBe(
      200
    );

    expect(await sessionRow(set.sessionId)).toMatchObject({
      tempo: "140",
      timeSignature: "4/4",
      rootNote: "F#",
      scale: "Minor",
      tracksCount: 3,
      scenesCount: 1,
      dawVersion: "12.1",
      structure,
    });

    const earlier = savePayload("earlier", T0 + MINUTE, {
      meta: metaOf({ tempo: "90" }),
    });
    await pushSaves(suite, set, "main", [earlier]);
    expect((await sessionRow(set.sessionId)).tempo).toBe("140");

    const plugins = await request(
      "owner",
      `/projects/${suite.projectId}/plugins`
    );
    expect(await plugins.json()).toContainEqual(
      expect.objectContaining({
        name: "Serum 2",
        sessionIds: [set.sessionId],
        origin: "plugin",
        host: "vst3",
      })
    );
  });

  it("follow a newer save pushed later, and a save with no meta changes nothing", async () => {
    requireProject();
    const set = await adoptNewSet(suite, "Facts later");
    await pushSaves(suite, set, "main", [
      savePayload("a", T0, { meta: metaOf({ tempo: "100" }) }),
    ]);
    await pushSaves(suite, set, "main", [
      savePayload("b", T0 + MINUTE, { meta: metaOf({ tempo: "110" }) }),
    ]);
    expect((await sessionRow(set.sessionId)).tempo).toBe("110");

    await pushSaves(suite, set, "main", [savePayload("c", T0 + 2 * MINUTE)]);
    expect((await sessionRow(set.sessionId)).tempo).toBe("110");
  });
});

describe("the sessions list's inDit", () => {
  const list = async (query = "") => {
    const res = await request(
      "owner",
      `/projects/${suite.projectId}/sessions/paginated?q=InDitList${query}`
    );
    expect(res.status).toBe(200);
    return (await res.json()) as {
      rows: { id: number; name: string; inDit: boolean }[];
      facets: Record<string, Record<string, number>>;
    };
  };

  it("is on every row, filters by yes and no, and facets without narrowing itself", async () => {
    requireProject();
    const bound = await adoptNewSet(suite, "InDitList bound");
    const loose = await mkSession({ name: "InDitList loose" });

    const all = await list();
    expect(
      Object.fromEntries(all.rows.map((row) => [row.id, row.inDit]))
    ).toEqual({ [bound.sessionId]: true, [loose.id]: false });
    expect(all.facets.inDit).toEqual({ true: 1, false: 1 });

    const yes = await list("&inDit=true");
    expect(yes.rows.map((row) => row.id)).toEqual([bound.sessionId]);
    expect(yes.facets.inDit).toEqual({ true: 1, false: 1 });
    expect(yes.facets.daw).toEqual({ ableton: 1 });

    const no = await list("&inDit=false");
    expect(no.rows.map((row) => row.id)).toEqual([loose.id]);
  });

  it("sorts by it", async () => {
    requireProject();
    const res = await request(
      "owner",
      `/projects/${suite.projectId}/sessions/paginated?q=InDitList&sort=inDit.desc`
    );
    expect(res.status).toBe(200);
    const { rows } = (await res.json()) as { rows: { inDit: boolean }[] };
    expect(rows.map((row) => row.inDit)).toEqual(
      [...rows.map((row) => row.inDit)].sort((a, b) => Number(b) - Number(a))
    );
  });

  it("reaches MCP's list_sessions as a field and a filter", async () => {
    requireProject();
    ensureMcpServerListening();
    const token = await mintMcpToken(owner, ["read"]);

    const { body } = await callTool(token, "list_sessions", {
      projectId: suite.projectId,
      q: "InDitList",
      inDit: "true",
    });
    const { rows } = (
      body as {
        result: {
          structuredContent: { rows: { name: string; inDit: boolean }[] };
        };
      }
    ).result.structuredContent;

    expect(rows.map((row) => row.name)).toEqual(["InDitList bound"]);
    expect(rows[0]!.inDit).toBe(true);
  });
});
