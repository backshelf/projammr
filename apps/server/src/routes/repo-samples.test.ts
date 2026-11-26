import { afterAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { recordRevisions } from "../db/queries/saves.js";
import { repoStorages } from "../db/queries/storage-usage.js";
import { saveSampleObjects } from "../db/schema/objects.js";
import { saves } from "../db/schema/saves.js";
import { sessionSamples } from "../db/schema/session-samples.js";
import {
  adoptNewSet,
  commitPayload,
  hashOf,
  objectsOf,
  pushCommits,
  pushSaves,
  savePayload,
  trackSeeds,
} from "../test/dit-history.js";
import {
  acceptRecord,
  objectRecord,
  removeObjects,
} from "../test/dit-objects.js";
import { setupSuite } from "../test/fixtures.js";

const suite = setupSuite("Repo samples");
const { owner, requireProject, request, expectAccess } = suite;
const { seedObjects, removeSeeded } = trackSeeds();

const stored: string[] = [];
afterAll(async () => {
  await removeSeeded();
  await removeObjects(stored);
});

const T0 = Date.UTC(2026, 5, 1);

const META = {
  tempo: "120",
  timeSignature: "4/4",
  rootNote: null,
  scale: null,
  tracksCount: 1,
  scenesCount: 1,
  dawVersion: "12.1",
  structure: null,
  samplePaths: null,
};

/** A reference as dit sends it. */
const ref = (
  path: string,
  kind: "project" | "outside" | "library",
  object: string | null,
  size: number | null = null
) => ({
  path,
  kind,
  ...(kind === "project" && path.startsWith("Samples/")
    ? { relative: path }
    : {}),
  object,
  size,
});

/** A sample object the repo really holds, with its file stored. */
async function holdSample(repoId: number, content: string, kind = 1) {
  const record = objectRecord(content, kind);
  stored.push(record.hash);
  await acceptRecord(repoId, owner.userId, record);
  return record.hash;
}

describe("sample references on the hub", () => {
  it("keeps the references in the save's meta and mirrors them into the session's samples", async () => {
    requireProject();
    const set = await adoptNewSet(suite, "Refs land");
    const held = hashOf("refs-land-held");
    const refs = [
      ref("Samples/kick.wav", "project", held, 4),
      ref("Samples/kick.wav", "project", held, 4),
      ref("/Users/x/Documents/snare.wav", "outside", null),
      ref("Samples/missing.wav", "project", null),
    ];
    const save = savePayload("refs-land", T0, { meta: META, samples: refs });

    const res = await pushSaves(suite, set, "main", [save]);
    expect(res.status).toBe(200);

    const [row] = await db
      .select()
      .from(saves)
      .where(eq(saves.sessionId, set.sessionId));
    // Listed twice by path, kept once.
    expect(row!.meta!.samples).toEqual([refs[1]!, refs[2]!, refs[3]!]);
    const mirrored = await db
      .select({
        path: sessionSamples.path,
        kind: sessionSamples.kind,
        status: sessionSamples.status,
      })
      .from(sessionSamples)
      .where(eq(sessionSamples.sessionId, set.sessionId))
      .orderBy(sessionSamples.position);
    expect(mirrored).toEqual([
      { path: "Samples/kick.wav", kind: "project", status: "present" },
      {
        path: "/Users/x/Documents/snare.wav",
        kind: "outside",
        status: "unknown",
      },
      { path: "Samples/missing.wav", kind: "project", status: "unknown" },
    ]);
  });

  it("accepts a save with no samples field and leaves the stored references alone", async () => {
    requireProject();
    const set = await adoptNewSet(suite, "Old client");
    const refs = [ref("Samples/a.wav", "project", null)];
    await pushSaves(suite, set, "main", [
      savePayload("old", T0, { meta: META, samples: refs }),
    ]);

    const later = savePayload("old-later", T0 + 60_000, { meta: META });
    expect((await pushSaves(suite, set, "main", [later])).status).toBe(200);

    const rows = await db
      .select({ path: sessionSamples.path })
      .from(sessionSamples)
      .where(eq(sessionSamples.sessionId, set.sessionId));
    expect(rows).toEqual([{ path: "Samples/a.wav" }]);
  });

  it("empties the session's samples when the newest save references none, and ignores an older save pushed late", async () => {
    requireProject();
    const set = await adoptNewSet(suite, "Newest wins");
    const a = ref("Samples/a.wav", "project", null);
    await pushSaves(suite, set, "main", [
      savePayload("nw-2", T0 + 120_000, { meta: META, samples: [] }),
    ]);
    // An older save arriving afterwards must not put its samples back.
    await pushSaves(suite, set, "main", [
      savePayload("nw-1", T0, { meta: META, samples: [a] }),
    ]);

    const rows = await db
      .select()
      .from(sessionSamples)
      .where(eq(sessionSamples.sessionId, set.sessionId));
    expect(rows).toEqual([]);
  });

  it("gives a scanner-recorded save the references and keeps the meta the scanner read", async () => {
    requireProject();
    const set = await adoptNewSet(suite, "Scanner keeps");
    const scannerMeta = { ...META, tempo: "99" };
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
    const refs = [ref("Samples/s.wav", "project", null)];
    const save = savePayload("scanner-keeps", T0, { meta: META });
    // The first push claims the scanner's row; the second reaches the upsert
    // of a row that keeps its source.
    await pushSaves(suite, set, "main", [save]);
    await pushSaves(suite, set, "main", [
      savePayload("scanner-keeps", T0, { meta: META, samples: refs }),
    ]);

    const [row] = await db
      .select()
      .from(saves)
      .where(eq(saves.sessionId, set.sessionId));
    expect(row!.source).toBe("scan");
    expect(row!.meta).toEqual({ ...scannerMeta, samples: refs });
  });

  it("stores thousands of references past one statement's bind limit", async () => {
    requireProject();
    const set = await adoptNewSet(suite, "Many refs");
    const refs = Array.from({ length: 9_000 }, (_, n) =>
      ref(`Samples/s${n}.wav`, "project", null)
    );
    const res = await pushSaves(suite, set, "main", [
      savePayload("many", T0, { meta: META, samples: refs }),
    ]);
    expect(res.status).toBe(200);
    const rows = await db
      .select({ path: sessionSamples.path })
      .from(sessionSamples)
      .where(eq(sessionSamples.sessionId, set.sessionId));
    expect(rows).toHaveLength(9_000);
  });
});

describe("sample objects on a commit", () => {
  const linked = async (saveId: number) =>
    (
      await db
        .select({ hash: saveSampleObjects.objectHash })
        .from(saveSampleObjects)
        .where(eq(saveSampleObjects.saveId, saveId))
    )
      .map((row) => row.hash)
      .sort();

  it("links the objects the repo holds, never one it lacks, and counts every reference against what it holds on the commit row", async () => {
    requireProject();
    const set = await adoptNewSet(suite, "Links held");
    const held = await holdSample(set.repoId, "links-held-a");
    const absent = hashOf("links-held-absent");
    const refs = [
      ref("Samples/a.wav", "project", held, 12),
      ref("Samples/b.wav", "project", absent, 12),
      ref("/elsewhere/c.wav", "outside", null),
    ];
    const save = savePayload("links-held", T0, { meta: META, samples: refs });
    await pushSaves(suite, set, "main", [save]);
    await seedObjects(set.repoId, owner.userId, objectsOf(save));
    const res = await pushCommits(suite, set, "main", [
      commitPayload("links-held", null, [save], {
        sampleObjects: [held, absent],
      }),
    ]);
    expect(res.status).toBe(201);

    const [row] = await db
      .select({ id: saves.id })
      .from(saves)
      .where(eq(saves.sessionId, set.sessionId));
    expect(await linked(row!.id)).toEqual([held]);

    const list = await request("owner", `/sessions/${set.sessionId}/commits`);
    const [commit] = await list.json();
    expect(commit).toMatchObject({ samplesReferenced: 3, samplesHeld: 1 });
  });

  it("links only objects the commit's own save references, whatever the body lists", async () => {
    requireProject();
    const set = await adoptNewSet(suite, "Links trusted");
    const named = await holdSample(set.repoId, "links-trusted-named");
    const stray = await holdSample(set.repoId, "links-trusted-stray");
    const save = savePayload("links-trusted", T0, {
      meta: META,
      samples: [ref("Samples/a.wav", "project", named, 5)],
    });
    await pushSaves(suite, set, "main", [save]);
    await seedObjects(set.repoId, owner.userId, objectsOf(save));
    const res = await pushCommits(suite, set, "main", [
      commitPayload("links-trusted", null, [save], {
        sampleObjects: [named, stray],
      }),
    ]);
    expect(res.status).toBe(201);
    const [row] = await db
      .select({ id: saves.id })
      .from(saves)
      .where(eq(saves.sessionId, set.sessionId));
    expect(await linked(row!.id)).toEqual([named]);
  });

  it("links a sample that lands after its commit when the commit is pushed again, and the count follows", async () => {
    requireProject();
    const set = await adoptNewSet(suite, "Lands later");
    const content = "lands-later";
    const record = objectRecord(content);
    stored.push(record.hash);
    const refs = [ref("Samples/late.wav", "project", record.hash, 11)];
    const save = savePayload("lands-later", T0, { meta: META, samples: refs });
    await pushSaves(suite, set, "main", [save]);
    await seedObjects(set.repoId, owner.userId, objectsOf(save));
    const commit = commitPayload("lands-later", null, [save], {
      sampleObjects: [record.hash],
    });
    expect((await pushCommits(suite, set, "main", [commit])).status).toBe(201);

    const count = async () => {
      const list = await request("owner", `/sessions/${set.sessionId}/commits`);
      const [row] = await list.json();
      return [row.samplesReferenced, row.samplesHeld];
    };
    expect(await count()).toEqual([1, 0]);

    await acceptRecord(set.repoId, owner.userId, record);
    const again = await pushCommits(suite, set, "main", [commit]);
    expect(again.status).toBe(200);
    expect(await count()).toEqual([1, 1]);
  });

  it("links the chunks of a Chunked sample with it", async () => {
    requireProject();
    const set = await adoptNewSet(suite, "Chunked links");
    const first = await holdSample(set.repoId, "chunk-one");
    const second = await holdSample(set.repoId, "chunk-two");
    const chunked = objectRecord(
      Buffer.concat([Buffer.from(first, "hex"), Buffer.from(second, "hex")]),
      2
    );
    stored.push(chunked.hash);
    await acceptRecord(set.repoId, owner.userId, chunked);

    const refs = [ref("Samples/big.wav", "project", chunked.hash, 18)];
    const save = savePayload("chunked-links", T0, {
      meta: META,
      samples: refs,
    });
    await pushSaves(suite, set, "main", [save]);
    await seedObjects(set.repoId, owner.userId, objectsOf(save));
    await pushCommits(suite, set, "main", [
      commitPayload("chunked-links", null, [save], {
        sampleObjects: [chunked.hash],
      }),
    ]);
    const [row] = await db
      .select({ id: saves.id })
      .from(saves)
      .where(eq(saves.sessionId, set.sessionId));
    expect(await linked(row!.id)).toEqual([chunked.hash, first, second].sort());
  });

  it("marks each sample of the session detail with whether the hub holds its bytes", async () => {
    requireProject();
    const set = await adoptNewSet(suite, "Detail held");
    const held = await holdSample(set.repoId, "detail-held");
    const refs = [
      ref("Samples/here.wav", "project", held, 11),
      ref("Samples/gone.wav", "project", hashOf("detail-gone"), 3),
      ref("/out/there.wav", "outside", null),
    ];
    await pushSaves(suite, set, "main", [
      savePayload("detail-held", T0, { meta: META, samples: refs }),
    ]);

    const res = await request("owner", `/sessions/${set.sessionId}`);
    const detail = await res.json();
    expect(
      detail.samples.map((s: { path: string; held: boolean }) => [
        s.path,
        s.held,
      ])
    ).toEqual([
      ["Samples/here.wav", true],
      ["Samples/gone.wav", false],
      ["/out/there.wav", false],
    ]);
  });

  describe("GET /samples/:hash", () => {
    it("serves a held sample named as its reference names it, to every member and no one else", async () => {
      requireProject();
      const set = await adoptNewSet(suite, "Sample download");
      const hash = await holdSample(set.repoId, "the bytes of a sample");
      const refs = [ref("Samples/Imported/kick.wav", "project", hash, 21)];
      const save = savePayload("sample-download", T0, {
        meta: META,
        samples: refs,
      });
      await pushSaves(suite, set, "main", [save]);
      await seedObjects(set.repoId, owner.userId, objectsOf(save));
      await pushCommits(suite, set, "main", [
        commitPayload("sample-download", null, [save], {
          sampleObjects: [hash],
        }),
      ]);
      const path = `/samples/${hash}?repo=${set.repoId}`;

      await expectAccess("GET", path, { viewer: 200, editor: 200, owner: 200 });

      const res = await request("viewer", path);
      expect(res.headers.get("Content-Disposition")).toBe(
        'attachment; filename="kick.wav"'
      );
      expect(await res.text()).toBe("the bytes of a sample");
    });

    it("answers 404 for an object the repo does not hold as a sample, and for a repo of another project", async () => {
      requireProject();
      const set = await adoptNewSet(suite, "Sample gate");
      const plain = await holdSample(set.repoId, "not a sample, just held");
      expect(
        (await request("owner", `/samples/${plain}?repo=${set.repoId}`)).status
      ).toBe(404);
      expect(
        (await request("owner", `/samples/${plain}?repo=2147483000`)).status
      ).toBe(404);
      expect((await request("owner", `/samples/${plain}`)).status).toBe(404);
      expect(
        (await request("owner", `/samples/nothex?repo=${set.repoId}`)).status
      ).toBe(400);
    });
  });
});

describe("repo storage with samples", () => {
  it("splits a repo's bytes into set and sample bytes, and counts what another repo paid first as shared", async () => {
    requireProject();
    const first = await adoptNewSet(suite, "Storage first");
    const second = await adoptNewSet(suite, "Storage second");
    const sample = await holdSample(first.repoId, "shared sample bytes");
    await acceptRecord(
      second.repoId,
      owner.userId,
      objectRecord("shared sample bytes")
    );

    for (const [set, label] of [
      [first, "storage-first"],
      [second, "storage-second"],
    ] as const) {
      const save = savePayload(label, T0, {
        meta: META,
        samples: [ref("Samples/s.wav", "project", sample, 19)],
      });
      await pushSaves(suite, set, "main", [save]);
      await seedObjects(set.repoId, owner.userId, objectsOf(save));
      await pushCommits(suite, set, "main", [
        commitPayload(label, null, [save], { sampleObjects: [sample] }),
      ]);
    }

    const stored = await repoStorages([first.repoId, second.repoId]);
    const one = stored.get(first.repoId)!;
    const two = stored.get(second.repoId)!;
    // The stored frame, not the file: the same object in both repos.
    expect(one.sampleBytes).toBeGreaterThan(0);
    expect(two.sampleBytes).toBe(one.sampleBytes);
    expect(one.sharedBytes).toBe(0);
    expect(two.sharedBytes).toBe(two.sampleBytes);
    expect(one.setBytes).toBe(20);
    expect(two.setBytes).toBe(20);
  });
});
