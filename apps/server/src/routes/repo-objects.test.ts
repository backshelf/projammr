import { randomBytes, randomUUID } from "node:crypto";
import { constants } from "node:zlib";
import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { createOrGetRepo } from "../db/queries/repos.js";
import {
  projectScope,
  recomputeUsage,
  usageFor,
  userScope,
} from "../db/queries/storage-usage.js";
import { objects, repoObjects } from "../db/schema/objects.js";
import { REQUEST_BODY_CAP_BYTES } from "../lib/instance-policy.js";
import { type PackRecord, packRecordHeader } from "../lib/object-pack.js";
import { objectKey, storedFileExists } from "../lib/storage.js";
import { readZstdFrame } from "../lib/zstd-frame.js";
import { hashOf } from "../test/dit-history.js";
import {
  acceptRecord,
  concatBytes,
  objectRecord,
  packOf,
  recordBytes,
  removeObjects,
} from "../test/dit-objects.js";
import { type Caller, setupSuite } from "../test/fixtures.js";
import {
  restoreInstancePolicy,
  stubInstancePolicy,
} from "../test/instance-policy.js";

const suite = setupSuite("Repo objects");
const { owner } = suite;

const MIB = 1024 * 1024;

/** Every object a case may have stored, removed once the file is done. */
const made: string[] = [];

const newObject = (label: string, kind = 1) => {
  const record = objectRecord(`${label} ${randomUUID()}`, kind);
  made.push(record.hash);
  return record;
};

async function newRepo() {
  suite.requireProject();
  const { repo } = await createOrGetRepo(
    suite.projectId,
    `objects ${randomUUID()}`,
    owner.userId
  );
  return repo.id;
}

/**
 * Pushes `body` as dit does, declaring its length. A server hands the app the
 * header on its own; a request built in process carries none unless a case
 * sets it, so a byte body gets its own length here.
 */
const push = (
  repoId: number,
  body: BodyInit,
  caller: Exclude<Caller, "anonymous"> = "owner",
  headers: Record<string, string> = {}
) =>
  suite.request(caller, `/repos/${repoId}/objects`, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      ...(typeof body === "string" || body instanceof Uint8Array
        ? { "Content-Length": String(Buffer.byteLength(body)) }
        : {}),
      ...headers,
    },
    body,
  });

/**
 * A body of `chunks` that counts the reads made of it. It queues nothing
 * ahead (a high-water mark of 0), so only a reader's own request pulls.
 */
function countedStream(...chunks: Uint8Array[]) {
  const counts = { pulled: 0 };
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        const chunk = chunks[counts.pulled];
        counts.pulled += 1;
        if (chunk) controller.enqueue(chunk);
        else controller.close();
      },
    },
    { highWaterMark: 0 }
  );
  return { stream, counts };
}

const askMissing = (repoId: number, hashes: string[]) =>
  suite.request("owner", `/repos/${repoId}/objects/missing`, {
    method: "POST",
    body: JSON.stringify({ hashes }),
  });

/** The hashes of `records` the repo holds, in the records' order. */
async function held(repoId: number, records: PackRecord[]) {
  const rows = await db
    .select({ hash: repoObjects.objectHash })
    .from(repoObjects)
    .where(
      and(
        eq(repoObjects.repoId, repoId),
        inArray(
          repoObjects.objectHash,
          records.map((record) => record.hash)
        )
      )
    );
  const hashes = new Set(rows.map((row) => row.hash));
  return records
    .map((record) => record.hash)
    .filter((hash) => hashes.has(hash));
}

const projectUsage = () => usageFor(projectScope(suite.projectId));

const gigabytes = (bytes: number) => bytes / 1024 ** 3;

afterEach(() => {
  restoreInstancePolicy();
});

afterAll(async () => {
  await removeObjects(made);
  await recomputeUsage([
    userScope(owner.userId),
    userScope(suite.editor.userId),
  ]);
});

describe("POST /repos/:id/objects/missing", () => {
  it("lets an editor ask and refuses a viewer", async () => {
    const repoId = await newRepo();
    await suite.expectAccess(
      "POST",
      `/repos/${repoId}/objects/missing`,
      { viewer: 403, editor: 200 },
      { hashes: [hashOf("anything")] }
    );
  });

  it("answers the hashes the repo lacks, in the order asked and without repeats", async () => {
    const repoId = await newRepo();
    const stored = newObject("stored");
    expect((await push(repoId, packOf(stored))).status).toBe(200);
    const [first, second] = [hashOf(randomUUID()), hashOf(randomUUID())];

    const res = await askMissing(repoId, [second, stored.hash, first, second]);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ missing: [second, first], claimed: [] });
  });

  it("claims an object another repo of the caller's projects holds, answering it in `claimed`", async () => {
    const [holder, asker] = [await newRepo(), await newRepo()];
    const object = newObject("elsewhere");
    await push(holder, packOf(object));

    expect(await (await askMissing(asker, [object.hash])).json()).toEqual({
      missing: [],
      claimed: [object.hash],
    });
    expect(await held(asker, [object])).toEqual([object.hash]);
  });

  it("keeps an object only a project the caller is not in holds missing", async () => {
    const stranger = await suite.throwawayProject("Missing stranger");
    const { repo } = await createOrGetRepo(
      stranger.id,
      `objects ${randomUUID()}`,
      stranger.owner.userId
    );
    const object = newObject("foreign");
    await acceptRecord(repo.id, stranger.owner.userId, object);
    const asker = await newRepo();

    expect(await (await askMissing(asker, [object.hash])).json()).toEqual({
      missing: [object.hash],
      claimed: [],
    });
    expect(await held(asker, [object])).toEqual([]);
  });

  it("refuses a malformed hash, an empty list and more than 10,000 hashes", async () => {
    const repoId = await newRepo();
    const many = Array.from({ length: 10_001 }, (_, i) => hashOf(`${i}`));

    for (const hashes of [[hashOf("x").toUpperCase()], [], many]) {
      expect((await askMissing(repoId, hashes)).status).toBe(400);
    }
    expect((await askMissing(repoId, many.slice(1))).status).toBe(200);
  });

  it("is held to the fixed body cap, not the upload limit", async () => {
    const repoId = await newRepo();
    stubInstancePolicy({ limits: { maxUploadMb: 256 } });

    const res = await suite.request(
      "owner",
      `/repos/${repoId}/objects/missing`,
      {
        method: "POST",
        headers: { "content-length": String(REQUEST_BODY_CAP_BYTES + 1) },
        body: "{}",
      }
    );

    expect(res.status).toBe(413);
  });
});

describe("POST /repos/:id/objects", () => {
  it("lets an editor push and refuses a viewer", async () => {
    const repoId = await newRepo();
    await suite.expectAccess("POST", `/repos/${repoId}/objects`, {
      viewer: 403,
      editor: 200,
    });
  });

  it("stores a valid pack, counts it and adds its bytes to the project", async () => {
    const repoId = await newRepo();
    const records = [newObject("a", 1), newObject("b", 5)];
    const before = await projectUsage();

    const res = await push(repoId, packOf(...records));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ stored: 2, known: 0 });
    expect(await held(repoId, records)).toEqual(records.map((r) => r.hash));
    for (const record of records) {
      expect(await storedFileExists(objectKey(record.hash))).toBe(true);
    }
    expect(await projectUsage()).toBe(
      before + records[0]!.frame.length + records[1]!.frame.length
    );
    expect(await (await askMissing(repoId, made.slice(-2))).json()).toEqual({
      missing: [],
      claimed: [],
    });
  });

  it("stores nothing new for a replayed pack", async () => {
    const repoId = await newRepo();
    const pack = packOf(newObject("replay a"), newObject("replay b"));
    await push(repoId, pack);
    const before = await projectUsage();

    const res = await push(repoId, pack);

    expect(await res.json()).toEqual({ stored: 0, known: 2 });
    expect(await projectUsage()).toBe(before);
  });

  it("links an object into a second repo of the project without a new file or more usage", async () => {
    const [first, second] = [await newRepo(), await newRepo()];
    const object = newObject("second repo");
    await push(first, packOf(object));
    const before = await projectUsage();

    const res = await push(second, packOf(object), "editor");

    expect(await res.json()).toEqual({ stored: 0, known: 1 });
    expect(await held(second, [object])).toEqual([object.hash]);
    expect(
      await db.select().from(objects).where(eq(objects.hash, object.hash))
    ).toHaveLength(1);
    expect(await projectUsage()).toBe(before);
  });

  it("takes an empty pack as nothing to store", async () => {
    const res = await push(await newRepo(), new Uint8Array());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ stored: 0, known: 0 });
  });

  describe("refuses a bad record and keeps the records before it", () => {
    const refused = async (bad: Uint8Array, status = 400) => {
      const repoId = await newRepo();
      const good = newObject("before the bad one");

      const res = await push(repoId, concatBytes(packOf(good), bad));

      expect(res.status).toBe(status);
      expect(await held(repoId, [good])).toEqual([good.hash]);
      return (await res.json()) as { error: string; code?: string };
    };

    it("whose id is not the hash of its content", async () => {
      const object = newObject("mislabelled");
      const body = await refused(
        recordBytes({ ...object, hash: hashOf(randomUUID()) })
      );
      expect(body.error).toContain("does not match its content");
      expect(await storedFileExists(objectKey(object.hash))).toBe(false);
    });

    it("of an unknown kind", async () => {
      const body = await refused(recordBytes(newObject("kindless", 6)));
      expect(body.error).toContain("unknown kind");
    });

    it("whose frame starts with another kind than its header's", async () => {
      const object = objectRecord(`two kinds ${randomUUID()}`, 1, 2);
      made.push(object.hash);
      const body = await refused(recordBytes(object));
      expect(body.error).toContain("does not start with its kind byte 1");
      expect(await storedFileExists(objectKey(object.hash))).toBe(false);
    });

    it("whose frame is not zstd", async () => {
      const object = newObject("raw");
      const body = await refused(
        recordBytes({ ...object, frame: new Uint8Array([1, 2, 3, 4]) })
      );
      expect(body.error).toContain("zstd");
    });

    describe("whose frame is not exactly one zstd frame:", () => {
      const notOneFrame = async (
        label: string,
        shape: (frame: Uint8Array) => Uint8Array
      ) => {
        const object = newObject(label);
        const body = await refused(
          recordBytes({ ...object, frame: shape(object.frame) })
        );
        expect(body.error).toBe(`Object ${object.hash} is not one zstd frame`);
        expect(await storedFileExists(objectKey(object.hash))).toBe(false);
      };

      it("bytes after it", () =>
        notOneFrame("trailing bytes", (frame) =>
          concatBytes(frame, new Uint8Array(3))
        ));

      it("a second frame after it", () =>
        notOneFrame("two frames", (frame) => concatBytes(frame, frame)));

      it("a skippable frame after it", () =>
        notOneFrame("skippable", (frame) =>
          concatBytes(frame, Uint8Array.of(0x50, 0x2a, 0x4d, 0x18, 0, 0, 0, 0))
        ));

      it("a frame cut short", () =>
        notOneFrame("cut frame", (frame) => frame.subarray(0, -3)));

      it("a frame whose header declares another content size", () =>
        notOneFrame("lying size", (frame) => {
          // Single segment, a 1-byte content size right after the descriptor.
          const lying = Uint8Array.from(frame);
          lying[5] = lying[5]! + 1;
          return lying;
        }));
    });

    it("cut off inside its header", async () => {
      const body = await refused(
        recordBytes(newObject("cut header")).subarray(0, 20)
      );
      expect(body.error).toContain("truncated");
    });

    it("cut off inside its frame", async () => {
      const whole = recordBytes(newObject("cut frame"));
      const body = await refused(whole.subarray(0, whole.length - 1));
      expect(body.error).toContain("truncated");
    });

    it("whose header declares a frame over 64 MiB", async () => {
      const object = newObject("declared too big");
      await refused(recordBytes(object, 64 * MIB + 1).subarray(0, 37), 413);
    });

    it("whose frame decompresses past 64 MiB", async () => {
      const bomb = objectRecord(new Uint8Array(64 * MIB + 1));
      await refused(recordBytes(bomb), 413);
    });

    it("whose frame declares no size and decompresses past 64 MiB", async () => {
      const bomb = objectRecord(new Uint8Array(64 * MIB + 1), 1, 1, {
        [constants.ZSTD_c_contentSizeFlag]: 0,
      });
      expect(readZstdFrame(bomb.frame)?.contentSize).toBeNull();
      await refused(recordBytes(bomb), 413);
    });

    it("that would pass the project's storage cap", async () => {
      const repoId = await newRepo();
      const [fits, overflows] = [newObject("fits"), newObject("overflows")];
      const used = await projectUsage();
      stubInstancePolicy({
        limits: {
          projectCapGb: gigabytes(used + fits.frame.length),
        },
      });

      const res = await push(repoId, packOf(fits, overflows));

      expect(res.status).toBe(413);
      expect(await res.json()).toMatchObject({ code: "storage_limit" });
      expect(await held(repoId, [fits, overflows])).toEqual([fits.hash]);
      expect(await storedFileExists(objectKey(overflows.hash))).toBe(false);
    });
  });

  it("is held to the instance's upload limit rather than the fixed cap", async () => {
    const repoId = await newRepo();
    stubInstancePolicy({ limits: { maxUploadMb: 256 } });

    // The body declares more than the fixed cap and carries one byte: only the
    // pack reader, finding a record cut short, can have refused it. The header
    // keeps the helper's casing, so it replaces the helper's own length.
    const res = await push(repoId, "x", "owner", {
      "Content-Length": String(REQUEST_BODY_CAP_BYTES + 1),
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("truncated");
  });

  describe("declares its length up front", () => {
    it("answers 411 to a pack with no Content-Length, reading nothing", async () => {
      const repoId = await newRepo();
      const object = newObject("chunked");
      const { stream, counts } = countedStream(recordBytes(object));

      const res = await push(repoId, stream);

      expect(res.status).toBe(411);
      expect(await res.json()).toMatchObject({
        error: "A pack needs a Content-Length",
        code: "length_required",
      });
      expect(counts.pulled).toBe(0);
      expect(await held(repoId, [object])).toEqual([]);
    });

    it("answers a caller outside the project 404 before reading a byte", async () => {
      const repoId = await newRepo();
      const { stream, counts } = countedStream(
        recordBytes(newObject("outsider"))
      );

      const res = await push(repoId, stream, "outsider");

      expect(res.status).toBe(404);
      expect(counts.pulled).toBe(0);
    });
  });

  describe("held to the instance's upload limit", () => {
    // Noise zstd cannot shrink, so a record is about as long as its content.
    const heavyObject = (label: string, bytes: number) => {
      const record = objectRecord(
        Buffer.concat([
          Buffer.from(`${label} ${randomUUID()}`),
          randomBytes(bytes),
        ])
      );
      made.push(record.hash);
      return record;
    };

    it("answers 413 pack_too_large to a pack past it, storing nothing", async () => {
      const repoId = await newRepo();
      stubInstancePolicy({ limits: { maxUploadMb: 1 } });
      // Each record is valid; together they are past 1 MB.
      const [first, second] = [
        heavyObject("first", MIB / 2 + 100),
        heavyObject("second", MIB / 2 + 100),
      ];

      const res = await push(repoId, packOf(first, second));

      expect(res.status).toBe(413);
      expect(await res.json()).toMatchObject({
        error: "This pack is larger than this instance's upload limit (1 MB)",
        code: "pack_too_large",
      });
      expect(await held(repoId, [first, second])).toEqual([]);
      expect(await storedFileExists(objectKey(first.hash))).toBe(false);
    });

    it("takes a pack within it", async () => {
      const repoId = await newRepo();
      stubInstancePolicy({ limits: { maxUploadMb: 1 } });
      const record = heavyObject("fits", MIB / 2);

      const res = await push(repoId, packOf(record));

      expect(res.status).toBe(200);
      expect(await held(repoId, [record])).toEqual([record.hash]);
    });
  });
});

describe("POST /repos/:id/objects/fetch", () => {
  const fetchObjects = (repoId: number, hashes: string[]) =>
    suite.request("owner", `/repos/${repoId}/objects/fetch`, {
      method: "POST",
      body: JSON.stringify({ hashes }),
    });

  it("lets a viewer read and refuses a stranger", async () => {
    const repoId = await newRepo();
    const record = newObject("fetch access");
    await push(repoId, packOf(record));
    await suite.expectAccess(
      "POST",
      `/repos/${repoId}/objects/fetch`,
      { viewer: 200, editor: 200 },
      { hashes: [record.hash] }
    );
  });

  it("sends the records in request order when the repo holds them all", async () => {
    const repoId = await newRepo();
    const a = newObject("fetch a");
    const b = newObject("fetch b", 5);
    await push(repoId, packOf(a, b));

    const res = await fetchObjects(repoId, [b.hash, a.hash]);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(res.headers.has("X-Dit-Missing")).toBe(false);
    expect(
      Buffer.from(await res.arrayBuffer()).equals(
        Buffer.from(concatBytes(recordBytes(b), recordBytes(a)))
      )
    ).toBe(true);
  });

  it("answers 409 objects_missing naming every missing hash, and streams nothing", async () => {
    const repoId = await newRepo();
    const a = newObject("fetch held");
    await push(repoId, packOf(a));
    const goneFirst = hashOf("never pushed one");
    const goneLast = hashOf("never pushed two");

    const res = await fetchObjects(repoId, [
      goneFirst,
      a.hash,
      goneLast,
      goneFirst,
    ]);

    expect(res.status).toBe(409);
    expect(res.headers.has("X-Dit-Missing")).toBe(false);
    expect(await res.json()).toMatchObject({
      code: "objects_missing",
      details: { hashes: [goneFirst, goneLast] },
    });
  });

  it("sends a record once however often it is asked for", async () => {
    const repoId = await newRepo();
    const a = newObject("fetch repeated");
    await push(repoId, packOf(a));

    const res = await fetchObjects(repoId, [a.hash, a.hash]);

    expect(res.status).toBe(200);
    expect(res.headers.has("X-Dit-Missing")).toBe(false);
    expect(
      Buffer.from(await res.arrayBuffer()).equals(Buffer.from(recordBytes(a)))
    ).toBe(true);
  });

  it("writes the same record header a pack carries", () => {
    const record = newObject("fetch layout", 4);
    const header = packRecordHeader(
      record.hash,
      record.kind,
      record.frame.length
    );
    expect(
      Buffer.from(header).equals(
        Buffer.from(recordBytes(record).subarray(0, 37))
      )
    ).toBe(true);
  });

  it("refuses an empty ask and one over 10,000 hashes", async () => {
    const repoId = await newRepo();
    expect((await fetchObjects(repoId, [])).status).toBe(400);
    const over = Array.from({ length: 10_001 }, (_, i) => hashOf(`over ${i}`));
    expect((await fetchObjects(repoId, over)).status).toBe(400);
  });

  it("names 10,000 missing hashes in the 409's details", async () => {
    const repoId = await newRepo();
    const hashes = Array.from({ length: 10_000 }, (_, i) =>
      hashOf(`absent ${i}`)
    );

    const res = await fetchObjects(repoId, hashes);

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      code: "objects_missing",
      details: { hashes },
    });
  });
});
