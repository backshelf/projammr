import { afterAll, describe, expect, it, spyOn } from "bun:test";
import pg from "pg";
import { and, asc, count, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { recordRevisions } from "../db/queries/saves.js";
import { branches, commits, repos, timeSegments } from "../db/schema/repos.js";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { zstdCompressSync } from "node:zlib";
import { repoObjects, saveObjects } from "../db/schema/objects.js";
import { saveFile } from "../lib/dit.js";
import { objectKey, storedFilePath } from "../lib/storage.js";
import { saves } from "../db/schema/saves.js";
import { sessions } from "../db/schema/sessions.js";
import {
  adoptNewSet,
  commitPayload,
  hashOf,
  machineHeader,
  objectsOf,
  pushCommits,
  pushSaves,
  pushSegments,
  registerMachine,
  savePayload,
  type DitSet,
  type SegmentPayload,
  trackSeeds,
} from "../test/dit-history.js";
import { setBindParamLimitForTest } from "../lib/chunk.js";
import {
  acceptRecord,
  objectRecord,
  removeObjects,
} from "../test/dit-objects.js";
import { setupSuite } from "../test/fixtures.js";

const suite = setupSuite("Repo history");
const { owner, requireProject, request, expectAccess } = suite;
const { seedObjects, removeSeeded } = trackSeeds();

afterAll(removeSeeded);

const T0 = Date.UTC(2026, 5, 1);

const RAW_BYTES = Buffer.from("an undecodable file");

/** Writes the raw object's stored file: a zstd frame of its kind byte, then its bytes. */
async function writeRawObject(hash: string, bytes: Buffer): Promise<string> {
  const path = storedFilePath(objectKey(hash));
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, zstdCompressSync(Buffer.concat([Buffer.of(1), bytes])));
  return path;
}
const MINUTE = 60_000;

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

async function branchRow(sessionId: number, name: string) {
  const [row] = await db
    .select()
    .from(branches)
    .where(and(eq(branches.sessionId, sessionId), eq(branches.name, name)));
  return row!;
}

async function repoRow(id: number) {
  const [row] = await db.select().from(repos).where(eq(repos.id, id));
  return row!;
}

describe("repo history", () => {
  describe("POST /repos/:id/saves", () => {
    it("records a save on a branch it creates and stamps the repo", async () => {
      requireProject();
      const set = await adoptNewSet(suite, "Save records");
      const laptop = await registerMachine(suite, "owner", "laptop");
      const save = savePayload("a", T0, { machineName: "laptop" });

      const res = await pushSaves(suite, set, "main", [save], "owner", laptop);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ saved: 1 });

      const [row] = await savesOf(set.sessionId);
      const branch = await branchRow(set.sessionId, "main");
      expect(row).toMatchObject({
        hash: save.hash,
        xmlHash: save.xmlHash,
        tree: save.tree,
        side: save.side,
        source: "dit",
        contentState: "none",
        machineName: "laptop",
        machineId: laptop,
        projectId: suite.projectId,
        branchId: branch.id,
      });
      expect(branch.headCommitId).toBeNull();
      expect((await sessionRow(set.sessionId)).currentBranchId).toBe(branch.id);

      const repo = await repoRow(set.repoId);
      expect(repo.lastPushAt).not.toBeNull();
      expect(repo.lastPushMachineId).toBe(laptop);
    });

    it("refreshes the metadata of a save pushed again and leaves its stored content alone", async () => {
      requireProject();
      const set = await adoptNewSet(suite, "Save repeats");
      const ok = savePayload("a", T0);
      await pushSaves(suite, set, "main", [ok]);
      await seedObjects(set.repoId, owner.userId, objectsOf(ok));
      const committed = await pushCommits(suite, set, "main", [
        commitPayload("c1", null, [ok]),
      ]);
      expect(committed.status).toBe(201);

      const meta = {
        tempo: "128",
        timeSignature: "4/4",
        rootNote: null,
        scale: null,
        tracksCount: 3,
        scenesCount: 1,
        dawVersion: "12.1",
        structure: null,
        samplePaths: ["a.wav"],
      };
      const again = await pushSaves(suite, set, "main", [
        { ...ok, meta, machineName: "desktop" },
      ]);
      expect(again.status).toBe(200);

      const rows = await savesOf(set.sessionId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        unreadable: false,
        tree: ok.tree,
        machineName: "desktop",
        contentState: "stored",
      });
      expect(rows[0]!.meta).toMatchObject({ tempo: "128", tracksCount: 3 });
    });

    it("keeps the content columns of a stored save when its hash is pushed with different ones", async () => {
      requireProject();
      const set = await adoptNewSet(suite, "Save stored content");
      const stored = savePayload("a", T0);
      await pushSaves(suite, set, "main", [stored]);
      await seedObjects(set.repoId, owner.userId, objectsOf(stored));
      const committed = await pushCommits(suite, set, "main", [
        commitPayload("c1", null, [stored]),
      ]);
      expect(committed.status).toBe(201);

      const other = savePayload("other", T0);
      const forged = {
        ...stored,
        xmlHash: other.xmlHash,
        tree: other.tree,
        side: other.side,
        viewOnly: true,
        unreadable: true,
        machineName: "desktop",
      };
      expect((await pushSaves(suite, set, "main", [forged])).status).toBe(200);

      const [row] = await savesOf(set.sessionId);
      expect(row).toMatchObject({
        xmlHash: stored.xmlHash,
        tree: stored.tree,
        side: stored.side,
        viewOnly: false,
        unreadable: false,
        machineName: "desktop",
        contentState: "stored",
      });
    });

    it("gives a scanner save at the same time its content and keeps its id and source", async () => {
      requireProject();
      const set = await adoptNewSet(suite, "Save claims");
      await recordRevisions([
        {
          sessionId: set.sessionId,
          projectId: suite.projectId,
          fileUpdatedAt: new Date(T0),
          source: "scan",
          machineName: "scanner box",
        },
      ]);
      const [scanned] = await savesOf(set.sessionId);

      const save = savePayload("a", T0, { machineName: "laptop" });
      expect((await pushSaves(suite, set, "main", [save])).status).toBe(200);

      const rows = await savesOf(set.sessionId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: scanned!.id,
        source: "scan",
        hash: save.hash,
        tree: save.tree,
        machineName: "scanner box",
      });
      expect(rows[0]!.branchId).not.toBeNull();
    });

    it("keeps a scanner save's machine and meta when the same save is pushed again", async () => {
      requireProject();
      const set = await adoptNewSet(suite, "Save precedence");
      const scannerMeta = {
        tempo: "100",
        timeSignature: "3/4",
        rootNote: null,
        scale: null,
        tracksCount: 2,
        scenesCount: 0,
        dawVersion: "11.0",
        structure: null,
        samplePaths: null,
      };
      await recordRevisions([
        {
          sessionId: set.sessionId,
          projectId: suite.projectId,
          fileUpdatedAt: new Date(T0),
          source: "scan",
          machineName: "scanner box",
          meta: scannerMeta,
        },
      ]);

      const save = savePayload("a", T0, { machineName: "laptop" });
      expect((await pushSaves(suite, set, "main", [save])).status).toBe(200);
      const ditMeta = { ...scannerMeta, tempo: "140", tracksCount: 9 };
      const again = { ...save, machineName: "desktop", meta: ditMeta };
      expect((await pushSaves(suite, set, "main", [again])).status).toBe(200);
      expect((await pushSaves(suite, set, "main", [save])).status).toBe(200);

      const rows = await savesOf(set.sessionId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        source: "scan",
        machineName: "scanner box",
        meta: scannerMeta,
      });
    });

    it("gives a scanner save with no meta the meta dit pushes", async () => {
      requireProject();
      const set = await adoptNewSet(suite, "Save null meta");
      await recordRevisions([
        {
          sessionId: set.sessionId,
          projectId: suite.projectId,
          fileUpdatedAt: new Date(T0),
          source: "scan",
          machineName: "scanner box",
        },
      ]);

      const ditMeta = {
        tempo: "140",
        timeSignature: "4/4",
        rootNote: null,
        scale: null,
        tracksCount: 9,
        scenesCount: 0,
        dawVersion: "11.0",
        structure: null,
        samplePaths: null,
      };
      const save = savePayload("a", T0);
      expect((await pushSaves(suite, set, "main", [save])).status).toBe(200);
      const again = { ...save, meta: ditMeta };
      expect((await pushSaves(suite, set, "main", [again])).status).toBe(200);

      const rows = await savesOf(set.sessionId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        source: "scan",
        machineName: "scanner box",
        meta: ditMeta,
      });
    });

    it("refuses a save whose time already holds a different save", async () => {
      requireProject();
      const set = await adoptNewSet(suite, "Save clashes");
      const first = savePayload("a", T0);
      await pushSaves(suite, set, "main", [first]);

      const res = await pushSaves(suite, set, "main", [savePayload("b", T0)]);
      expect(res.status).toBe(409);
      const { error } = await res.json();
      expect(error).toContain(first.hash);
      expect(error).toContain(new Date(T0).toISOString());
      expect(await savesOf(set.sessionId)).toHaveLength(1);
    });

    it("moves the session's current branch only to the newest save's branch", async () => {
      requireProject();
      const set = await adoptNewSet(suite, "Current branch");
      await pushSaves(suite, set, "main", [savePayload("m", T0 + MINUTE)]);
      await pushSaves(suite, set, "older", [savePayload("o", T0)]);

      const named = async () => {
        const { currentBranchId } = await sessionRow(set.sessionId);
        const rows = await db
          .select()
          .from(branches)
          .where(eq(branches.sessionId, set.sessionId));
        return rows.find((branch) => branch.id === currentBranchId)?.name;
      };
      expect(await named()).toBe("main");

      await pushSaves(suite, set, "older", [savePayload("n", T0 + 2 * MINUTE)]);
      expect(await named()).toBe("older");
    });

    it("404s a set nobody adopted and rejects a malformed hash", async () => {
      requireProject();
      const set = await adoptNewSet(suite, "Save bad bodies");

      const stranger = await pushSaves(
        suite,
        { ...set, ditSetId: "never adopted" },
        "main",
        [savePayload("a", T0)]
      );
      expect(stranger.status).toBe(404);

      const malformed = await pushSaves(suite, set, "main", [
        savePayload("a", T0, { hash: "not-a-hash" }),
      ]);
      expect(malformed.status).toBe(400);
    });

    it("lets an editor push, refuses a viewer and hides the repo from a stranger", async () => {
      requireProject();
      const set = await adoptNewSet(suite, "Save access");
      await expectAccess(
        "POST",
        `/repos/${set.repoId}/saves`,
        { viewer: 403, editor: 200 },
        {
          ditSetId: set.ditSetId,
          branch: "main",
          saves: [savePayload("a", T0)],
        },
        undefined,
        (caller) => machineHeader(suite, caller)
      );
    });
  });

  const span = (
    branch: string,
    machineName: string,
    startedAt: number,
    endedAt: number
  ): SegmentPayload => ({
    branch,
    machineName,
    startedAt,
    endedAt,
    source: "script",
  });

  const segmentRows = (sessionId: number) =>
    db.select().from(timeSegments).where(eq(timeSegments.sessionId, sessionId));

  const timeInSetOf = async (sessionId: number): Promise<number> => {
    const res = await request("viewer", `/sessions/${sessionId}`);
    return (await res.json()).history.timeInSet;
  };

  describe("POST /repos/:id/segments", () => {
    it("records spans, creates a branch on first mention and answers the count", async () => {
      requireProject();
      const set = await adoptNewSet(suite, "Segments record");
      const res = await pushSegments(suite, set, [
        span("main", "studio", T0, T0 + 10 * MINUTE),
      ]);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ recorded: 1 });

      const branch = await branchRow(set.sessionId, "main");
      expect(branch.name).toBe("main");
      expect(await timeInSetOf(set.sessionId)).toBe(600);
    });

    it("counts a re-pushed span once, lets a longer re-push extend it and never shrinks it", async () => {
      requireProject();
      const set = await adoptNewSet(suite, "Segments re-push");
      const five = [span("main", "studio", T0, T0 + 5 * MINUTE)];
      await pushSegments(suite, set, five);
      await pushSegments(suite, set, five);
      expect(await timeInSetOf(set.sessionId)).toBe(300);
      expect(await segmentRows(set.sessionId)).toHaveLength(1);

      await pushSegments(suite, set, [
        span("main", "studio", T0, T0 + 8 * MINUTE),
      ]);
      expect(await timeInSetOf(set.sessionId)).toBe(480);

      await pushSegments(suite, set, [
        span("main", "studio", T0, T0 + 2 * MINUTE),
      ]);
      expect(await timeInSetOf(set.sessionId)).toBe(480);
      expect(await segmentRows(set.sessionId)).toHaveLength(1);
    });

    it("counts spans that overlap across machines once", async () => {
      requireProject();
      const set = await adoptNewSet(suite, "Segments overlap");
      await pushSegments(suite, set, [
        span("main", "studio", T0, T0 + 5 * MINUTE),
        span("main", "laptop", T0 + 3 * MINUTE, T0 + 10 * MINUTE),
      ]);
      expect(await timeInSetOf(set.sessionId)).toBe(600);
    });

    it("keeps the longer of two spans with the same key in one body", async () => {
      requireProject();
      const set = await adoptNewSet(suite, "Segments duplicate");
      const res = await pushSegments(suite, set, [
        span("main", "studio", T0, T0 + 5 * MINUTE),
        span("main", "studio", T0, T0 + 8 * MINUTE),
      ]);
      expect(res.status).toBe(200);
      expect(await segmentRows(set.sessionId)).toHaveLength(1);
      expect(await timeInSetOf(set.sessionId)).toBe(480);
    });

    it("answers 400 for a span that ends before it starts and records nothing", async () => {
      requireProject();
      const set = await adoptNewSet(suite, "Segments backwards");
      const res = await pushSegments(suite, set, [
        span("main", "studio", T0 + MINUTE, T0),
      ]);
      expect(res.status).toBe(400);
      expect(await segmentRows(set.sessionId)).toHaveLength(0);
    });

    it.each([
      ["a name of 70 characters", "m".repeat(70), "m".repeat(64)],
      ["33 astral characters", "😀".repeat(33), "😀".repeat(32)],
      ["a pair straddling the limit", `${"m".repeat(63)}😀b`, "m".repeat(63)],
    ])(
      "cuts %s to at most 64 UTF-16 units rather than refusing it",
      async (label, name, expected) => {
        requireProject();
        const set = await adoptNewSet(suite, `Segments long name ${label}`);
        const res = await pushSegments(suite, set, [
          span("main", ` ${name} `, T0, T0 + MINUTE),
        ]);
        expect(res.status).toBe(200);
        const [row] = await segmentRows(set.sessionId);
        expect(row?.machineName).toBe(expected);
        expect(row!.machineName.length).toBeLessThanOrEqual(64);
        expect(row!.machineName).not.toMatch(
          /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
        );
      }
    );

    it("answers 404 for a set that was never adopted", async () => {
      requireProject();
      const set = await adoptNewSet(suite, "Segments unadopted");
      const res = await suite.request(
        "owner",
        `/repos/${set.repoId}/segments`,
        {
          method: "POST",
          body: JSON.stringify({
            ditSetId: "set-never-adopted",
            segments: [span("main", "studio", T0, T0 + MINUTE)],
          }),
        }
      );
      expect(res.status).toBe(404);
    });

    it("gates the route by role", async () => {
      requireProject();
      const set = await adoptNewSet(suite, "Segments access");
      await expectAccess(
        "POST",
        `/repos/${set.repoId}/segments`,
        { viewer: 403, editor: 200 },
        {
          ditSetId: set.ditSetId,
          segments: [span("main", "studio", T0, T0 + MINUTE)],
        },
        undefined,
        (caller) => machineHeader(suite, caller)
      );
    });

    it("records across the statements a small bind limit forces", async () => {
      requireProject();
      const set = await adoptNewSet(suite, "Segments bind limit");
      const spans = [0, 1, 2].map((i) =>
        span("main", "studio", T0 + i * 10 * MINUTE, T0 + (i * 10 + 5) * MINUTE)
      );

      setBindParamLimitForTest(4);
      try {
        const res = await pushSegments(suite, set, spans);
        expect(await res.json()).toEqual({ recorded: 3 });
      } finally {
        setBindParamLimitForTest(undefined);
      }
      expect(await segmentRows(set.sessionId)).toHaveLength(3);
      expect(await timeInSetOf(set.sessionId)).toBe(900);
    });
  });

  describe("time in set on commits", () => {
    /** Two saves ten minutes apart on main, committed as a chain. */
    async function timedCommits(label: string) {
      requireProject();
      const set = await adoptNewSet(suite, label);
      const first = savePayload(`${label}-1`, T0 + 10 * MINUTE);
      const second = savePayload(`${label}-2`, T0 + 20 * MINUTE);
      await pushSaves(suite, set, "main", [first, second]);
      await seedObjects(
        set.repoId,
        owner.userId,
        [first, second].flatMap(objectsOf)
      );
      const c1 = commitPayload(`${label}-c1`, null, [first]);
      const c2 = commitPayload(`${label}-c2`, c1.hash, [second]);
      await pushCommits(suite, set, "main", [c1, c2]);
      return { set, c1, c2 };
    }

    async function timesByHash(sessionId: number) {
      const res = await request("viewer", `/sessions/${sessionId}/commits`);
      const rows: { hash: string; timeInSet: number | null }[] =
        await res.json();
      return new Map(rows.map((row) => [row.hash, row.timeInSet]));
    }

    it("clips each window at its save and counts the first commit back to the span's start", async () => {
      const { set, c1, c2 } = await timedCommits("Commit window");
      await pushSegments(suite, set, [
        span("main", "studio", T0, T0 + 30 * MINUTE),
      ]);
      const times = await timesByHash(set.sessionId);
      expect(times.get(c1.hash)).toBe(600);
      expect(times.get(c2.hash)).toBe(600);
      expect(await timeInSetOf(set.sessionId)).toBe(1800);
    });

    it("counts only spans on the commit's own branch", async () => {
      const { set, c1, c2 } = await timedCommits("Commit other branch");
      await pushSegments(suite, set, [
        span("idea", "studio", T0, T0 + 30 * MINUTE),
      ]);
      const times = await timesByHash(set.sessionId);
      expect(times.get(c1.hash)).toBeNull();
      expect(times.get(c2.hash)).toBeNull();
      expect(await timeInSetOf(set.sessionId)).toBe(1800);
    });

    it("answers null for a commit whose window holds no span", async () => {
      const { set, c1, c2 } = await timedCommits("Commit no span");
      await pushSegments(suite, set, [
        span("main", "studio", T0, T0 + 5 * MINUTE),
      ]);
      const times = await timesByHash(set.sessionId);
      expect(times.get(c1.hash)).toBe(300);
      expect(times.get(c2.hash)).toBeNull();
      expect(await timeInSetOf(set.sessionId)).toBe(300);
    });

    // The same fixture as `each_commit_is_charged_the_time_between_the_previous_commits_save_and_its_own` in
    // `packages/dit/crates/dit-core/src/repo/tests.rs`: dit time and this route must read one window,
    // `(parent commit's save file time, own save file time]`, so the numbers are the same on both sides.
    it("charges each commit the window after its parent's save up to its own, as dit time does", async () => {
      requireProject();
      const set = await adoptNewSet(suite, "Commit window parity");
      const at = (seconds: number) => T0 + seconds * 1000;
      const saveRows = [1000, 2000, 3000].map((seconds, n) =>
        savePayload(`parity-${n}`, at(seconds))
      );
      await pushSaves(suite, set, "main", saveRows);
      await seedObjects(set.repoId, owner.userId, saveRows.flatMap(objectsOf));
      const c0 = commitPayload("parity-c0", null, [saveRows[0]!]);
      const c1 = commitPayload("parity-c1", c0.hash, [saveRows[1]!]);
      const c2 = commitPayload("parity-c2", c1.hash, [saveRows[2]!]);
      await pushCommits(suite, set, "main", [c0, c1, c2]);
      await pushSegments(suite, set, [
        span("main", "studio", at(500), at(1500)),
        span("main", "studio", at(2100), at(2900)),
        span("main", "studio", at(2950), at(3500)),
      ]);

      const times = await timesByHash(set.sessionId);

      expect(times.get(c0.hash)).toBe(500);
      expect(times.get(c1.hash)).toBe(500);
      expect(times.get(c2.hash)).toBe(800 + 50);
    });

    it("reads null, not a failure, for a commit whose save is no newer than its parent's", async () => {
      requireProject();
      const set = await adoptNewSet(suite, "Commit skewed clock");
      const rows = [
        savePayload("skew-0", T0 + 10 * MINUTE),
        savePayload("skew-1", T0 + 5 * MINUTE),
        savePayload("skew-2", T0 + 20 * MINUTE),
      ];
      await pushSaves(suite, set, "main", rows);
      await seedObjects(set.repoId, owner.userId, rows.flatMap(objectsOf));
      const c0 = commitPayload("skew-c0", null, [rows[0]!]);
      const c1 = commitPayload("skew-c1", c0.hash, [rows[1]!]);
      const c2 = commitPayload("skew-c2", c1.hash, [rows[2]!]);
      expect((await pushCommits(suite, set, "main", [c0, c1, c2])).status).toBe(
        201
      );
      await pushSegments(suite, set, [
        span("main", "studio", T0, T0 + 30 * MINUTE),
      ]);

      const res = await request("viewer", `/sessions/${set.sessionId}/commits`);
      expect(res.status).toBe(200);
      const times = new Map<string, number | null>(
        (await res.json()).map(
          (row: { hash: string; timeInSet: number | null }) => [
            row.hash,
            row.timeInSet,
          ]
        )
      );
      expect(times.get(c0.hash)).toBe(600);
      expect(times.get(c1.hash)).toBeNull();
      expect(times.get(c2.hash)).toBe(900);
    });
  });

  describe("POST /repos/:id/commits", () => {
    it("stores the content of the saves it covers, links their objects and moves the branch head", async () => {
      requireProject();
      const set = await adoptNewSet(suite, "Commit stores");
      const a = savePayload("a", T0);
      const b = savePayload("b", T0 + MINUTE);
      await pushSaves(suite, set, "main", [a, b]);
      await seedObjects(set.repoId, owner.userId, [
        ...objectsOf(a),
        ...objectsOf(b),
      ]);

      const commit = commitPayload("c1", null, [a, b]);
      const res = await pushCommits(suite, set, "main", [commit]);
      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({ inserted: 1 });

      const rows = await savesOf(set.sessionId);
      expect(rows.map((row) => row.contentState)).toEqual(["stored", "stored"]);

      const links = await db.select().from(saveObjects);
      const linkedTo = (saveId: number) =>
        links
          .filter((link) => link.saveId === saveId)
          .map((link) => link.objectHash)
          .sort();
      expect(linkedTo(rows[0]!.id)).toEqual(objectsOf(a).sort());
      expect(linkedTo(rows[1]!.id)).toEqual(objectsOf(b).sort());

      const [row] = await db
        .select()
        .from(commits)
        .where(
          and(eq(commits.repoId, set.repoId), eq(commits.hash, commit.hash))
        );
      expect(row).toMatchObject({
        repoId: set.repoId,
        sessionId: set.sessionId,
        saveId: rows[1]!.id,
        parentId: null,
        authorId: owner.userId,
        kind: "user",
        message: "c1",
      });
      expect((await branchRow(set.sessionId, "main")).headCommitId).toBe(
        row!.id
      );
    });

    it("chains several commits in one body and continues from the head later", async () => {
      requireProject();
      const set = await adoptNewSet(suite, "Commit chain");
      const [a, b, c] = [
        savePayload("a", T0),
        savePayload("b", T0 + MINUTE),
        savePayload("c", T0 + 2 * MINUTE),
      ] as const;
      await pushSaves(suite, set, "main", [a, b, c]);
      await seedObjects(set.repoId, owner.userId, [a, b, c].flatMap(objectsOf));

      const first = commitPayload("c1", null, [a]);
      const second = commitPayload("c2", first.hash, [b]);
      const res = await pushCommits(suite, set, "main", [first, second]);
      expect(await res.json()).toEqual({ inserted: 2 });

      const third = commitPayload("c3", second.hash, [c]);
      expect((await pushCommits(suite, set, "main", [third])).status).toBe(201);

      const rows = await db
        .select()
        .from(commits)
        .where(eq(commits.sessionId, set.sessionId))
        .orderBy(asc(commits.id));
      expect(rows.map((row) => row.parentId)).toEqual([
        null,
        rows[0]!.id,
        rows[1]!.id,
      ]);
    });

    it("answers 200 and changes nothing for a commit it already has", async () => {
      requireProject();
      const set = await adoptNewSet(suite, "Commit replay");
      const a = savePayload("a", T0);
      await pushSaves(suite, set, "main", [a]);
      await seedObjects(set.repoId, owner.userId, objectsOf(a));
      const commit = commitPayload("c1", null, [a]);
      await pushCommits(suite, set, "main", [commit]);
      const before = await repoRow(set.repoId);

      const replay = await pushCommits(suite, set, "main", [commit]);
      expect(replay.status).toBe(200);
      expect(await replay.json()).toEqual({ inserted: 0 });
      expect(
        await db.select().from(commits).where(eq(commits.repoId, set.repoId))
      ).toHaveLength(1);
      expect((await repoRow(set.repoId)).lastPushAt).toEqual(before.lastPushAt);
    });

    it("answers both of two concurrent pushes of the same new commit 2xx and records it once", async () => {
      requireProject();
      const set = await adoptNewSet(suite, "Commit concurrent replay");
      const a = savePayload("a", T0);
      await pushSaves(suite, set, "main", [a]);
      await seedObjects(set.repoId, owner.userId, objectsOf(a));
      const commit = commitPayload("c1", null, [a]);

      const results = await Promise.all([
        pushCommits(suite, set, "main", [commit]),
        pushCommits(suite, set, "main", [commit]),
      ]);
      expect(results.map((res) => res.status).sort()).toEqual([200, 201]);
      expect(
        await db.select().from(commits).where(eq(commits.repoId, set.repoId))
      ).toHaveLength(1);
    });

    it("records saves and commits across the statements a small bind limit forces", async () => {
      requireProject();
      const set = await adoptNewSet(suite, "Commit small bind limit");
      const pushed = [0, 1, 2, 3, 4].map((i) =>
        savePayload(`s${i}`, T0 + i * MINUTE)
      );
      await seedObjects(set.repoId, owner.userId, pushed.flatMap(objectsOf));
      const commit = commitPayload("c1", null, pushed);

      setBindParamLimitForTest(4);
      try {
        expect((await pushSaves(suite, set, "main", pushed)).status).toBe(200);
        expect((await pushSaves(suite, set, "main", pushed)).status).toBe(200);
        expect((await pushCommits(suite, set, "main", [commit])).status).toBe(
          201
        );
        const replay = await pushCommits(suite, set, "main", [commit]);
        expect(await replay.json()).toEqual({ inserted: 0 });
      } finally {
        setBindParamLimitForTest(undefined);
      }

      const rows = await savesOf(set.sessionId);
      expect(rows).toHaveLength(5);
      expect(rows.map((row) => row.contentState)).toEqual(
        Array(5).fill("stored")
      );
      const links = await db
        .select({ n: count() })
        .from(saveObjects)
        .where(
          inArray(
            saveObjects.saveId,
            rows.map((row) => row.id)
          )
        );
      expect(links[0]!.n).toBe(10);
    });

    it("links a commit whose saves list more objects than one statement can bind", async () => {
      requireProject();
      const set = await adoptNewSet(suite, "Commit many objects");
      const a = savePayload("a", T0);
      await pushSaves(suite, set, "main", [a]);
      const bulk = Array.from({ length: 33_000 }, (_, i) =>
        hashOf(`bulk-${i}`)
      );
      const listed = [...objectsOf(a), ...bulk];
      await seedObjects(set.repoId, owner.userId, listed);

      try {
        const commit = {
          ...commitPayload("c1", null, [a]),
          saves: [{ hash: a.hash, objects: listed }],
        };
        const res = await pushCommits(suite, set, "main", [commit]);
        expect(res.status).toBe(201);

        const [row] = await savesOf(set.sessionId);
        expect(row!.contentState).toBe("stored");
        const [{ linked }] = (await db
          .select({ linked: count() })
          .from(saveObjects)
          .where(eq(saveObjects.saveId, row!.id))) as [{ linked: number }];
        expect(linked).toBe(listed.length);
      } finally {
        // The project's delete takes the links but leaves the objects, and the
        // next save content sweep on the instance would have to reap them all.
        await db
          .delete(saveObjects)
          .where(inArray(saveObjects.objectHash, bulk));
        await removeObjects(bulk);
      }
    }, 30_000);

    it("refuses a commit whose save does not list its tree and side", async () => {
      requireProject();
      const set = await adoptNewSet(suite, "Commit unlisted tree");
      const a = savePayload("a", T0);
      const b = savePayload("b", T0 + MINUTE);
      await pushSaves(suite, set, "main", [a, b]);
      await seedObjects(set.repoId, owner.userId, [...objectsOf(a), b.side]);

      for (const objects of [[a.side], [a.tree], [a.tree, b.side], []]) {
        const commit = commitPayload("c1", null, [a]);
        commit.saves = [{ hash: a.hash, objects }];
        const res = await pushCommits(suite, set, "main", [commit]);
        expect(res.status).toBe(409);
        expect((await res.json()).error).toBe(
          `Save ${a.hash} does not list its tree and side objects`
        );
      }
      expect((await savesOf(set.sessionId)).map((s) => s.contentState)).toEqual(
        ["none", "none"]
      );
      expect(
        await db.select().from(commits).where(eq(commits.repoId, set.repoId))
      ).toHaveLength(0);
    });

    it("refuses a commit whose save has no tree to list", async () => {
      requireProject();
      const set = await adoptNewSet(suite, "Commit no tree");
      const a = savePayload("a", T0, { tree: null });
      await pushSaves(suite, set, "main", [a]);
      await seedObjects(set.repoId, owner.userId, [a.side]);

      const res = await pushCommits(suite, set, "main", [
        commitPayload("c1", null, [a], {
          saves: [{ hash: a.hash, objects: [a.side] }],
        }),
      ]);
      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe(
        `Save ${a.hash} does not list its tree and side objects`
      );
    });

    it("stores a raw save when its commit lists the raw object", async () => {
      requireProject();
      const set = await adoptNewSet(suite, "Commit raw");
      const raw = hashOf("raw-file-1");
      const r = savePayload("raw", T0, {
        xmlHash: null,
        tree: null,
        side: null,
        raw,
        unreadable: true,
      });
      await pushSaves(suite, set, "main", [r]);
      await seedObjects(set.repoId, owner.userId, [raw]);

      const res = await pushCommits(suite, set, "main", [
        commitPayload("c1", null, [r], {
          saves: [{ hash: r.hash, objects: [raw] }],
        }),
      ]);
      expect(res.status).toBe(201);

      const [row] = await db
        .select({ raw: saves.raw, contentState: saves.contentState })
        .from(saves)
        .where(and(eq(saves.sessionId, set.sessionId), eq(saves.hash, r.hash)));
      expect(row).toEqual({ raw, contentState: "stored" });
    });

    it("refuses a commit whose raw save does not list its raw object", async () => {
      requireProject();
      const set = await adoptNewSet(suite, "Commit unlisted raw");
      const raw = hashOf("raw-file-2");
      const r = savePayload("raw-unlisted", T0, {
        xmlHash: null,
        tree: null,
        side: null,
        raw,
        unreadable: true,
      });
      await pushSaves(suite, set, "main", [r]);
      await seedObjects(set.repoId, owner.userId, [raw]);

      const res = await pushCommits(suite, set, "main", [
        commitPayload("c1", null, [r], {
          saves: [{ hash: r.hash, objects: [] }],
        }),
      ]);
      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe(
        `Save ${r.hash} does not list its raw object`
      );
      expect((await savesOf(set.sessionId)).map((s) => s.contentState)).toEqual(
        ["none"]
      );
    });

    it("stores two consecutive saves whose trees and sides are equal", async () => {
      requireProject();
      const set = await adoptNewSet(suite, "Commit equal trees");
      const a = savePayload("eq-a", T0);
      const b = savePayload("eq-b", T0 + MINUTE, {
        xmlHash: a.xmlHash,
        tree: a.tree,
        side: a.side,
      });
      await pushSaves(suite, set, "main", [a, b]);
      await seedObjects(set.repoId, owner.userId, objectsOf(a));

      const first = commitPayload("c1", null, [a]);
      const second = commitPayload("c2", first.hash, [b]);
      const res = await pushCommits(suite, set, "main", [first, second]);
      expect(res.status).toBe(201);

      const rows = await savesOf(set.sessionId);
      expect(rows).toHaveLength(2);
      expect(rows.map((s) => s.contentState)).toEqual(["stored", "stored"]);
    });

    describe("a raw save's set download", () => {
      /** Pushes a raw save whose object is `rawHash`, held by the repo, in one commit. */
      async function commitRawSave(
        set: DitSet,
        label: string,
        rawHash: string
      ) {
        const r = savePayload(label, T0, {
          xmlHash: null,
          tree: null,
          side: null,
          raw: rawHash,
          unreadable: true,
        });
        await pushSaves(suite, set, "main", [r]);
        const res = await pushCommits(suite, set, "main", [
          commitPayload("c1", null, [r], {
            saves: [{ hash: r.hash, objects: [rawHash] }],
          }),
        ]);
        expect(res.status).toBe(201);
        const [commit] = await db
          .select({ id: commits.id })
          .from(commits)
          .where(eq(commits.repoId, set.repoId));
        const [save] = await db
          .select({ id: saves.id })
          .from(saves)
          .where(eq(saves.hash, r.hash));
        return { set, commitId: commit!.id, saveId: save!.id };
      }

      const download = async (path: string) => {
        const res = await suite.request("owner", path);
        expect(res.status).toBe(200);
        return Buffer.from(await res.arrayBuffer());
      };

      it("serves a small raw file byte for byte, not gzipped again", async () => {
        requireProject();
        const raw = hashOf("raw-file-3");
        const path = await writeRawObject(raw, RAW_BYTES);
        try {
          const set = await adoptNewSet(suite, "Commit raw download");
          await seedObjects(set.repoId, owner.userId, [raw]);
          const { commitId, saveId } = await commitRawSave(
            set,
            "raw-download",
            raw
          );
          expect(
            (await download(`/commits/${commitId}/set`)).equals(RAW_BYTES)
          ).toBe(true);
          expect(
            (await download(`/saves/${saveId}/set`)).equals(RAW_BYTES)
          ).toBe(true);
          expect(Buffer.from(await saveFile(saveId)).equals(RAW_BYTES)).toBe(
            true
          );
        } finally {
          await rm(path, { force: true });
        }
      });

      it("reassembles a raw file stored as a Chunked object", async () => {
        requireProject();
        const file = randomBytes(300 * 1024);
        const pieces = [
          file.subarray(0, 100 * 1024),
          file.subarray(100 * 1024, 220 * 1024),
          file.subarray(220 * 1024),
        ];
        const leaves = pieces.map((piece) => objectRecord(piece));
        const chunked = objectRecord(
          Buffer.concat(leaves.map((leaf) => Buffer.from(leaf.hash, "hex"))),
          2
        );
        const stored = [...leaves, chunked].map((record) => record.hash);
        try {
          const set = await adoptNewSet(suite, "Commit raw chunked");
          for (const record of [...leaves, chunked]) {
            await acceptRecord(set.repoId, owner.userId, record);
          }
          const { commitId, saveId } = await commitRawSave(
            set,
            "raw-chunked",
            chunked.hash
          );

          expect(
            (await download(`/commits/${commitId}/set`)).equals(file)
          ).toBe(true);
          expect((await download(`/saves/${saveId}/set`)).equals(file)).toBe(
            true
          );
          expect(Buffer.from(await saveFile(saveId)).equals(file)).toBe(true);
        } finally {
          await removeObjects(stored);
        }
      });
    });

    it("refuses a commit whose parent is not the branch head", async () => {
      requireProject();
      const set = await adoptNewSet(suite, "Commit forks");
      const a = savePayload("a", T0);
      const b = savePayload("b", T0 + MINUTE);
      await pushSaves(suite, set, "main", [a, b]);
      await seedObjects(set.repoId, owner.userId, [a, b].flatMap(objectsOf));
      await pushCommits(suite, set, "main", [commitPayload("c1", null, [a])]);

      const orphan = await pushCommits(suite, set, "main", [
        commitPayload("c2", null, [b]),
      ]);
      expect(orphan.status).toBe(409);
      expect((await orphan.json()).error).toBe("not a fast-forward");

      const stray = await pushCommits(suite, set, "main", [
        commitPayload("c2", hashOf("commit-elsewhere"), [b]),
      ]);
      expect(stray.status).toBe(409);
    });

    it("starts a new branch on the commit it was checked out from", async () => {
      requireProject();
      const set = await adoptNewSet(suite, "Commit checkout");
      const a = savePayload("a", T0);
      const b = savePayload("b", T0 + MINUTE);
      await pushSaves(suite, set, "main", [a]);
      await pushSaves(suite, set, "idea", [b]);
      await seedObjects(set.repoId, owner.userId, [a, b].flatMap(objectsOf));
      const base = commitPayload("c1", null, [a]);
      await pushCommits(suite, set, "main", [base]);

      const fork = commitPayload("c2", base.hash, [b]);
      const res = await pushCommits(suite, set, "idea", [fork]);
      expect(res.status).toBe(201);

      const commitRow = async (hash: string) => {
        const [row] = await db
          .select()
          .from(commits)
          .where(
            and(eq(commits.sessionId, set.sessionId), eq(commits.hash, hash))
          );
        return row;
      };
      const baseRow = await commitRow(base.hash);
      const forkRow = await commitRow(fork.hash);
      const idea = await branchRow(set.sessionId, "idea");
      expect(forkRow!.parentId).toBe(baseRow!.id);
      expect(idea.headCommitId).toBe(forkRow!.id);
      expect((await branchRow(set.sessionId, "main")).headCommitId).toBe(
        baseRow!.id
      );

      // Only a branch with no commit yet forks; one with a head must continue it.
      const again = await pushCommits(suite, set, "idea", [
        commitPayload("c3", base.hash, [b]),
      ]);
      expect(again.status).toBe(409);
    });

    it("refuses a new branch whose parent is another session's commit", async () => {
      requireProject();
      const other = await adoptNewSet(suite, "Commit elsewhere");
      const a = savePayload("a", T0);
      await pushSaves(suite, other, "main", [a]);
      await seedObjects(other.repoId, owner.userId, objectsOf(a));
      const foreign = commitPayload("c1", null, [a]);
      await pushCommits(suite, other, "main", [foreign]);

      const set = await adoptNewSet(suite, "Commit stranger");
      const b = savePayload("b", T0 + MINUTE);
      await pushSaves(suite, set, "idea", [b]);
      await seedObjects(set.repoId, owner.userId, objectsOf(b));

      const res = await pushCommits(suite, set, "idea", [
        commitPayload("c2", foreign.hash, [b]),
      ]);
      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe("not a fast-forward");
    });

    it("lets only one of two racing first commits on a branch through", async () => {
      requireProject();
      const set = await adoptNewSet(suite, "Commit race");
      const a = savePayload("a", T0);
      const b = savePayload("b", T0 + MINUTE);
      await pushSaves(suite, set, "main", [a, b]);
      await seedObjects(set.repoId, owner.userId, [a, b].flatMap(objectsOf));

      const results = await Promise.all([
        pushCommits(suite, set, "main", [commitPayload("left", null, [a])]),
        pushCommits(suite, set, "main", [commitPayload("right", null, [b])]),
      ]);
      expect(results.map((res) => res.status).sort()).toEqual([201, 409]);
      expect(
        await db.select().from(commits).where(eq(commits.repoId, set.repoId))
      ).toHaveLength(1);
    });

    it("names the objects the repo does not hold, whether or not another repo does", async () => {
      requireProject();
      const set = await adoptNewSet(suite, "Commit objects");
      const other = await adoptNewSet(suite, "Commit objects elsewhere");
      const a = savePayload("a", T0);
      await pushSaves(suite, set, "main", [a]);
      await seedObjects(other.repoId, owner.userId, [a.tree]);
      await seedObjects(set.repoId, owner.userId, [a.side]);

      const res = await pushCommits(suite, set, "main", [
        commitPayload("c1", null, [a]),
      ]);
      expect(res.status).toBe(409);
      const { error } = await res.json();
      expect(error).toContain(a.tree);
      expect(error).not.toContain(a.side);
      expect((await savesOf(set.sessionId))[0]!.contentState).toBe("none");
      expect(
        await db.select().from(commits).where(eq(commits.repoId, set.repoId))
      ).toHaveLength(0);
    });

    it("names the saves the session has not recorded", async () => {
      requireProject();
      const set = await adoptNewSet(suite, "Commit unknown saves");
      const known = savePayload("a", T0);
      const unknown = savePayload("b", T0 + MINUTE);
      await pushSaves(suite, set, "main", [known]);
      await seedObjects(
        set.repoId,
        owner.userId,
        [known, unknown].flatMap(objectsOf)
      );

      const res = await pushCommits(suite, set, "main", [
        commitPayload("c1", null, [known, unknown]),
      ]);
      expect(res.status).toBe(409);
      const { error } = await res.json();
      expect(error).toContain(unknown.hash);
      expect(error).not.toContain(known.hash);
    });

    it("rejects a commit whose save is not among its saves", async () => {
      requireProject();
      const set = await adoptNewSet(suite, "Commit own save");
      const a = savePayload("a", T0);
      const res = await pushCommits(suite, set, "main", [
        commitPayload("c1", null, [a], { saveHash: hashOf("save-other") }),
      ]);
      expect(res.status).toBe(400);
    });

    it("creates the branch its first commit names and refuses a viewer", async () => {
      requireProject();
      const set = await adoptNewSet(suite, "Commit access");
      const a = savePayload("a", T0);
      await pushSaves(suite, set, "feature", [a]);
      await seedObjects(set.repoId, owner.userId, objectsOf(a));

      await expectAccess(
        "POST",
        `/repos/${set.repoId}/commits`,
        { viewer: 403, editor: 201 },
        {
          ditSetId: set.ditSetId,
          branch: "feature",
          commits: [commitPayload("c1", null, [a])],
        },
        undefined,
        (caller) => machineHeader(suite, caller)
      );
    });
  });

  describe("GET /sessions/:id/branches and /commits", () => {
    it("lists branches with their head and commits newest first with the saves each covers", async () => {
      requireProject();
      const set = await adoptNewSet(suite, "History reads");
      const a = savePayload("a", T0);
      const b = savePayload("b", T0 + MINUTE);
      await pushSaves(suite, set, "main", [a, b]);
      await pushSaves(suite, set, "idea", [savePayload("i", T0 + 5 * MINUTE)]);
      await seedObjects(set.repoId, owner.userId, [a, b].flatMap(objectsOf));
      const first = commitPayload("c1", null, [a]);
      const second = commitPayload("c2", first.hash, [b]);
      await pushCommits(suite, set, "main", [first, second]);

      const branchList = await request(
        "viewer",
        `/sessions/${set.sessionId}/branches`
      );
      expect(branchList.status).toBe(200);
      expect(await branchList.json()).toEqual([
        { name: "main", headCommitHash: second.hash },
        { name: "idea", headCommitHash: null },
      ]);

      const history = await request(
        "viewer",
        `/sessions/${set.sessionId}/commits`
      );
      expect(history.status).toBe(200);
      const rows = await history.json();
      expect(rows.map((row: { hash: string }) => row.hash)).toEqual([
        second.hash,
        first.hash,
      ]);
      expect(rows[0]).toMatchObject({
        branch: "main",
        parentHash: first.hash,
        authorId: owner.userId,
        saveHash: b.hash,
      });
      expect(rows[0].saves.map((s: { hash: string }) => s.hash)).toEqual([
        b.hash,
      ]);
    });

    it("keeps one branch's commits and names each commit's author and sample counts", async () => {
      requireProject();
      const set = await adoptNewSet(suite, "History branch");
      const a = savePayload("hb-a", T0);
      const i = savePayload("hb-i", T0 + MINUTE);
      await pushSaves(suite, set, "main", [a]);
      await pushSaves(suite, set, "idea", [i]);
      await seedObjects(set.repoId, owner.userId, [a, i].flatMap(objectsOf));
      const main = commitPayload("hb-main", null, [a]);
      const idea = commitPayload("hb-idea", null, [i]);
      await pushCommits(suite, set, "main", [main]);
      await pushCommits(suite, set, "idea", [idea]);

      const read = async (query: string) =>
        (
          await request("viewer", `/sessions/${set.sessionId}/commits${query}`)
        ).json() as Promise<
          {
            hash: string;
            authorName: string | null;
            samplesReferenced: number;
            samplesHeld: number;
          }[]
        >;

      expect((await read("")).map((row) => row.hash)).toEqual([
        idea.hash,
        main.hash,
      ]);
      const onMain = await read("?branch=main");
      expect(onMain.map((row) => row.hash)).toEqual([main.hash]);
      expect(onMain[0]).toMatchObject({
        authorName: owner.name,
        samplesReferenced: 0,
        samplesHeld: 0,
      });
      expect(await read("?branch=nope")).toEqual([]);
      expect(
        (
          await request(
            "viewer",
            `/sessions/${set.sessionId}/commits?limit=501`
          )
        ).status
      ).toBe(400);
      expect(
        (
          await request(
            "viewer",
            `/sessions/${set.sessionId}/commits?limit=500`
          )
        ).status
      ).toBe(200);
    });

    it("counts the whole history on the session detail, not the loaded window", async () => {
      requireProject();
      const set = await adoptNewSet(suite, "History counts");
      const a = savePayload("hc-a", T0, { machineName: "studio" });
      const b = savePayload("hc-b", T0 + MINUTE, { machineName: "laptop" });
      const c = savePayload("hc-c", T0 + 2 * MINUTE, { machineName: "studio" });
      await pushSaves(suite, set, "main", [a, b, c]);
      await seedObjects(set.repoId, owner.userId, [a, b, c].flatMap(objectsOf));
      const first = commitPayload("hc-1", null, [a]);
      const second = commitPayload("hc-2", first.hash, [b, c]);
      await pushCommits(suite, set, "main", [first, second]);

      const res = await request("viewer", `/sessions/${set.sessionId}`);
      expect(res.status).toBe(200);
      expect((await res.json()).history).toEqual({
        commits: 2,
        saves: 3,
        machines: 2,
        firstSeenAt: new Date(T0).toISOString(),
        timeInSet: 0,
        contentRetentionDays: expect.any(Number),
      });

      const empty = await adoptNewSet(suite, "History counts empty");
      const bare = await request("viewer", `/sessions/${empty.sessionId}`);
      expect((await bare.json()).history).toEqual({
        commits: 0,
        saves: 0,
        machines: 0,
        firstSeenAt: null,
        timeInSet: 0,
        contentRetentionDays: expect.any(Number),
      });
    });

    it("reaches the history handlers behind the session gate", async () => {
      requireProject();
      const set = await adoptNewSet(suite, "History access");
      for (const path of ["commits", "branches"]) {
        await expectAccess(
          "GET",
          `/sessions/${set.sessionId}/${path}`,
          { viewer: 200, editor: 200, owner: 200 },
          undefined,
          (rows) => expect(rows).toEqual([])
        );
      }
    });
  });

  describe("GET /sessions/:id/diff", () => {
    const meta = (tempo: string, samplePaths: string[]) => ({
      tempo,
      timeSignature: "4/4",
      rootNote: null,
      scale: null,
      tracksCount: 1,
      scenesCount: 0,
      dawVersion: null,
      structure: null,
      samplePaths,
    });

    it("diffs a save against a commit on another branch, from either end", async () => {
      requireProject();
      const set = await adoptNewSet(suite, "Diff route");
      const a = savePayload("dr-a", T0, { meta: meta("120", []) });
      const b = savePayload("dr-b", T0 + MINUTE, {
        meta: meta("128", ["kick.wav"]),
      });
      await pushSaves(suite, set, "main", [a]);
      await pushSaves(suite, set, "idea", [b]);
      await seedObjects(set.repoId, owner.userId, [a, b].flatMap(objectsOf));
      const onIdea = commitPayload("dr-idea", null, [b]);
      await pushCommits(suite, set, "idea", [onIdea]);
      const [saveA] = await savesOf(set.sessionId);
      const [commitB] = await db
        .select({ id: commits.id, saveId: commits.saveId })
        .from(commits)
        .where(eq(commits.hash, onIdea.hash));

      const res = await request(
        "viewer",
        `/sessions/${set.sessionId}/diff?from=save:${saveA!.id}&to=commit:${commitB!.id}`
      );
      expect(res.status).toBe(200);
      const diff = await res.json();
      expect(diff).toMatchObject({
        from: saveA!.id,
        to: commitB!.saveId,
        first: false,
        changed: true,
        samples: { added: ["kick.wav"], removed: [] },
      });
      expect(diff.chips.map((chip: { label: string }) => chip.label)).toEqual([
        "tempo 120 → 128",
        "+1 sample",
      ]);
      expect(diff.readouts[0]).toMatchObject({
        gauge: "ruler",
        min: 60,
        max: 200,
        from: 120,
        to: 128,
      });

      const back = await request(
        "viewer",
        `/sessions/${set.sessionId}/diff?from=commit:${commitB!.id}&to=save:${saveA!.id}`
      );
      expect((await back.json()).chips[0].label).toBe("tempo 128 → 120");
    });

    it("answers 400 for a malformed reference, 404 for a state of another session and 409 for a save with no meta", async () => {
      requireProject();
      const set = await adoptNewSet(suite, "Diff refusals");
      const other = await adoptNewSet(suite, "Diff refusals other");
      const a = savePayload("df-a", T0, { meta: meta("120", []) });
      const bare = savePayload("df-bare", T0 + MINUTE);
      const foreign = savePayload("df-foreign", T0, { meta: meta("90", []) });
      await pushSaves(suite, set, "main", [a, bare]);
      await pushSaves(suite, other, "main", [foreign]);
      const [saveA, saveBare] = await savesOf(set.sessionId);
      const [saveForeign] = await savesOf(other.sessionId);
      const diff = (from: string, to: string) =>
        request(
          "viewer",
          `/sessions/${set.sessionId}/diff?from=${from}&to=${to}`
        );

      expect((await diff("12", `save:${saveA!.id}`)).status).toBe(400);
      expect((await diff(`save:${saveA!.id}`, "tag:3")).status).toBe(400);
      expect(
        (await diff(`save:${saveA!.id}`, `save:${saveForeign!.id}`)).status
      ).toBe(404);
      expect(
        (await diff(`save:${saveA!.id}`, "commit:2147483000")).status
      ).toBe(404);
      expect(
        (await diff(`save:${saveA!.id}`, `save:${saveBare!.id}`)).status
      ).toBe(409);
    });

    it("is gated on the session like every history read", async () => {
      requireProject();
      const set = await adoptNewSet(suite, "Diff access");
      const a = savePayload("da-a", T0, { meta: meta("120", []) });
      const b = savePayload("da-b", T0 + MINUTE, { meta: meta("121", []) });
      await pushSaves(suite, set, "main", [a, b]);
      const [saveA, saveB] = await savesOf(set.sessionId);
      await expectAccess(
        "GET",
        `/sessions/${set.sessionId}/diff?from=save:${saveA!.id}&to=save:${saveB!.id}`,
        { viewer: 200, editor: 200, owner: 200 }
      );
    });
  });
});

describe("lineage objects and the commit read", () => {
  const lineageHeld = async (repoId: number, hashes: string[]) =>
    (
      await db
        .select({ hash: repoObjects.objectHash })
        .from(repoObjects)
        .where(
          and(
            eq(repoObjects.repoId, repoId),
            inArray(repoObjects.objectHash, hashes)
          )
        )
    )
      .map((row) => row.hash)
      .sort();

  it("links the save and commit objects a commit names that the project holds", async () => {
    requireProject();
    const elsewhere = await adoptNewSet(suite, "Lineage source");
    const set = await adoptNewSet(suite, "Lineage links");
    const a = savePayload("lin-link-a", T0);
    const commitHash = hashOf("commit-lin-link");
    await pushSaves(suite, set, "main", [a]);
    await seedObjects(set.repoId, owner.userId, objectsOf(a));
    await seedObjects(elsewhere.repoId, owner.userId, [a.hash, commitHash]);

    const res = await pushCommits(suite, set, "main", [
      commitPayload("lin-link", null, [a], {
        lineageObjects: [a.hash, commitHash],
      }),
    ]);

    expect(res.status).toBe(201);
    expect(await lineageHeld(set.repoId, [a.hash, commitHash])).toEqual(
      [a.hash, commitHash].sort()
    );
  });

  it("refuses a commit that names a lineage object no repo of the project holds", async () => {
    requireProject();
    const set = await adoptNewSet(suite, "Lineage refused");
    const a = savePayload("lin-refused-a", T0);
    const ghost = hashOf("lineage nowhere");
    await pushSaves(suite, set, "main", [a]);
    await seedObjects(set.repoId, owner.userId, objectsOf(a));

    const res = await pushCommits(suite, set, "main", [
      commitPayload("lin-refused", null, [a], {
        lineageObjects: [a.hash, ghost],
      }),
    ]);

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "lineage_not_held" });
    expect(await lineageHeld(set.repoId, [a.hash, ghost])).toEqual([]);
  });

  it("answers a replayed commit with its lineage objects still linked", async () => {
    requireProject();
    const elsewhere = await adoptNewSet(suite, "Lineage replay source");
    const set = await adoptNewSet(suite, "Lineage replay");
    const a = savePayload("lin-replay-a", T0);
    const commitHash = hashOf("commit-lin-replay");
    await pushSaves(suite, set, "main", [a]);
    await seedObjects(set.repoId, owner.userId, objectsOf(a));
    await seedObjects(elsewhere.repoId, owner.userId, [a.hash, commitHash]);
    const commit = commitPayload("lin-replay", null, [a], {
      lineageObjects: [a.hash, commitHash],
    });
    expect((await pushCommits(suite, set, "main", [commit])).status).toBe(201);

    const replay = await pushCommits(suite, set, "main", [commit]);

    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({ inserted: 0 });
    expect(await lineageHeld(set.repoId, [a.hash, commitHash])).toEqual(
      [a.hash, commitHash].sort()
    );
  });

  it("takes every object lock of a multi-commit push in one statement", async () => {
    requireProject();
    const elsewhere = await adoptNewSet(suite, "Lineage lock source");
    const set = await adoptNewSet(suite, "Lineage lock");
    const a = savePayload("lin-lock-a", T0);
    const b = savePayload("lin-lock-b", T0 + MINUTE);
    const c = savePayload("lin-lock-c", T0 + 2 * MINUTE);
    const lineage = ["a", "b", "c"].map((n) => hashOf(`commit-lin-lock-${n}`));
    await pushSaves(suite, set, "main", [a, b, c]);
    await seedObjects(set.repoId, owner.userId, [a, b, c].flatMap(objectsOf));
    await seedObjects(elsewhere.repoId, owner.userId, lineage);
    const first = commitPayload("lin-lock-1", null, [a], {
      lineageObjects: [lineage[0]!],
    });
    const second = commitPayload("lin-lock-2", first.hash, [b], {
      lineageObjects: [lineage[1]!],
    });
    const third = commitPayload("lin-lock-3", second.hash, [c], {
      lineageObjects: [lineage[2]!],
    });

    const querySpy = spyOn(pg.Client.prototype, "query");
    querySpy.mockClear();
    try {
      const res = await pushCommits(suite, set, "main", [first, second, third]);
      expect(res.status).toBe(201);
      const locks = querySpy.mock.calls.filter((call) => {
        const [statement] = call as unknown[];
        const text =
          typeof statement === "string"
            ? statement
            : String((statement as { text?: unknown } | undefined)?.text ?? "");
        return text.includes("pg_advisory_xact_lock");
      });
      expect(locks).toHaveLength(1);
    } finally {
      querySpy.mockRestore();
    }
    expect(await lineageHeld(set.repoId, lineage)).toEqual([...lineage].sort());
  });

  it("serves a commit's record to a viewer and refuses a stranger", async () => {
    requireProject();
    const set = await adoptNewSet(suite, "Commit read");
    const a = savePayload("cr-a", T0);
    await pushSaves(suite, set, "main", [a]);
    await seedObjects(set.repoId, owner.userId, objectsOf(a));
    const commit = commitPayload("cr-1", null, [a]);
    expect((await pushCommits(suite, set, "main", [commit])).status).toBe(201);
    const [row] = await db
      .select({ id: commits.id })
      .from(commits)
      .where(eq(commits.hash, commit.hash));

    const res = await request("viewer", `/commits/${row!.id}`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: row!.id,
      hash: commit.hash,
      parentHash: null,
      saveHash: a.hash,
      message: "cr-1",
      kind: "user",
      committedAt: new Date(a.fileUpdatedAt + 1).toISOString(),
      branch: "main",
      ditSetId: set.ditSetId,
      repoId: set.repoId,
      sessionId: set.sessionId,
      sessionName: expect.any(String),
    });
    await expectAccess("GET", `/commits/${row!.id}`, {
      viewer: 200,
      editor: 200,
      owner: 200,
    });
  });
});
