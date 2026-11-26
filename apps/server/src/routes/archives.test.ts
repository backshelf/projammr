import { afterAll, afterEach, describe, expect, it, spyOn } from "bun:test";
import { readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { constants, zstdCompressSync } from "node:zlib";
import { eq } from "drizzle-orm";
import { buildObjects } from "@workspace/dit/test-pack";
import { db } from "../db/index.js";
import { objects, repoObjects } from "../db/schema/objects.js";
import { commits } from "../db/schema/repos.js";
import { saves } from "../db/schema/saves.js";
import * as sampleObjects from "../lib/sample-objects.js";
import { objectKey, storedFilePath, storeObjects } from "../lib/storage.js";
import {
  adoptNewSet,
  commitPayload,
  pushCommits,
  pushSaves,
  savePayload,
  type DitSet,
} from "../test/dit-history.js";
import {
  acceptRecord,
  objectRecord,
  removeObjects,
} from "../test/dit-objects.js";
import { setupSuite } from "../test/fixtures.js";
import {
  restoreInstancePolicy,
  stubInstancePolicy,
} from "../test/instance-policy.js";
import { readZip, unzipTest } from "../test/zip-reader.js";

const suite = setupSuite("Archives");
const { owner, requireProject, request, expectAccess } = suite;

const T0 = Date.UTC(2026, 5, 1);

const FIXTURE_DIR =
  "../../packages/dit/crates/dit-daw-ableton/fixtures/Contract Fixtures Project";
const arrangedSetXml = new Uint8Array(
  Bun.gunzipSync(
    new Uint8Array(readFileSync(`${FIXTURE_DIR}/Arranged Set.als`))
  )
);

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

const hex = (id: Uint8Array) => Buffer.from(id).toString("hex");

const stored: string[] = [];
afterAll(() => removeObjects(stored));
afterEach(() => restoreInstancePolicy());

/** A sample as a test describes it: its path, kind and the bytes the hub holds, if any. */
type Sample =
  | { path: string; kind: "outside" | "library" }
  | { path: string; kind: "project"; absent: true }
  | { path: string; kind: "project"; content: string }
  | { path: string; kind: "project"; chunks: string[] };

/** A sample's reference, the object ids a commit lists for it and the chunks it holds. */
type Held = {
  ref: Record<string, unknown>;
  listed: string[];
  leaves?: string[];
};

/** A sample's reference and the objects to hold for it. */
async function hold(set: DitSet, sample: Sample): Promise<Held> {
  const base = { path: sample.path, kind: sample.kind };
  if (sample.kind !== "project")
    return { ref: { ...base, object: null, size: null }, listed: [] };
  const relative = sample.path.startsWith("Samples/") ? sample.path : undefined;
  const common = { ...base, ...(relative ? { relative } : {}) };
  if ("absent" in sample) {
    return {
      ref: { ...common, object: "ab".repeat(32), size: 10 },
      listed: ["ab".repeat(32)],
    };
  }
  if ("content" in sample) {
    const record = objectRecord(sample.content);
    stored.push(record.hash);
    await acceptRecord(set.repoId, owner.userId, record);
    return {
      ref: { ...common, object: record.hash, size: sample.content.length },
      listed: [record.hash],
    };
  }
  const leaves = sample.chunks.map((chunk) => objectRecord(chunk));
  const chunked = objectRecord(
    Buffer.concat(leaves.map((leaf) => Buffer.from(leaf.hash, "hex"))),
    2
  );
  for (const record of [...leaves, chunked]) {
    stored.push(record.hash);
    await acceptRecord(set.repoId, owner.userId, record);
  }
  return {
    ref: {
      ...common,
      object: chunked.hash,
      size: sample.chunks.join("").length,
    },
    listed: [chunked.hash],
    leaves: leaves.map((leaf) => leaf.hash),
  };
}

/** Stores the set's objects the way dit does and returns the ids a save rebuilds from. */
async function storeSet(set: DitSet, label: string, at = T0) {
  const built = buildObjects([arrangedSetXml]);
  const hashes = built.objects.map((object) => hex(object.id));
  stored.push(...hashes);
  await db
    .insert(objects)
    .values(
      built.objects.map((object) => ({
        hash: hex(object.id),
        kind: object.kind,
        size: object.body.byteLength,
      }))
    )
    .onConflictDoNothing();
  await db
    .insert(repoObjects)
    .values(
      hashes.map((objectHash) => ({
        repoId: set.repoId,
        objectHash,
        pushedBy: owner.userId,
      }))
    )
    .onConflictDoNothing();
  for (const object of built.objects) {
    const raw = Buffer.concat([Uint8Array.of(object.kind), object.body]);
    await storeObjects([
      {
        hash: hex(object.id),
        bytes: zstdCompressSync(raw, {
          params: { [constants.ZSTD_c_compressionLevel]: 3 },
        }),
      },
    ]);
  }
  return savePayload(label, at, {
    tree: hex(built.treeId),
    side: hex(built.sideId),
    meta: META,
  });
}

/** A set in its own repo, committed on `main` with the samples described. */
async function committed(
  label: string,
  samples: Sample[],
  repoSet?: DitSet,
  at = T0
) {
  const set = repoSet ?? (await adoptNewSet(suite, label));
  const held: Held[] = [];
  for (const sample of samples) held.push(await hold(set, sample));
  const base = await storeSet(set, label, at);
  const save = { ...base, samples: held.map((h) => h.ref) };
  const objectIds = [
    ...new Set(
      (
        await db
          .select({ hash: repoObjects.objectHash })
          .from(repoObjects)
          .where(eq(repoObjects.repoId, set.repoId))
      ).map((row) => row.hash)
    ),
  ];
  const setObjects = objectIds.filter(
    (hash) =>
      !held.some((h) => h.listed.includes(hash) || h.leaves?.includes(hash))
  );
  expect((await pushSaves(suite, set, "main", [save])).status).toBe(200);
  const commit = {
    ...commitPayload(label, null, [save], {
      sampleObjects: held.flatMap((h) => h.listed),
    }),
    saves: [{ hash: save.hash, objects: setObjects }],
  };
  expect((await pushCommits(suite, set, "main", [commit])).status).toBe(201);
  const [row] = await db
    .select({ id: commits.id, saveId: commits.saveId })
    .from(commits)
    .where(eq(commits.repoId, set.repoId));
  return { set, held, ...row! };
}

async function zipOf(res: Response) {
  expect(res.status).toBe(200);
  expect(res.headers.get("Content-Type")).toBe("application/zip");
  const bytes = new Uint8Array(await res.arrayBuffer());
  const tested = await unzipTest(bytes);
  if (tested) {
    expect(tested.output).toContain("No errors detected");
    expect(tested.ok).toBe(true);
  }
  const entries = readZip(bytes);
  expect(entries.every((entry) => entry.crcOk)).toBe(true);
  return entries;
}

const manifestOf = (entries: { name: string; data: Buffer }[]) => {
  expect(entries.at(-1)!.name).toBe("MANIFEST.txt");
  return entries.at(-1)!.data.toString();
};

describe("GET /commits/:id/archive", () => {
  it("holds the set and a manifest for a set with no samples", async () => {
    requireProject();
    const commit = await committed("Archive none", []);

    await expectAccess("GET", `/commits/${commit.id}/archive`, {
      viewer: 200,
      editor: 200,
      owner: 200,
    });
    const res = await request("viewer", `/commits/${commit.id}/archive`);
    expect(res.headers.get("Content-Disposition")).toBe(
      'attachment; filename="Archive none.zip"'
    );
    const entries = await zipOf(res);
    expect(entries.map((e) => e.name)).toEqual([
      "Archive none.als",
      "MANIFEST.txt",
    ]);
    expect(
      Buffer.from(Bun.gunzipSync(new Uint8Array(entries[0]!.data))).equals(
        Buffer.from(arrangedSetXml)
      )
    ).toBe(true);
    expect(manifestOf(entries)).toBe("");
  });

  it("holds the samples the hub has at their paths and names every reference's state", async () => {
    requireProject();
    const commit = await committed("Archive some", [
      {
        path: "Samples/Imported/kick.wav",
        kind: "project",
        content: "kick bytes",
      },
      {
        path: "Samples/Recorded/long.wav",
        kind: "project",
        chunks: ["chunk-a ", "chunk-b ", "chunk-c"],
      },
      { path: "Samples/Imported/missing.wav", kind: "project", absent: true },
      { path: "Other/not-tracked.wav", kind: "project", absent: true },
      { path: "/Users/x/Music/outside.wav", kind: "outside" },
      { path: "Library/pack/snare.wav", kind: "library" },
    ]);

    const entries = await zipOf(
      await request("viewer", `/commits/${commit.id}/archive`)
    );
    expect(entries.map((e) => e.name)).toEqual([
      "Archive some.als",
      "Samples/Imported/kick.wav",
      "Samples/Recorded/long.wav",
      "MANIFEST.txt",
    ]);
    expect(entries[1]!.data.toString()).toBe("kick bytes");
    expect(entries[2]!.data.toString()).toBe("chunk-a chunk-b chunk-c");
    expect(manifestOf(entries)).toBe(
      [
        "included\tSamples/Imported/kick.wav",
        "included\tSamples/Recorded/long.wav",
        "not pushed\tSamples/Imported/missing.wav",
        "not pushed\tOther/not-tracked.wav",
        "outside the project folder\t/Users/x/Music/outside.wav",
        "outside the project folder\tLibrary/pack/snare.wav",
      ]
        .map((line) => `${line}\n`)
        .join("")
    );
  });

  it("holds every sample when the hub holds them all", async () => {
    requireProject();
    const commit = await committed("Archive all", [
      { path: "Samples/a.wav", kind: "project", content: "aaa" },
      { path: "Samples/b.wav", kind: "project", content: "bbb" },
    ]);
    const entries = await zipOf(
      await request("owner", `/commits/${commit.id}/archive`)
    );
    expect(entries.map((e) => e.name)).toEqual([
      "Archive all.als",
      "Samples/a.wav",
      "Samples/b.wav",
      "MANIFEST.txt",
    ]);
    expect(manifestOf(entries)).toBe(
      "included\tSamples/a.wav\nincluded\tSamples/b.wav\n"
    );
  });

  it("never lets a reference's relative path name a place outside Samples/ in the archive", async () => {
    requireProject();
    const set = await adoptNewSet(suite, "Archive slip");
    const record = objectRecord("slip bytes");
    stored.push(record.hash);
    await acceptRecord(set.repoId, owner.userId, record);
    const slips = [
      "Samples/../../etc/passwd",
      "/abs/Samples/x.wav",
      "Samples//x.wav",
    ];
    const base = await storeSet(set, "archive-slip");
    const save = {
      ...base,
      samples: slips.map((relative) => ({
        path: relative,
        kind: "project",
        relative,
        object: record.hash,
        size: 10,
      })),
    };
    const objectIds = (
      await db
        .select({ hash: repoObjects.objectHash })
        .from(repoObjects)
        .where(eq(repoObjects.repoId, set.repoId))
    )
      .map((row) => row.hash)
      .filter((hash) => hash !== record.hash);
    await pushSaves(suite, set, "main", [save]);
    await pushCommits(suite, set, "main", [
      {
        ...commitPayload("archive-slip", null, [save], {
          sampleObjects: [record.hash],
        }),
        saves: [{ hash: save.hash, objects: objectIds }],
      },
    ]);
    const [row] = await db
      .select({ id: commits.id })
      .from(commits)
      .where(eq(commits.repoId, set.repoId));

    const entries = await zipOf(
      await request("owner", `/commits/${row!.id}/archive`)
    );
    expect(entries.map((e) => e.name)).toEqual([
      "Archive slip.als",
      "MANIFEST.txt",
    ]);
    expect(manifestOf(entries)).toBe(
      slips.map((path) => `not pushed\t${path}\n`).join("")
    );
  });

  it("places a held sample whose relative path writes backslashes or a leading ./ as dit reads it", async () => {
    requireProject();
    const set = await adoptNewSet(suite, "Archive separators");
    const record = objectRecord("separator bytes");
    stored.push(record.hash);
    await acceptRecord(set.repoId, owner.userId, record);
    const base = await storeSet(set, "archive-separators");
    const save = {
      ...base,
      samples: [".\\Samples\\Sub\\a.wav", "./Samples/b.wav"].map(
        (relative) => ({
          path: relative,
          kind: "project",
          relative,
          object: record.hash,
          size: 15,
        })
      ),
    };
    const objectIds = (
      await db
        .select({ hash: repoObjects.objectHash })
        .from(repoObjects)
        .where(eq(repoObjects.repoId, set.repoId))
    )
      .map((row) => row.hash)
      .filter((hash) => hash !== record.hash);
    await pushSaves(suite, set, "main", [save]);
    await pushCommits(suite, set, "main", [
      {
        ...commitPayload("archive-separators", null, [save], {
          sampleObjects: [record.hash],
        }),
        saves: [{ hash: save.hash, objects: objectIds }],
      },
    ]);
    const [row] = await db
      .select({ id: commits.id })
      .from(commits)
      .where(eq(commits.repoId, set.repoId));

    const entries = await zipOf(
      await request("owner", `/commits/${row!.id}/archive`)
    );
    expect(entries.map((e) => e.name)).toEqual([
      "Archive separators.als",
      "Samples/Sub/a.wav",
      "Samples/b.wav",
      "MANIFEST.txt",
    ]);
  });

  it("lists a sample with a missing chunk as not pushed and still delivers a valid archive", async () => {
    requireProject();
    const commit = await committed("Archive preflight", [
      { path: "Samples/whole.wav", kind: "project", content: "whole" },
      {
        path: "Samples/torn.wav",
        kind: "project",
        chunks: ["torn-one ", "torn-two ", "torn-three"],
      },
    ]);
    await rm(storedFilePath(objectKey(commit.held[1]!.leaves![1]!)));

    const entries = await zipOf(
      await request("owner", `/commits/${commit.id}/archive`)
    );
    expect(entries.map((e) => e.name)).toEqual([
      "Archive preflight.als",
      "Samples/whole.wav",
      "MANIFEST.txt",
    ]);
    expect(manifestOf(entries)).toBe(
      "included\tSamples/whole.wav\nnot pushed\tSamples/torn.wav\n"
    );
  });

  it("fails the download, rather than truncating an entry, when a chunk vanishes after its entry began", async () => {
    requireProject();
    const commit = await committed("Archive mid", [
      {
        path: "Samples/vanishes.wav",
        kind: "project",
        chunks: ["mid-one ", "mid-two ", "mid-three"],
      },
    ]);
    const second = commit.held[0]!.leaves![1]!;
    const original = sampleObjects.leavesPresent;
    // The check passes, then the file goes before the entry reads it.
    const spy = spyOn(sampleObjects, "leavesPresent").mockImplementation(
      async (leaves) => {
        const present = await original(leaves);
        await rm(storedFilePath(objectKey(second)));
        return present;
      }
    );
    try {
      const res = await request("owner", `/commits/${commit.id}/archive`);
      expect(res.status).toBe(200);
      await expect(res.arrayBuffer()).rejects.toThrow();
    } finally {
      spy.mockRestore();
    }
  });

  it("answers 404 for an unknown commit and 409 naming the state for a pruned one", async () => {
    requireProject();
    expect((await request("owner", "/commits/2147483000/archive")).status).toBe(
      404
    );
    const commit = await committed("Archive pruned", []);
    await db
      .update(saves)
      .set({ contentState: "pruned" })
      .where(eq(saves.id, commit.saveId));
    const res = await request("owner", `/commits/${commit.id}/archive`);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("pruned");
  });
});

describe("GET /repos/:id/archive", () => {
  it("holds each set at the tip of main, the samples and one manifest", async () => {
    requireProject();
    const first = await committed("Repo archive", [
      { path: "Samples/shared.wav", kind: "project", content: "shared bytes" },
      { path: "/elsewhere/x.wav", kind: "outside" },
    ]);
    const second = await adoptNewSetIn(first.set.repoId, "Repo archive two");
    await committed(
      "Repo archive two",
      [
        {
          path: "Samples/shared.wav",
          kind: "project",
          content: "shared bytes",
        },
        { path: "Samples/only-two.wav", kind: "project", content: "two" },
      ],
      second
    );

    const path = `/repos/${first.set.repoId}/archive`;
    await expectAccess("GET", path, { viewer: 200, editor: 200, owner: 200 });
    const res = await request("viewer", path);
    expect(res.headers.get("Content-Disposition")).toBe(
      'attachment; filename="Repo archive.zip"'
    );
    const entries = await zipOf(res);
    expect(entries.map((e) => e.name)).toEqual([
      "Repo archive.als",
      "Samples/shared.wav",
      "Repo archive two.als",
      "Samples/only-two.wav",
      "MANIFEST.txt",
    ]);
    expect(manifestOf(entries)).toBe(
      [
        "included\tSamples/shared.wav",
        "outside the project folder\t/elsewhere/x.wav",
        "included\tSamples/only-two.wav",
      ]
        .map((line) => `${line}\n`)
        .join("")
    );
  });

  it("writes the newest set's version of a path two sets share and says the other is an older version", async () => {
    requireProject();
    const newer = await committed(
      "Clash newer",
      [{ path: "Samples/clash.wav", kind: "project", content: "the new take" }],
      undefined,
      T0 + 60 * 60_000
    );
    const older = await adoptNewSetIn(newer.set.repoId, "Clash older");
    await committed(
      "Clash older",
      [{ path: "Samples/clash.wav", kind: "project", content: "the old take" }],
      older,
      T0
    );

    const entries = await zipOf(
      await request("owner", `/repos/${newer.set.repoId}/archive`)
    );
    const names = entries.map((e) => e.name);
    expect(names.filter((n) => n === "Samples/clash.wav")).toHaveLength(1);
    expect(
      entries.find((e) => e.name === "Samples/clash.wav")!.data.toString()
    ).toBe("the new take");
    expect(manifestOf(entries)).toBe(
      "included\tSamples/clash.wav\nolder version, not included\tSamples/clash.wav\n"
    );
  });

  it("answers 409 for a repo with no commit on main and 404 outside the project", async () => {
    requireProject();
    const set = await adoptNewSet(suite, "Repo archive empty");
    const res = await request("owner", `/repos/${set.repoId}/archive`);
    expect(res.status).toBe(409);
    expect((await request("owner", "/repos/2147483000/archive")).status).toBe(
      404
    );
    expect(
      (await request("outsider", `/repos/${set.repoId}/archive`)).status
    ).toBe(404);
  });
});

/** A second set in a repo that already has one. */
async function adoptNewSetIn(repoId: number, label: string): Promise<DitSet> {
  const adopted = await suite.request("owner", `/repos/${repoId}/sets`, {
    method: "POST",
    body: JSON.stringify({
      ditSetId: `set-${label}`,
      fileName: `${label}.als`,
    }),
  });
  const { ditSetId, sessionId } = await adopted.json();
  return { repoId, ditSetId, sessionId };
}

describe("the repo-archive bucket", () => {
  it("meters archive downloads per caller, as the editor, whose tokens no other case spends", async () => {
    requireProject();
    const commit = await committed("Archive metered", []);
    stubInstancePolicy({
      rateLimits: { "repo-archive": { burst: 1, perMinute: 1 } },
    });
    const first = await request("editor", `/commits/${commit.id}/archive`);
    expect(first.status).toBe(200);
    await first.arrayBuffer();
    const second = await request("editor", `/commits/${commit.id}/archive`);
    expect(second.status).toBe(429);
  });
});
