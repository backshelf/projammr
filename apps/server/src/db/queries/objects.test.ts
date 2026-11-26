import { randomUUID } from "node:crypto";
import { chmod, mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { constants, zstdCompressSync, zstdDecompressSync } from "node:zlib";
import { afterAll, afterEach, describe, expect, it, spyOn } from "bun:test";
import { and, eq, inArray, sql } from "drizzle-orm";
import pg from "pg";
import type { PackRecord } from "../../lib/object-pack.js";
import {
  listStoredKeys,
  objectKey,
  removeStoredFile,
  storedFileExists,
  storedFilePath,
  storeObjects,
} from "../../lib/storage.js";
import { hashOf } from "../../test/dit-history.js";
import {
  acceptRecord,
  objectRecord,
  removeObjects,
} from "../../test/dit-objects.js";
import { setupSuite } from "../../test/fixtures.js";
import { holdTransaction } from "../../test/held-transaction.js";
import {
  restoreInstancePolicy,
  stubInstancePolicy,
} from "../../test/instance-policy.js";
import { db } from "../index.js";
import { objects, repoObjects } from "../schema/objects.js";
import {
  acceptObjects,
  acceptStatements,
  lockObjects,
  missingObjects,
  removeUnnamedObjectFiles,
} from "./objects.js";
import { createOrGetRepo } from "./repos.js";
import { sweepStatements } from "./save-retention.js";
import {
  projectScope,
  recomputeUsage,
  usageFor,
  userScope,
} from "./storage-usage.js";

const suite = setupSuite("Objects");
const { owner, editor } = suite;

/** Every object a case created, removed once the file is done. */
const made: string[] = [];
const pushers: string[] = [];

const newObject = (label: string) => {
  const record = objectRecord(`${label} ${randomUUID()}`);
  made.push(record.hash);
  return record;
};

async function newRepo(projectId = suite.projectId, userId = owner.userId) {
  suite.requireProject();
  pushers.push(userId);
  const { repo } = await createOrGetRepo(
    projectId,
    `objects ${randomUUID()}`,
    userId
  );
  return repo.id;
}

const linkOf = (repoId: number, hash: string) =>
  db
    .select()
    .from(repoObjects)
    .where(
      and(eq(repoObjects.repoId, repoId), eq(repoObjects.objectHash, hash))
    );

const gigabytes = (bytes: number) => bytes / 1024 ** 3;

/**
 * The same object in a frame four bytes longer: zstd's content checksum is on,
 * as another client or zstd build might write it.
 */
const reframed = (record: PackRecord): PackRecord => ({
  ...record,
  frame: zstdCompressSync(zstdDecompressSync(record.frame), {
    params: { [constants.ZSTD_c_checksumFlag]: 1 },
  }),
});

const fileOf = async (hash: string) =>
  new Uint8Array(await Bun.file(storedFilePath(objectKey(hash))).bytes());

const rowOf = (hash: string) =>
  db.select().from(objects).where(eq(objects.hash, hash));

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

/** The statement text of one spied `Client.prototype.query` call. */
const sqlTextOf = ([first]: unknown[]): string =>
  typeof first === "string"
    ? first
    : String((first as { text?: unknown } | undefined)?.text ?? "");

/** Room for a held transaction and the waits queued behind it, under load. */
const RACE_TIMEOUT = 20_000;

afterEach(() => {
  restoreInstancePolicy();
});

afterAll(async () => {
  await removeObjects(made);
  await recomputeUsage([...new Set(pushers)].map(userScope));
});

describe("missingObjects", () => {
  it("answers the hashes the repo lacks, in the order asked and without repeats", async () => {
    const repoId = await newRepo();
    const held = newObject("held");
    await acceptRecord(repoId, owner.userId, held);
    const [first, second] = [newObject("first"), newObject("second")];

    expect(
      await missingObjects(
        repoId,
        [second.hash, held.hash, first.hash, second.hash],
        owner.userId
      )
    ).toEqual({ missing: [second.hash, first.hash], claimed: [] });
  });

  it("claims an object another repo of a project the caller is a member of holds: linked, no file, nothing charged", async () => {
    const [holder, asker] = [await newRepo(), await newRepo()];
    const object = newObject("elsewhere");
    await acceptRecord(holder, owner.userId, object);
    const project = projectScope(suite.projectId);
    const before = await usageFor(project);

    expect(await missingObjects(asker, [object.hash], owner.userId)).toEqual({
      missing: [],
      claimed: [object.hash],
    });

    expect(await linkOf(asker, object.hash)).toMatchObject([
      { pushedBy: owner.userId },
    ]);
    expect(await usageFor(project)).toBe(before);
    expect(await missingObjects(asker, [object.hash], owner.userId)).toEqual({
      missing: [],
      claimed: [],
    });
  });

  it("claims through a membership of any rank, a viewer's included", async () => {
    const other = await suite.throwawayProject("Claim viewer");
    const theirs = await newRepo(other.id, other.owner.userId);
    const mine = await newRepo();
    const before = await usageFor(projectScope(suite.projectId));
    const object = newObject("viewer-claim");
    await acceptRecord(theirs, other.owner.userId, object);
    // The suite's owner joins the other project as its viewer.
    await db.execute(
      sql`insert into members (user_id, project_id, role)
          values (${owner.userId}, ${other.id}, 'viewer')`
    );

    expect(await missingObjects(mine, [object.hash], owner.userId)).toEqual({
      missing: [],
      claimed: [object.hash],
    });
    expect(await usageFor(projectScope(suite.projectId))).toBe(before);
  });

  it("claims into a project over its cap, since a claim never charges", async () => {
    const other = await suite.throwawayProject("Claim capped");
    const theirs = await newRepo(other.id, other.owner.userId);
    const mine = await newRepo();
    const object = newObject("claim-capped");
    await acceptRecord(theirs, other.owner.userId, object);
    await db.execute(
      sql`insert into members (user_id, project_id, role)
          values (${owner.userId}, ${other.id}, 'viewer')`
    );
    const used = await usageFor(projectScope(suite.projectId));
    stubInstancePolicy({
      limits: { projectCapGb: gigabytes(Math.max(0, used - 1)) },
    });

    expect(await missingObjects(mine, [object.hash], owner.userId)).toEqual({
      missing: [],
      claimed: [object.hash],
    });
    expect(await usageFor(projectScope(suite.projectId))).toBe(used);
  });

  it("leaves an object only a project the caller is not in holds missing, and links nothing", async () => {
    const other = await suite.throwawayProject("Claim stranger");
    const theirs = await newRepo(other.id, other.owner.userId);
    const mine = await newRepo();
    const object = newObject("stranger");
    await acceptRecord(theirs, other.owner.userId, object);

    expect(await missingObjects(mine, [object.hash], owner.userId)).toEqual({
      missing: [object.hash],
      claimed: [],
    });
    expect(await linkOf(mine, object.hash)).toEqual([]);
  });

  it(
    "leaves a hash missing when its holder is unlinked and the object reaped between the claim's first read and its locks",
    async () => {
      const [holder, asker] = [await newRepo(), await newRepo()];
      const object = newObject("claim-reap");
      await acceptRecord(holder, owner.userId, object);
      const reaping = await holdTransaction(async (tx) => {
        await tx.execute(
          sql`select 1 from objects where hash = ${object.hash} for update`
        );
      });

      try {
        const claiming = missingObjects(asker, [object.hash], owner.userId);
        await reaping.blocking();
        await reaping.commit(async (tx) => {
          await tx
            .delete(repoObjects)
            .where(eq(repoObjects.objectHash, object.hash));
          await tx.delete(objects).where(eq(objects.hash, object.hash));
        });
        expect(await claiming).toEqual({
          missing: [object.hash],
          claimed: [],
        });
      } finally {
        await reaping.commit();
      }

      expect(await linkOf(asker, object.hash)).toEqual([]);
    },
    RACE_TIMEOUT
  );
});

describe("acceptObjects with one record", () => {
  it("stores a new object: its frame on disk, its row sized by the frame, its link and its bytes", async () => {
    const repoId = await newRepo();
    const object = newObject("new");
    const project = projectScope(suite.projectId);
    const pusher = userScope(owner.userId);
    const [projectBefore, pusherBefore] = [
      await usageFor(project),
      await usageFor(pusher),
    ];

    expect(await acceptRecord(repoId, owner.userId, object)).toBe("stored");

    expect(
      await Bun.file(storedFilePath(objectKey(object.hash))).bytes()
    ).toEqual(new Uint8Array(object.frame));
    expect(
      await db.select().from(objects).where(eq(objects.hash, object.hash))
    ).toEqual([{ hash: object.hash, kind: 1, size: object.frame.length }]);
    expect(await linkOf(repoId, object.hash)).toMatchObject([
      { pushedBy: owner.userId },
    ]);
    expect(await usageFor(project)).toBe(projectBefore + object.frame.length);
    expect(await usageFor(pusher)).toBe(pusherBefore + object.frame.length);
  });

  it("changes nothing for an object the repo already holds", async () => {
    const repoId = await newRepo();
    const object = newObject("replayed");
    await acceptRecord(repoId, owner.userId, object);
    const usage = await usageFor(projectScope(suite.projectId));

    expect(await acceptRecord(repoId, editor.userId, object)).toBe("known");

    expect(await linkOf(repoId, object.hash)).toMatchObject([
      { pushedBy: owner.userId },
    ]);
    expect(await usageFor(projectScope(suite.projectId))).toBe(usage);
  });

  it("links an object another repo of the project holds without adding to the project or the pusher", async () => {
    const [first, second] = [await newRepo(), await newRepo()];
    const object = newObject("sibling");
    await acceptRecord(first, owner.userId, object);
    const project = projectScope(suite.projectId);
    const pusher = userScope(owner.userId);
    const [projectBefore, pusherBefore] = [
      await usageFor(project),
      await usageFor(pusher),
    ];

    expect(await acceptRecord(second, owner.userId, object)).toBe("known");

    expect(await linkOf(second, object.hash)).toHaveLength(1);
    expect(await usageFor(project)).toBe(projectBefore);
    expect(await usageFor(pusher)).toBe(pusherBefore);
  });

  it("charges a linked object to nobody when another project pushed it first", async () => {
    const mine = await newRepo();
    const object = newObject("shared");
    await acceptRecord(mine, owner.userId, object);
    const other = await suite.throwawayProject("Objects elsewhere");
    const theirs = await newRepo(other.id, other.owner.userId);

    expect(await acceptRecord(theirs, other.owner.userId, object)).toBe(
      "known"
    );

    expect(await linkOf(theirs, object.hash)).toHaveLength(1);
    expect(await usageFor(projectScope(other.id))).toBe(0);
    expect(await usageFor(userScope(other.owner.userId))).toBe(0);
  });

  it("refuses a new object over the project's cap before its file is written", async () => {
    const repoId = await newRepo();
    const object = newObject("capped");
    const used = await usageFor(projectScope(suite.projectId));
    stubInstancePolicy({
      limits: { projectCapGb: gigabytes(used + object.frame.length - 1) },
    });

    await expect(
      acceptRecord(repoId, owner.userId, object)
    ).rejects.toMatchObject({ status: 413, code: "storage_limit" });

    expect(await storedFileExists(objectKey(object.hash))).toBe(false);
    expect(
      await db.select().from(objects).where(eq(objects.hash, object.hash))
    ).toEqual([]);
    expect(await usageFor(projectScope(suite.projectId))).toBe(used);
  });

  it("links a known object into a project at its cap, since a later link is never charged", async () => {
    const other = await suite.throwawayProject("Objects capped");
    const theirs = await newRepo(other.id, other.owner.userId);
    const object = newObject("link-capped");
    await acceptRecord(await newRepo(), owner.userId, object);
    stubInstancePolicy({ limits: { projectCapGb: gigabytes(1) } });

    expect(await acceptRecord(theirs, other.owner.userId, object)).toBe(
      "known"
    );

    expect(await linkOf(theirs, object.hash)).toHaveLength(1);
    expect(await usageFor(projectScope(other.id))).toBe(0);
  });

  it("replaces a file a push that never committed left under the key", async () => {
    const repoId = await newRepo();
    const object = newObject("left-behind");
    await storeObjects([
      { hash: object.hash, bytes: object.frame.subarray(0, 5) },
    ]);

    expect(await acceptRecord(repoId, owner.userId, object)).toBe("stored");

    expect(await fileOf(object.hash)).toEqual(new Uint8Array(object.frame));
    expect(await rowOf(object.hash)).toMatchObject([
      { size: object.frame.length },
    ]);
  });
});

describe("acceptObjects over many records", () => {
  const newObjects = (label: string, count: number) =>
    Array.from({ length: count }, (_, n) => newObject(`${label} ${n}`));

  const rowsOf = (records: PackRecord[]) =>
    db
      .select({ hash: objects.hash })
      .from(objects)
      .where(
        inArray(
          objects.hash,
          records.map((record) => record.hash)
        )
      );

  /** The hashes of `records` whose file is under its key, in order. */
  const filed = async (records: PackRecord[]) => {
    const exists = await Promise.all(
      records.map((record) => storedFileExists(objectKey(record.hash)))
    );
    return records
      .filter((_, index) => exists[index])
      .map((record) => record.hash);
  };

  /** The temporary siblings left beside the records' keys. */
  const temporariesOf = async (records: PackRecord[]) => {
    const keys = records.map((record) => `${objectKey(record.hash)}.tmp-`);
    return (await listStoredKeys()).filter((listed) =>
      keys.some((key) => listed.startsWith(key))
    );
  };

  /**
   * Fails the next `commit` statement the process sends, recording which of
   * `records` had their whole file under its key when it was sent.
   */
  function failNextCommit(records: PackRecord[]) {
    const atCommit: { filed: string[] | null } = { filed: null };
    const query = pg.Client.prototype.query;
    const querySpy = spyOn(pg.Client.prototype, "query").mockImplementation(
      function (this: pg.Client, ...args: unknown[]) {
        if (atCommit.filed === null && /^\s*commit/i.test(sqlTextOf(args))) {
          return filed(records).then((hashes) => {
            atCommit.filed = hashes;
            throw new Error("crashed before the commit");
          });
        }
        return (query as (...args: unknown[]) => unknown).apply(this, args);
      } as typeof query
    );
    return { atCommit, restore: () => querySpy.mockRestore() };
  }

  it(
    "takes a pack over several transactions' worth of records, counting each object once",
    async () => {
      const repoId = await newRepo();
      const records = newObjects("many", 250);
      const project = projectScope(suite.projectId);
      const before = await usageFor(project);
      const querySpy = spyOn(pg.Client.prototype, "query");
      querySpy.mockClear();

      try {
        expect(
          await acceptObjects(repoId, owner.userId, [...records, records[0]!])
        ).toEqual({ stored: 250, known: 1 });

        const begins = querySpy.mock.calls.filter((call) =>
          /^\s*begin/i.test(sqlTextOf(call))
        );
        expect(begins.length).toBeLessThanOrEqual(5);
      } finally {
        querySpy.mockRestore();
      }

      expect(await rowsOf(records)).toHaveLength(250);
      expect(await filed(records)).toHaveLength(250);
      expect(await usageFor(project)).toBe(
        before + records.reduce((sum, record) => sum + record.frame.length, 0)
      );
    },
    RACE_TIMEOUT
  );

  it("takes a record repeated within one group once, writing nothing for the repeat: one row, one file and its bytes counted once", async () => {
    const repoId = await newRepo();
    const [first, second] = newObjects("repeated in group", 2);
    const project = projectScope(suite.projectId);
    const before = await usageFor(project);
    const querySpy = spyOn(pg.Client.prototype, "query");
    querySpy.mockClear();

    try {
      expect(
        await acceptObjects(repoId, owner.userId, [first!, second!, first!])
      ).toEqual({ stored: 2, known: 1 });

      const inserts = querySpy.mock.calls.filter((call) =>
        /^\s*insert into "objects"/i.test(sqlTextOf(call))
      );
      expect(inserts).toHaveLength(2);
    } finally {
      querySpy.mockRestore();
    }

    expect(await rowsOf([first!, second!])).toHaveLength(2);
    expect(await filed([first!, second!])).toEqual([first!.hash, second!.hash]);
    expect(await temporariesOf([first!, second!])).toEqual([]);
    expect(await fileOf(first!.hash)).toEqual(new Uint8Array(first!.frame));
    expect(await held(repoId, [first!, second!])).toEqual([
      first!.hash,
      second!.hash,
    ]);
    expect(await usageFor(project)).toBe(
      before + first!.frame.length + second!.frame.length
    );
  });

  it("keeps the records before a cap refusal in the same group, with their bytes, and writes nothing from the refused one on", async () => {
    const repoId = await newRepo();
    const [first, second, refused, after] = newObjects("capped group", 4);
    const project = projectScope(suite.projectId);
    const used = await usageFor(project);
    const fits = first!.frame.length + second!.frame.length;
    stubInstancePolicy({
      limits: { projectCapGb: gigabytes(used + fits + 1) },
    });

    await expect(
      acceptObjects(repoId, owner.userId, [first!, second!, refused!, after!])
    ).rejects.toMatchObject({ status: 413, code: "storage_limit" });

    expect(await held(repoId, [first!, second!, refused!, after!])).toEqual([
      first!.hash,
      second!.hash,
    ]);
    expect(await filed([first!, second!, refused!, after!])).toEqual([
      first!.hash,
      second!.hash,
    ]);
    expect(await usageFor(project)).toBe(used + fits);
  });

  it(
    "keeps every record read before the records fail, the last group's included",
    async () => {
      const repoId = await newRepo();
      const records = newObjects("cut short", 150);
      async function* thenFail() {
        yield* records;
        throw new Error("the pack ends inside a record");
      }

      await expect(
        acceptObjects(repoId, owner.userId, thenFail())
      ).rejects.toThrow("the pack ends inside a record");

      expect(await held(repoId, records)).toHaveLength(150);
    },
    RACE_TIMEOUT
  );

  it("has every file renamed into place before the rows commit, so a crash at the commit leaves files and no rows", async () => {
    const repoId = await newRepo();
    const records = newObjects("crash at commit", 3);
    const crash = failNextCommit(records);

    try {
      await expect(
        acceptObjects(repoId, owner.userId, records)
      ).rejects.toThrow("Failed query: commit");
    } finally {
      crash.restore();
    }

    expect(crash.atCommit.filed).toEqual(records.map((record) => record.hash));
    expect(await rowsOf(records)).toEqual([]);
    expect(await temporariesOf(records)).toEqual([]);
    // Files no row names: the reap's to remove.
    expect(
      await removeUnnamedObjectFiles(records.map((record) => record.hash))
    ).toEqual(records.map((record) => record.hash));
  });

  it("commits no row when a rename fails after the writes, and leaves no temporary file", async () => {
    const repoId = await newRepo();
    const [placed, blocked] = newObjects("crash at rename", 2);
    const blockedPath = storedFilePath(objectKey(blocked!.hash));
    // A directory under the key: the frame's write beside it succeeds and its
    // rename onto it fails.
    await mkdir(blockedPath, { recursive: true });

    try {
      await expect(
        acceptObjects(repoId, owner.userId, [placed!, blocked!])
      ).rejects.toThrow();

      expect(await rowsOf([placed!, blocked!])).toEqual([]);
      expect(await held(repoId, [placed!, blocked!])).toEqual([]);
      expect(await temporariesOf([placed!, blocked!])).toEqual([]);
    } finally {
      await rm(blockedPath, { recursive: true, force: true });
    }
  });
});

describe("acceptObjects beside another transaction on the same object", () => {
  it(
    "waits for a removal of the object's file and stores the file again after it",
    async () => {
      const repoId = await newRepo();
      const object = newObject("removed-beside");
      await storeObjects([{ hash: object.hash, bytes: object.frame }]);
      const removal = await holdTransaction((tx) =>
        lockObjects(tx, [object.hash])
      );

      try {
        const pushing = acceptRecord(repoId, owner.userId, object);
        await removal.blocking();
        await removal.commit(async () => {
          await removeStoredFile(objectKey(object.hash));
        });

        expect(await pushing).toBe("stored");
      } finally {
        await removal.commit();
      }

      expect(await fileOf(object.hash)).toEqual(new Uint8Array(object.frame));
      expect(await rowOf(object.hash)).toHaveLength(1);
    },
    RACE_TIMEOUT
  );

  it(
    "stores the object again when its row is deleted while the push waits on it, rather than failing on the link",
    async () => {
      const [holder, pusher] = [await newRepo(), await newRepo()];
      const object = newObject("reaped-beside");
      await acceptRecord(holder, owner.userId, object);
      await db
        .delete(repoObjects)
        .where(eq(repoObjects.objectHash, object.hash));
      const reap = await holdTransaction(async (tx) => {
        await tx
          .select()
          .from(objects)
          .where(eq(objects.hash, object.hash))
          .for("update");
        await tx.delete(objects).where(eq(objects.hash, object.hash));
      });

      try {
        const pushing = acceptRecord(pusher, owner.userId, object);
        await reap.blocking();
        await reap.commit();

        expect(await pushing).toBe("stored");
      } finally {
        await reap.commit();
      }

      expect(await rowOf(object.hash)).toHaveLength(1);
      expect(await linkOf(pusher, object.hash)).toHaveLength(1);
      expect(await fileOf(object.hash)).toEqual(new Uint8Array(object.frame));
    },
    RACE_TIMEOUT
  );

  it(
    "counts the size of the row a concurrent first push wrote, which is the file's, not its own frame's",
    async () => {
      const repoId = await newRepo();
      const first = newObject("raced");
      const second = reframed(first);
      expect(second.frame.length).not.toBe(first.frame.length);
      const project = projectScope(suite.projectId);
      const before = await usageFor(project);
      const firstPush = await holdTransaction(async (tx) => {
        await lockObjects(tx, [first.hash]);
        await storeObjects([{ hash: first.hash, bytes: first.frame }]);
        await tx.insert(objects).values({
          hash: first.hash,
          kind: first.kind,
          size: first.frame.length,
        });
      });

      try {
        const pushing = acceptRecord(repoId, owner.userId, second);
        await firstPush.blocking();
        await firstPush.commit();

        expect(await pushing).toBe("known");
      } finally {
        await firstPush.commit();
      }

      expect(await rowOf(first.hash)).toMatchObject([
        { size: first.frame.length },
      ]);
      expect((await fileOf(first.hash)).length).toBe(first.frame.length);
      expect(await usageFor(project)).toBe(before + first.frame.length);
    },
    RACE_TIMEOUT
  );

  it(
    "counts the size of a row that lands beside its own, not its own frame's",
    async () => {
      const repoId = await newRepo();
      const first = newObject("landed");
      const second = reframed(first);
      const project = projectScope(suite.projectId);
      const before = await usageFor(project);
      const writer = await holdTransaction(async (tx) => {
        await tx.insert(objects).values({
          hash: first.hash,
          kind: first.kind,
          size: first.frame.length,
        });
      });

      try {
        const pushing = acceptRecord(repoId, owner.userId, second);
        await writer.blocking();
        await writer.commit();

        expect(await pushing).toBe("known");
      } finally {
        await writer.commit();
      }

      expect(await usageFor(project)).toBe(before + first.frame.length);
    },
    RACE_TIMEOUT
  );
});

describe("acceptObjects beside the reap", () => {
  /** A node of an `explain (format json)` plan. */
  type PlanNode = {
    "Node Type": string;
    "Index Name"?: string;
    "Scan Direction"?: string;
    "Sort Key"?: string[];
    Plans?: PlanNode[];
  };

  /** Whether `node` hands its rows on in ascending hash order. */
  const inHashOrder = (node: PlanNode | undefined) =>
    (node?.["Node Type"] === "Sort" &&
      node["Sort Key"]?.[0] === "objects.hash") ||
    (node?.["Node Type"] === "Index Scan" &&
      node["Index Name"] === "objects_pkey" &&
      node["Scan Direction"] === "Forward");

  /**
   * Has every statement this process sends that reads a group's rows planned
   * without an index scan, as a large `objects` table plans a group of more
   * than a dozen keys: a read of the heap, in heap order.
   */
  function heapOrderReads() {
    const query = pg.Client.prototype.query;
    const querySpy = spyOn(pg.Client.prototype, "query").mockImplementation(
      function (this: pg.Client, ...args: unknown[]) {
        const send = query as (...args: unknown[]) => Promise<unknown>;
        if (!/for key share/i.test(sqlTextOf(args))) {
          return send.apply(this, args);
        }
        return send
          .apply(this, ["set local enable_indexscan = off"])
          .then(() => send.apply(this, args));
      } as typeof query
    );
    return { restore: () => querySpy.mockRestore() };
  }

  it("locks a group's rows in hash order, as the reap does, whether or not the plan reads the heap", async () => {
    const repoId = await newRepo();
    const hashes = Array.from({ length: 100 }, (_, n) =>
      hashOf(`group plan ${n} ${randomUUID()}`)
    );

    for (const indexScan of ["on", "off"]) {
      const plan = await db.transaction(async (tx) => {
        await tx.execute(
          sql`select set_config('enable_indexscan', ${indexScan}, true)`
        );
        const { rows } = await tx.execute<{
          "QUERY PLAN": [{ Plan: PlanNode }];
        }>(
          sql`explain (format json) ${acceptStatements
            .groupRows(tx, repoId, hashes)
            .getSQL()}`
        );
        return rows[0]!["QUERY PLAN"][0].Plan;
      });

      expect({
        indexScan,
        top: plan["Node Type"],
        ordered: inHashOrder(plan.Plans?.[0]),
      }).toEqual({ indexScan, top: "LockRows", ordered: true });
    }
  });

  it(
    "waits for a reap holding one of its objects and stores both again, rather than deadlocking, when the higher hash comes first in the heap",
    async () => {
      const repoId = await newRepo();
      const [low, high] = [newObject("heap-low"), newObject("heap-high")].sort(
        (x, y) => (x.hash < y.hash ? -1 : 1)
      );
      // Neither object has a link, as one the unlink has just dropped.
      await db.insert(objects).values(
        [high!, low!].map((record) => ({
          hash: record.hash,
          kind: record.kind,
          size: record.frame.length,
        }))
      );
      const [heap] = (
        await db.execute<{ highFirst: boolean }>(
          sql`select (select ctid from objects where hash = ${high!.hash})
                   < (select ctid from objects where hash = ${low!.hash})
                   as "highFirst"`
        )
      ).rows;
      expect(heap!.highFirst).toBe(true);

      // Another writer holding the higher row stops the reap between its two
      // locks, without blocking a push's `for key share`.
      const writer = await holdTransaction(async (tx) => {
        await tx
          .select()
          .from(objects)
          .where(eq(objects.hash, high!.hash))
          .for("no key update");
      });
      const heapOrder = heapOrderReads();

      try {
        const reaping = db.transaction(async (tx) => {
          const locked = await tx.execute<{ hash: string; tid: string }>(
            sweepStatements.lockObjectRows([low!.hash, high!.hash])
          );
          await tx.execute(sweepStatements.deleteUnreferenced(locked.rows));
        });
        await writer.blocking();
        const pushing = acceptObjects(repoId, owner.userId, [low!, high!]);
        await writer.blocking(2);
        await writer.commit();

        const [reaped, pushed] = await Promise.allSettled([reaping, pushing]);
        expect({ reaped, pushed }).toEqual({
          reaped: { status: "fulfilled", value: undefined },
          pushed: { status: "fulfilled", value: { stored: 2, known: 0 } },
        });
      } finally {
        heapOrder.restore();
        await writer.commit();
      }

      expect(await held(repoId, [low!, high!])).toEqual([
        low!.hash,
        high!.hash,
      ]);
      expect(await fileOf(high!.hash)).toEqual(new Uint8Array(high!.frame));
    },
    RACE_TIMEOUT
  );
});

describe("removeUnnamedObjectFiles", () => {
  /** Hashes of objects the hub has neither a row nor a file for. */
  const unstored = (label: string, count: number) =>
    Array.from({ length: count }, (_, n) =>
      hashOf(`${label} ${n} ${randomUUID()}`)
    );

  it("removes the files no row names and keeps the file of an object that has one", async () => {
    const repoId = await newRepo();
    const named = newObject("still-named");
    await acceptRecord(repoId, owner.userId, named);
    const unnamed = [newObject("unnamed-a"), newObject("unnamed-b")];
    await storeObjects(
      unnamed.map((object) => ({ hash: object.hash, bytes: object.frame }))
    );

    const removed = await removeUnnamedObjectFiles([
      unnamed[0]!.hash,
      named.hash,
      unnamed[1]!.hash,
    ]);

    expect(removed).toEqual(unnamed.map((object) => object.hash));
    expect(await fileOf(named.hash)).toEqual(new Uint8Array(named.frame));
    for (const object of unnamed) {
      expect(await storedFileExists(objectKey(object.hash))).toBe(false);
    }
  });

  it("leaves out a hash whose file would not unlink, and answers one that never had a file", async () => {
    const stuck = newObject("stuck");
    const absent = newObject("absent");
    await storeObjects([{ hash: stuck.hash, bytes: stuck.frame }]);
    const directory = dirname(storedFilePath(objectKey(stuck.hash)));

    await chmod(directory, 0o500);
    try {
      expect(await removeUnnamedObjectFiles([stuck.hash, absent.hash])).toEqual(
        [absent.hash]
      );
      expect(await storedFileExists(objectKey(stuck.hash))).toBe(true);
    } finally {
      await chmod(directory, 0o700);
    }
  });

  it("locks and checks many objects in a handful of statements, not one per object", async () => {
    const hashes = unstored("many", 250);
    const querySpy = spyOn(pg.Client.prototype, "query");
    querySpy.mockClear();

    try {
      expect(await removeUnnamedObjectFiles(hashes)).toHaveLength(250);

      // A transaction per object issues 250 of each: the reap of a deleted
      // project's objects would spend minutes in round trips.
      const locks = querySpy.mock.calls.filter((call) =>
        sqlTextOf(call).includes("pg_advisory_xact_lock")
      );
      const begins = querySpy.mock.calls.filter((call) =>
        /^\s*begin/i.test(sqlTextOf(call))
      );
      expect(locks.length).toBeLessThanOrEqual(5);
      expect(begins.length).toBeLessThanOrEqual(5);
    } finally {
      querySpy.mockRestore();
    }
  });

  it(
    "waits for a push holding one of the objects' locks and keeps the file the push records",
    async () => {
      const [first, pushed, last] = ["first", "pushed", "last"].map((label) =>
        newObject(`removal-beside-${label}`)
      );
      await storeObjects(
        [first!, pushed!, last!].map((object) => ({
          hash: object.hash,
          bytes: object.frame,
        }))
      );
      const push = await holdTransaction((tx) =>
        lockObjects(tx, [pushed!.hash])
      );

      try {
        const removing = removeUnnamedObjectFiles(
          [first!, pushed!, last!].map((object) => object.hash)
        );
        await push.blocking();
        await push.commit(async (tx) => {
          await tx.insert(objects).values({
            hash: pushed!.hash,
            kind: pushed!.kind,
            size: pushed!.frame.length,
          });
        });

        expect(await removing).toEqual([first!.hash, last!.hash]);
      } finally {
        await push.commit();
      }

      expect(await fileOf(pushed!.hash)).toEqual(new Uint8Array(pushed!.frame));
      expect(await storedFileExists(objectKey(first!.hash))).toBe(false);
      expect(await storedFileExists(objectKey(last!.hash))).toBe(false);
    },
    RACE_TIMEOUT
  );

  it(
    "finishes when two removals take the same objects' locks given in opposite orders",
    async () => {
      const hashes = unstored("opposed", 300);

      const [forward, backward] = await Promise.all([
        removeUnnamedObjectFiles(hashes),
        removeUnnamedObjectFiles([...hashes].reverse()),
      ]);

      expect(forward).toHaveLength(300);
      expect(backward).toHaveLength(300);
    },
    RACE_TIMEOUT
  );
});
