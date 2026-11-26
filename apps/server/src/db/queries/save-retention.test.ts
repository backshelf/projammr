import { randomUUID } from "node:crypto";
import { utimes } from "node:fs/promises";
import {
  afterAll,
  afterEach,
  describe,
  expect,
  it,
  jest,
  mock,
  spyOn,
} from "bun:test";
import {
  and,
  eq,
  inArray,
  isNull,
  type SQL,
  sql,
  TransactionRollbackError,
} from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  objectKey,
  storedFileExists,
  storedFilePath,
  storeObjects,
} from "../../lib/storage.js";
import {
  adoptNewSet,
  commitPayload,
  type DitSet,
  hashOf,
  objectsOf,
  pushCommits,
  pushSaves,
  type SavePayload,
  savePayload,
  trackSeeds,
} from "../../test/dit-history.js";
import {
  acceptRecord,
  objectRecord,
  removeObjects,
} from "../../test/dit-objects.js";
import { type Actor, setupSuite, type Suite } from "../../test/fixtures.js";
import { mediaQueue } from "../../lib/jobs.js";
import { holdTransaction } from "../../test/held-transaction.js";
import {
  restoreInstancePolicy,
  stubInstancePolicy,
} from "../../test/instance-policy.js";
import { db, type Tx } from "../index.js";
import {
  objects,
  repoObjects,
  saveObjects,
  saveSampleObjects,
} from "../schema/objects.js";
import { priorityLevels } from "../schema/priority-levels.js";
import { saves } from "../schema/saves.js";
import { sessions } from "../schema/sessions.js";
import {
  enqueueSaveContentSweep,
  lastSaveContentSweep,
  startSaveContentSweeper,
  sweepSaveContent,
  sweepStatements,
} from "./save-retention.js";
import { auditStorage, ORPHAN_AGE_MS } from "./storage-audit.js";
import {
  projectScope,
  recomputeUsage,
  usageFor,
  userScope,
} from "./storage-usage.js";

const suite = setupSuite("Save content retention");
const { owner, requireProject } = suite;

/**
 * The sweeper works across the whole instance, and this file runs beside
 * others writing history of their own. Saves dated in 1920 are older than any
 * retention the instance could set, and nothing else in the suite is that
 * old, so each case keeps to the rows it wrote itself.
 */
const ancient = (day: number) => Date.UTC(1920, 0, day);
const DAY_MS = 24 * 60 * 60 * 1000;
const recent = (daysAgo: number) => Date.now() - daysAgo * DAY_MS;

/** The suite as seen from another project, called as that project's owner. */
const inProject = (project: { id: number; owner: Actor }): Suite => ({
  ...suite,
  projectId: project.id,
  request: async (_caller, path, init) =>
    suite.requestAs(project.owner, path, init),
});

/**
 * Pushes `groups` as a chain of commits on `main`: each group is one commit,
 * its last save the commit's own, and its objects are in the repo first.
 */
async function pushHistory(
  at: Suite,
  set: DitSet,
  userId: string,
  label: string,
  groups: SavePayload[][]
) {
  const all = groups.flat();
  await seedObjects(set.repoId, userId, all.flatMap(objectsOf));
  expect((await pushSaves(at, set, "main", all)).ok).toBe(true);

  let parent: string | null = null;
  for (const [index, group] of groups.entries()) {
    const commit = commitPayload(`${label}-${index}`, parent, group);
    expect((await pushCommits(at, set, "main", [commit])).ok).toBe(true);
    parent = commit.hash;
  }
}

/** The state of a pushed save, the hashes it still rebuilds from, and its meta. */
async function saveOf(set: DitSet, save: SavePayload) {
  const [row] = await db
    .select({
      id: saves.id,
      contentState: saves.contentState,
      meta: saves.meta,
    })
    .from(saves)
    .where(and(eq(saves.sessionId, set.sessionId), eq(saves.hash, save.hash)));
  const held = await db
    .select({ hash: saveObjects.objectHash })
    .from(saveObjects)
    .where(eq(saveObjects.saveId, row!.id));
  return {
    contentState: row!.contentState,
    meta: row!.meta,
    held: held.map((link) => link.hash).sort(),
  };
}

const sorted = (hashes: string[]) => [...hashes].sort();

/** Makes a link as old as one pushed long ago. */
const ageLinks = (repoId: number, hashes: string[]) =>
  db
    .update(repoObjects)
    .set({ pushedAt: new Date(ancient(1)) })
    .where(
      and(
        eq(repoObjects.repoId, repoId),
        inArray(repoObjects.objectHash, hashes)
      )
    );

const linksOf = async (repoId: number) =>
  (
    await db
      .select({ hash: repoObjects.objectHash })
      .from(repoObjects)
      .where(eq(repoObjects.repoId, repoId))
  )
    .map((row) => row.hash)
    .sort();

const objectRows = async (hashes: string[]) =>
  (
    await db
      .select({ hash: objects.hash })
      .from(objects)
      .where(inArray(objects.hash, hashes))
  )
    .map((row) => row.hash)
    .sort();

const filed: string[] = [];
const { seedObjects, removeSeeded } = trackSeeds();

/** Room for a held transaction and the waits queued behind it, under load. */
const RACE_TIMEOUT = 20_000;

/**
 * An object stored the way a push stores it, then left with no link, as the
 * unlink step leaves one it has dropped: next in line for the reap.
 */
async function reapableObject(set: DitSet, label: string) {
  const object = objectRecord(`${label} ${randomUUID()}`);
  filed.push(object.hash);
  await acceptRecord(set.repoId, owner.userId, object);
  await db.delete(repoObjects).where(eq(repoObjects.objectHash, object.hash));
  return object;
}

/**
 * Objects enough that `objects` and its links span hundreds of pages, so a
 * scan of them costs far more than a walk of their indexes.
 */
const LARGE_SET = 30_000;

/**
 * Sessions and saves enough that each table spans dozens of pages, so a scan
 * of it costs far more than a probe of its primary key.
 */
const FILLER_ROWS = 3_000;

/**
 * {@link FILLER_ROWS} sessions in the suite's project, in no repo. Made before
 * the session a case looks up, they come first in the primary key, so a plan
 * that walks the key from its start to find that session reads every filler.
 */
async function seedFillerSessions(label: string): Promise<number[]> {
  const [priority] = await db
    .select({ id: priorityLevels.id })
    .from(priorityLevels)
    .where(eq(priorityLevels.projectId, suite.projectId))
    .limit(1);
  const fillers = await db
    .insert(sessions)
    .values(
      Array.from({ length: FILLER_ROWS }, (_, n) => ({
        name: `${label} filler ${n}`,
        daw: "manual",
        priorityId: priority!.id,
        projectId: suite.projectId,
      }))
    )
    .returning({ id: sessions.id });
  return fillers.map((filler) => filler.id);
}

/**
 * {@link FILLER_ROWS} saves of the set's own session, with no content. Made
 * before the save a case looks up, they come first in the primary key, and a
 * plan that reaches that save through its session reads every one of them.
 */
const seedFillerSaves = (set: DitSet) =>
  db.insert(saves).values(
    Array.from({ length: FILLER_ROWS }, (_, n) => ({
      sessionId: set.sessionId,
      projectId: suite.projectId,
      fileUpdatedAt: new Date(recent(2) + n),
      source: "scan" as const,
    }))
  );

/** Room to seed, sweep and remove a {@link LARGE_SET} under load. */
const LARGE_TIMEOUT = 60_000;

/** {@link LARGE_SET} objects held by `set`'s repo through links inside the grace, in hash order. */
async function seedLargeSet(set: DitSet, label: string) {
  const hashes = Array.from({ length: LARGE_SET }, (_, n) =>
    hashOf(`${label}-${n} ${randomUUID()}`)
  ).sort();
  await seedObjects(set.repoId, owner.userId, hashes);
  return hashes;
}

/** The tables the unlink and the reap read. */
const sweptTables = [
  "objects",
  "repo_objects",
  "save_objects",
  "save_sample_objects",
  "saves",
  "sessions",
];

/** The `pg_class` rows of `table` and its indexes. */
const tableAndIndexes = (table: string) => sql`
  oid = ${table}::regclass
  or oid in (select indexrelid from pg_index where indrelid = ${table}::regclass)`;

/** The pages a swept relation has now, which the planner reads off the disk. */
const pagesNow = sql`pg_relation_size(oid) / current_setting('block_size')::int`;

/** The rows `table` holds now. */
const rowsNow = (table: string) =>
  sql`(select count(*) from ${sql.identifier(table)})`;

/**
 * Statistics the swept tables may carry: true to their size, and three far
 * from it. The planner scales `reltuples` by how far a table has grown past
 * `relpages`, so a stale row count paired with the pages it has now is what
 * it plans by. Each sets a table's indexes as it sets the table.
 */
const plannerStatistics: {
  state: string;
  reltuples: (table: string) => SQL | number;
  relpages: SQL;
}[] = [
  { state: "true to the tables' size", reltuples: rowsNow, relpages: pagesNow },
  {
    state: "read while the tables were small",
    reltuples: () => 200,
    relpages: pagesNow,
  },
  {
    state:
      "read by a vacuum once the tables were all but emptied, before they refilled the same pages",
    reltuples: () => 0,
    relpages: pagesNow,
  },
  {
    state: "never read, as after a TRUNCATE",
    reltuples: () => -1,
    relpages: sql`0`,
  },
];

type PlannerStatistics = (typeof plannerStatistics)[number];

/**
 * Runs `read` while the swept tables carry `statistics`. They are changed
 * inside a repeatable-read transaction that is rolled back, so `read` sees one
 * snapshot and no other connection plans by them.
 */
async function underStatistics<T>(
  statistics: PlannerStatistics,
  read: (tx: Tx) => Promise<T>
): Promise<T> {
  let result!: T;
  await db
    .transaction(
      async (tx) => {
        for (const table of sweptTables) {
          await tx.execute(sql`
            update pg_class
               set reltuples = ${statistics.reltuples(table)},
                   relpages = ${statistics.relpages}
             where ${tableAndIndexes(table)}`);
        }
        result = await read(tx);
        tx.rollback();
      },
      { isolationLevel: "repeatable read" }
    )
    .catch((error: unknown) => {
      if (!(error instanceof TransactionRollbackError)) throw error;
    });
  return result;
}

/**
 * The plans of `statements`, as their root nodes, while the swept tables
 * carry `statistics`.
 */
const plansUnderStatistics = (
  statistics: PlannerStatistics,
  statements: SQL[]
) =>
  underStatistics(statistics, async (tx) => {
    const plans: PlanNode[] = [];
    for (const statement of statements) {
      const { rows } = await tx.execute<{
        "QUERY PLAN": [{ Plan: PlanNode }];
      }>(sql`explain (format json) ${statement}`);
      plans.push(rows[0]!["QUERY PLAN"][0].Plan);
    }
    return plans;
  });

/**
 * A node of an `explain (format json)` plan; the `Actual` counts are there
 * with `analyze`.
 */
type PlanNode = {
  "Node Type": string;
  "Relation Name"?: string;
  "Index Cond"?: string;
  "Run Condition"?: string;
  "Actual Rows"?: number;
  "Actual Loops"?: number;
  "Rows Removed by Filter"?: number;
  "Rows Removed by Index Recheck"?: number;
  Plans?: PlanNode[];
};

/** Every node of `node`'s plan, `node` first. */
const nodesOf = (node: PlanNode): PlanNode[] => [
  node,
  ...(node.Plans ?? []).flatMap(nodesOf),
];

/**
 * The tables of `tables` that `plan` reads whole rather than looking a row up
 * in: by a sequential scan, or by an index scan with no condition on the
 * index, which a merge join, or a nested loop that filters the join, walks
 * from the index's start for every row it is handed.
 */
const wholeScans = (plan: PlanNode, tables: string[]) =>
  [
    ...new Set(
      nodesOf(plan)
        .filter(
          (node) =>
            tables.includes(node["Relation Name"] ?? "") &&
            (node["Node Type"] === "Seq Scan" ||
              (node["Node Type"].startsWith("Index") && !node["Index Cond"]))
        )
        .map((node) => node["Relation Name"]!)
    ),
  ].sort();

/**
 * How many rows of `relation` the scans in `node` read to find them, across
 * all their loops. A TID scan, the delete fetching the rows a walk took by
 * their `tid`, finds nothing.
 */
const rowsRead = (node: PlanNode, relation: string): number =>
  (node["Relation Name"] === relation &&
  node["Node Type"].endsWith("Scan") &&
  node["Node Type"] !== "Tid Scan"
    ? ((node["Actual Rows"] ?? 0) +
        (node["Rows Removed by Filter"] ?? 0) +
        (node["Rows Removed by Index Recheck"] ?? 0)) *
      (node["Actual Loops"] ?? 0)
    : 0) +
  (node.Plans ?? []).reduce((sum, child) => sum + rowsRead(child, relation), 0);

/**
 * How many times the reap's walk in `node` looked for a link to an object,
 * which it does once for each object it tests `take` on.
 */
const linksProbed = (node: PlanNode): number =>
  Math.max(
    0,
    ...nodesOf(node)
      .filter((scan) => scan["Relation Name"] === "repo_objects")
      .map((scan) => scan["Actual Loops"] ?? 0)
  );

/** Room for a statement that reads each row it walks once, under load. */
const WALK_RUN_TIMEOUT = "10s";

/**
 * Runs `statement`, which walks `relation`, while the swept tables carry
 * `statistics`, and returns how many of its rows the statement read and how
 * many it held before. A statement that reads the rows past its start again
 * for each key it walks is cancelled after {@link WALK_RUN_TIMEOUT}.
 */
const walkUnderStatistics = (
  statistics: PlannerStatistics,
  statement: SQL,
  relation: string
) =>
  underStatistics(statistics, async (tx) => {
    await tx.execute(
      sql`select set_config('statement_timeout', ${WALK_RUN_TIMEOUT}, true)`
    );
    const [count] = (
      await tx.execute<{ rows: number }>(
        sql`select count(*)::int as rows from ${sql.identifier(relation)}`
      )
    ).rows;
    const { rows } = await tx.execute<{
      "QUERY PLAN": [{ Plan: PlanNode }];
    }>(sql`explain (analyze, format json) ${statement}`);
    const plan = rows[0]!["QUERY PLAN"][0].Plan;
    return {
      read: rowsRead(plan, relation),
      held: count!.rows,
      readOf: (table: string) => rowsRead(plan, table),
    };
  });

afterEach(() => {
  restoreInstancePolicy();
  mock.restore();
});

afterAll(async () => {
  await removeSeeded();
  await removeObjects(filed);
});

describe("sweepSaveContent", () => {
  it("prunes an old save no commit owns, keeping its row and meta, and leaves a commit's own save and a newer save alone", async () => {
    requireProject();
    const set = await adoptNewSet(suite, "prune");
    const meta = {
      tempo: "124",
      timeSignature: "4/4",
      rootNote: null,
      scale: null,
      tracksCount: 3,
      scenesCount: 1,
      dawVersion: "12.1",
      structure: null,
      samplePaths: ["a.wav"],
    };
    const oldBetween = savePayload("prune-old", ancient(1), { meta });
    const oldOwn = savePayload("prune-old-own", ancient(2));
    const newBetween = savePayload("prune-new", recent(2));
    const newOwn = savePayload("prune-new-own", recent(1));
    await pushHistory(suite, set, owner.userId, "prune", [
      [oldBetween, oldOwn],
      [newBetween, newOwn],
    ]);

    const swept = await sweepSaveContent();

    expect(swept.pruned).toBeGreaterThanOrEqual(1);
    expect(await saveOf(set, oldBetween)).toEqual({
      contentState: "pruned",
      meta,
      held: [],
    });
    for (const kept of [oldOwn, newBetween, newOwn]) {
      expect(await saveOf(set, kept)).toMatchObject({
        contentState: "stored",
        held: sorted(objectsOf(kept)),
      });
    }
  });

  it("keeps a save inside the retention the instance sets and prunes it once the retention shrinks", async () => {
    requireProject();
    const set = await adoptNewSet(suite, "window");
    const between = savePayload("window-between", recent(40));
    const own = savePayload("window-own", recent(39));
    await pushHistory(suite, set, owner.userId, "window", [[between, own]]);

    stubInstancePolicy({ jobs: { saveContentRetentionDays: 60 } });
    await sweepSaveContent();
    expect((await saveOf(set, between)).contentState).toBe("stored");

    stubInstancePolicy({ jobs: { saveContentRetentionDays: 30 } });
    await sweepSaveContent();
    expect((await saveOf(set, between)).contentState).toBe("pruned");
    expect((await saveOf(set, own)).contentState).toBe("stored");
  });

  it("brings a pruned save back when a later commit carries it", async () => {
    requireProject();
    const set = await adoptNewSet(suite, "revive");
    const between = savePayload("revive-between", ancient(1));
    const own = savePayload("revive-own", ancient(2));
    await pushHistory(suite, set, owner.userId, "revive", [[between, own]]);
    await sweepSaveContent();
    expect((await saveOf(set, between)).contentState).toBe("pruned");

    await seedObjects(set.repoId, owner.userId, objectsOf(between));
    const next = savePayload("revive-next", ancient(3));
    await seedObjects(set.repoId, owner.userId, objectsOf(next));
    expect((await pushSaves(suite, set, "main", [next])).ok).toBe(true);
    const parent = commitPayload("revive-0", null, [between, own]);
    const commit = commitPayload("revive-1", parent.hash, [between, next]);
    expect((await pushCommits(suite, set, "main", [commit])).ok).toBe(true);

    expect((await saveOf(set, between)).contentState).toBe("stored");
  });

  it("removes only the link of the repo whose saves no longer use an object, and the usage that came with it", async () => {
    requireProject();
    const projectA = await suite.throwawayProject("Retention A");
    const projectB = await suite.throwawayProject("Retention B");
    const suiteA = inProject(projectA);
    const suiteB = inProject(projectB);
    const setA = await adoptNewSet(suiteA, "shared-a");
    const setB = await adoptNewSet(suiteB, "shared-b");

    const shared = savePayload("shared", ancient(1));
    const ownA = savePayload("shared-own-a", ancient(2));
    await pushHistory(suiteA, setA, projectA.owner.userId, "shared-a", [
      [shared, ownA],
    ]);
    await pushHistory(suiteB, setB, projectB.owner.userId, "shared-b", [
      [shared],
    ]);
    const sharedObjects = objectsOf(shared);
    await ageLinks(setA.repoId, sharedObjects);
    await ageLinks(setB.repoId, sharedObjects);
    await recomputeUsage([
      projectScope(projectA.id),
      projectScope(projectB.id),
      userScope(projectA.owner.userId),
    ]);
    const before = {
      projectA: await usageFor(projectScope(projectA.id)),
      projectB: await usageFor(projectScope(projectB.id)),
      userA: await usageFor(userScope(projectA.owner.userId)),
    };
    expect(before.projectA).toBe(40);
    // A's repo is the earliest link of the shared objects, so B pays nothing.
    expect(before.projectB).toBe(0);

    const swept = await sweepSaveContent();

    expect(swept.unlinked).toBeGreaterThanOrEqual(2);
    expect((await saveOf(setA, shared)).contentState).toBe("pruned");
    expect(await linksOf(setA.repoId)).toEqual(sorted(objectsOf(ownA)));
    expect(await linksOf(setB.repoId)).toEqual(sorted(sharedObjects));
    expect(await objectRows(sharedObjects)).toEqual(sorted(sharedObjects));
    expect(await usageFor(projectScope(projectA.id))).toBe(20);
    expect(await usageFor(userScope(projectA.owner.userId))).toBe(20);
    // The charge for the shared objects moves to B, whose link is the earliest left.
    expect(await usageFor(projectScope(projectB.id))).toBe(20);
    expect(await usageFor(userScope(projectB.owner.userId))).toBe(20);
  });

  it("reaps an object nothing references along with its file, and leaves a link inside the grace alone", async () => {
    requireProject();
    const set = await adoptNewSet(suite, "reap");
    const stale = hashOf("reap-stale");
    const fresh = hashOf("reap-fresh");
    filed.push(stale, fresh);
    await storeObjects([
      { hash: stale, bytes: new Uint8Array([1, 2, 3]) },
      { hash: fresh, bytes: new Uint8Array([4, 5, 6]) },
    ]);
    await seedObjects(set.repoId, owner.userId, [stale, fresh]);
    await ageLinks(set.repoId, [stale]);

    const swept = await sweepSaveContent();

    expect(swept.reaped).toBeGreaterThanOrEqual(1);
    expect(await objectRows([stale, fresh])).toEqual([fresh]);
    expect(await storedFileExists(objectKey(stale))).toBe(false);
    expect(await storedFileExists(objectKey(fresh))).toBe(true);
    expect(await linksOf(set.repoId)).toEqual([fresh]);
  });

  it("keeps an object an unpruned save still rebuilds from, however old its link", async () => {
    requireProject();
    const set = await adoptNewSet(suite, "held");
    const own = savePayload("held-own", ancient(1));
    await pushHistory(suite, set, owner.userId, "held", [[own]]);
    await ageLinks(set.repoId, objectsOf(own));

    await sweepSaveContent();

    expect(await linksOf(set.repoId)).toEqual(sorted(objectsOf(own)));
    expect(await objectRows(objectsOf(own))).toEqual(sorted(objectsOf(own)));
  });

  it("walks every batch when there is more to drop than one statement takes", async () => {
    requireProject();
    const set = await adoptNewSet(suite, "batches");
    const between = [1, 2, 3].map((n) => savePayload(`batch-${n}`, ancient(n)));
    const own = savePayload("batch-own", ancient(4));
    await pushHistory(suite, set, owner.userId, "batches", [[...between, own]]);
    const droppable = between.flatMap(objectsOf);
    await ageLinks(set.repoId, droppable);

    const swept = await sweepSaveContent(2);

    expect(swept.pruned).toBeGreaterThanOrEqual(3);
    expect(swept.unlinked).toBeGreaterThanOrEqual(6);
    expect(swept.reaped).toBeGreaterThanOrEqual(6);
    for (const save of between) {
      expect((await saveOf(set, save)).contentState).toBe("pruned");
    }
    expect(await objectRows(droppable)).toEqual([]);
    expect(await linksOf(set.repoId)).toEqual(sorted(objectsOf(own)));
  });

  it(
    "walks on past a batch whose link another transaction removed first",
    async () => {
      requireProject();
      const set = await adoptNewSet(suite, "unlink-race");
      const hashes = ["a", "b", "c"]
        .map((name) => hashOf(`unlink-race-${name} ${randomUUID()}`))
        .sort();
      filed.push(...hashes);
      await seedObjects(set.repoId, owner.userId, hashes);
      await ageLinks(set.repoId, hashes);
      const firstLink = and(
        eq(repoObjects.repoId, set.repoId),
        eq(repoObjects.objectHash, hashes[0]!)
      );
      const projectDelete = await holdTransaction(async (tx) => {
        await tx.select().from(repoObjects).where(firstLink).for("update");
      });

      try {
        const sweeping = sweepSaveContent(1);
        await projectDelete.blocking();
        await projectDelete.commit(async (tx) => {
          await tx.delete(repoObjects).where(firstLink);
        });
        await sweeping;
      } finally {
        await projectDelete.commit();
      }

      expect(await linksOf(set.repoId)).toEqual([]);
    },
    RACE_TIMEOUT
  );

  it("keeps the file of an object a push stores again between the reap's delete of its row and the removal of its file", async () => {
    requireProject();
    const set = await adoptNewSet(suite, "restored");
    const object = await reapableObject(set, "restored");
    let pushed: string | undefined;

    await sweepSaveContent(undefined, {
      afterObjectRowsDeleted: async (hashes) => {
        if (!hashes.includes(object.hash)) return;
        pushed = await acceptRecord(set.repoId, owner.userId, object);
      },
    });

    expect(pushed).toBe("stored");
    expect(await objectRows([object.hash])).toEqual([object.hash]);
    expect(
      new Uint8Array(
        await Bun.file(storedFilePath(objectKey(object.hash))).bytes()
      )
    ).toEqual(new Uint8Array(object.frame));
  });

  it("leaves only an orphan file, which the audit removes, when the sweep dies between an object's row and its file", async () => {
    requireProject();
    const set = await adoptNewSet(suite, "crashed");
    const object = await reapableObject(set, "crashed");
    const key = objectKey(object.hash);

    await expect(
      sweepSaveContent(undefined, {
        afterObjectRowsDeleted: async (hashes) => {
          if (hashes.includes(object.hash)) throw new Error("killed");
        },
      })
    ).rejects.toThrow("killed");

    expect(await objectRows([object.hash])).toEqual([]);
    expect(await storedFileExists(key)).toBe(true);

    const aged = new Date(Date.now() - ORPHAN_AGE_MS - 60_000);
    await utimes(storedFilePath(key), aged, aged);
    await auditStorage();
    expect(await storedFileExists(key)).toBe(false);
  });

  it("re-derives the counters of the scopes whose links went even when the reap fails", async () => {
    requireProject();
    const project = await suite.throwawayProject("Retention reap fails");
    const set = await adoptNewSet(inProject(project), "reap-fails");
    const dropped = savePayload("reap-fails", ancient(1));
    const own = savePayload("reap-fails-own", ancient(2));
    await pushHistory(
      inProject(project),
      set,
      project.owner.userId,
      "reap-fails",
      [[dropped, own]]
    );
    const droppedObjects = objectsOf(dropped);
    await ageLinks(set.repoId, droppedObjects);
    const scopes = [projectScope(project.id), userScope(project.owner.userId)];
    await recomputeUsage(scopes);
    const before = await Promise.all(scopes.map(usageFor));

    await expect(
      sweepSaveContent(undefined, {
        afterObjectRowsDeleted: async (hashes) => {
          if (hashes.some((hash) => droppedObjects.includes(hash))) {
            throw new Error("killed");
          }
        },
      })
    ).rejects.toThrow("killed");

    expect(await linksOf(set.repoId)).toEqual(sorted(objectsOf(own)));
    const after = await Promise.all(scopes.map(usageFor));
    await recomputeUsage(scopes);
    expect(after).toEqual(await Promise.all(scopes.map(usageFor)));
    expect(after[0]).toBeLessThan(before[0]!);
    expect(after[1]).toBeLessThan(before[1]!);
  });

  it("re-derives the counters of the scopes whose links went even when the unlink fails partway", async () => {
    requireProject();
    const project = await suite.throwawayProject("Retention unlink fails");
    const set = await adoptNewSet(inProject(project), "unlink-fails");
    const dropped = savePayload("unlink-fails", ancient(1));
    const own = savePayload("unlink-fails-own", ancient(2));
    await pushHistory(
      inProject(project),
      set,
      project.owner.userId,
      "unlink-fails",
      [[dropped, own]]
    );
    await ageLinks(set.repoId, objectsOf(dropped));
    const scopes = [projectScope(project.id), userScope(project.owner.userId)];
    await recomputeUsage(scopes);
    const before = await Promise.all(scopes.map(usageFor));

    // Batches of one link: the batch that unlinks one of this repo's links
    // commits, and the next unlink batch fails; the re-derive after it runs.
    const execute = db.execute.bind(db);
    let unlinkedHere = false;
    let killed = false;
    const spy = spyOn(db, "execute").mockImplementation((async (
      query: Parameters<typeof db.execute>[0]
    ) => {
      if (unlinkedHere && !killed) {
        killed = true;
        throw new Error("killed");
      }
      const result = await execute(query);
      unlinkedHere ||= (result.rows as Record<string, unknown>[]).some(
        (row) => row.unlinked === true && row.repo_id === set.repoId
      );
      return result;
    }) as typeof db.execute);
    try {
      await expect(sweepSaveContent(1)).rejects.toThrow("killed");
    } finally {
      spy.mockRestore();
    }

    expect(unlinkedHere).toBe(true);
    const after = await Promise.all(scopes.map(usageFor));
    await recomputeUsage(scopes);
    expect(after).toEqual(await Promise.all(scopes.map(usageFor)));
    expect(after[0]).toBeLessThan(before[0]!);
  });

  /** A set whose one commit lists a stored sample as its own save's, with the sample's link aged. */
  async function committedSample(label: string) {
    const set = await adoptNewSet(suite, label);
    const sample = objectRecord(`${label} ${randomUUID()}`);
    filed.push(sample.hash);
    await acceptRecord(set.repoId, owner.userId, sample);
    const dropped = savePayload(`${label}-dropped`, ancient(1));
    const own = savePayload(`${label}-own`, ancient(2), {
      meta: {
        tempo: null,
        timeSignature: null,
        rootNote: null,
        scale: null,
        tracksCount: null,
        scenesCount: null,
        dawVersion: null,
        structure: null,
        samplePaths: null,
        samples: [
          {
            path: "Samples/s.wav",
            kind: "project",
            relative: "Samples/s.wav",
            object: sample.hash,
            size: 10,
          },
        ],
      },
    });
    await seedObjects(
      set.repoId,
      owner.userId,
      [dropped, own].flatMap(objectsOf)
    );
    expect((await pushSaves(suite, set, "main", [dropped, own])).ok).toBe(true);
    const commit = commitPayload(label, null, [dropped, own], {
      sampleObjects: [sample.hash],
    });
    expect((await pushCommits(suite, set, "main", [commit])).ok).toBe(true);
    await ageLinks(set.repoId, [
      sample.hash,
      ...[dropped, own].flatMap(objectsOf),
    ]);
    const sampleLinks = async () =>
      (
        await db
          .select({ hash: saveSampleObjects.objectHash })
          .from(saveSampleObjects)
          .innerJoin(saves, eq(saves.id, saveSampleObjects.saveId))
          .where(eq(saves.sessionId, set.sessionId))
      ).map((row) => row.hash);
    return { set, sample, own, sampleLinks };
  }

  it("keeps a sample the commit's save lists through the prune, the unlink and the reap", async () => {
    requireProject();
    const { set, sample, own, sampleLinks } =
      await committedSample("sample-kept");

    const swept = await sweepSaveContent();
    expect(swept.pruned).toBeGreaterThanOrEqual(1);

    expect(await sampleLinks()).toEqual([sample.hash]);
    expect(await linksOf(set.repoId)).toContain(sample.hash);
    expect(await objectRows([sample.hash])).toEqual([sample.hash]);
    expect(await storedFileExists(objectKey(sample.hash))).toBe(true);
    expect((await saveOf(set, own)).contentState).toBe("stored");
  });

  it("frees a sample once no save lists it: the unlink takes its link and the reap its object and file", async () => {
    requireProject();
    const { set, sample, sampleLinks } = await committedSample("sample-freed");
    await db
      .delete(saveSampleObjects)
      .where(eq(saveSampleObjects.objectHash, sample.hash));
    expect(await sampleLinks()).toEqual([]);

    await sweepSaveContent();

    expect(await linksOf(set.repoId)).not.toContain(sample.hash);
    expect(await objectRows([sample.hash])).toEqual([]);
    expect(await storedFileExists(objectKey(sample.hash))).toBe(false);
  });

  it(
    "plans the unlink's and the reap's lookups with no scan of the tables they look rows up in, and walks each row once, whatever the statistics say of the tables' size",
    async () => {
      requireProject();
      // Sessions and saves enough to span pages of their own, ahead of the
      // set's session and its save in both keys.
      const fillerSessions = await seedFillerSessions("stale-plans");
      const set = await adoptNewSet(suite, "stale-plans");
      const hashes = await seedLargeSet(set, "stale-plans");
      const save = savePayload("stale-plans", recent(1));
      const saveHashes = objectsOf(save);
      try {
        await seedFillerSaves(set);
        // One save rebuilding from every object gives `save_objects` the
        // size of the other two.
        await seedObjects(set.repoId, owner.userId, saveHashes);
        expect((await pushSaves(suite, set, "main", [save])).ok).toBe(true);
        const [row] = await db
          .select({ id: saves.id })
          .from(saves)
          .where(
            and(eq(saves.sessionId, set.sessionId), eq(saves.hash, save.hash))
          );
        await db
          .insert(saveObjects)
          .values(
            hashes.map((objectHash) => ({ saveId: row!.id, objectHash }))
          );
        // And as many sample links, so `save_sample_objects` is as large.
        await db
          .insert(saveSampleObjects)
          .values(
            hashes.map((objectHash) => ({ saveId: row!.id, objectHash }))
          );

        const locked = await db
          .select({ hash: objects.hash, tid: sql<string>`ctid::text` })
          .from(objects)
          .where(inArray(objects.hash, hashes.slice(0, 1000)));

        const unlink = sweepStatements.unlinkBatch(
          { repoId: 0, hash: "" },
          new Date(),
          1000
        );
        const reap = sweepStatements.reapBatch("", 1000);

        // Each statement with the tables it only looks rows up in, which a
        // scan, or an index scan with no condition, would read whole once per
        // row (`wholeScans`). A walk's own table is left out:
        // it is read as one range per statement, which statistics that put
        // the table at a few hundred rows plan as a scan and sort of the whole
        // table, once, and the check below bounds that read instead.
        const lookups = [
          {
            statement: unlink,
            tables: [
              "save_objects",
              "save_sample_objects",
              "saves",
              "sessions",
            ],
          },
          {
            statement: reap,
            tables: ["repo_objects", "save_objects", "save_sample_objects"],
          },
          {
            statement: sweepStatements.lockObjectRows(
              locked.map((row) => row.hash)
            ),
            tables: [
              "objects",
              "repo_objects",
              "save_objects",
              "save_sample_objects",
            ],
          },
          {
            statement: sweepStatements.deleteUnreferenced(locked),
            tables: [
              "objects",
              "repo_objects",
              "save_objects",
              "save_sample_objects",
            ],
          },
        ];

        for (const statistics of plannerStatistics) {
          const plans = await plansUnderStatistics(
            statistics,
            lookups.map((lookup) => lookup.statement)
          );
          const scans = plans.map((plan, index) =>
            wholeScans(plan, lookups[index]!.tables)
          );
          expect({ statistics: statistics.state, scans }).toEqual({
            statistics: statistics.state,
            scans: [[], [], [], []],
          });

          // A walk stops at the first row past its limit rather than testing
          // `take` for every row of its range.
          expect({
            statistics: statistics.state,
            stops: plans
              .slice(0, 2)
              .map((plan) =>
                nodesOf(plan).some((node) =>
                  node["Run Condition"]?.startsWith("(count(*) FILTER")
                )
              ),
          }).toEqual({ statistics: statistics.state, stops: [true, true] });

          // A walk reads each row past where it starts once at most: a plan
          // that reads them all again for every key it walks is cancelled.
          // Each object here is in one save, so the unlink reads one save and
          // one session for each link it walks: a plan that reaches the save
          // through its session reads all of the session's saves instead.
          for (const [statement, relation, lookedUp] of [
            [unlink, "repo_objects", ["saves", "sessions"]],
            [reap, "objects", []],
          ] as const) {
            const walk = await walkUnderStatistics(
              statistics,
              statement,
              relation
            );
            expect({
              statistics: statistics.state,
              relation,
              readOnce: walk.read <= walk.held,
              lookedUpOnce: lookedUp.filter(
                (table) => walk.readOf(table) > walk.read
              ),
            }).toEqual({
              statistics: statistics.state,
              relation,
              readOnce: true,
              lookedUpOnce: [],
            });
          }
        }
      } finally {
        await db
          .delete(saveObjects)
          .where(inArray(saveObjects.objectHash, [...hashes, ...saveHashes]));
        await removeObjects([...hashes, ...saveHashes]);
        await db
          .delete(saves)
          .where(and(eq(saves.sessionId, set.sessionId), isNull(saves.hash)));
        await db.delete(sessions).where(inArray(sessions.id, fillerSessions));
      }
    },
    LARGE_TIMEOUT
  );

  it(
    "reaps a large unreferenced set and keeps a run of held objects longer than one statement walks",
    async () => {
      requireProject();
      const set = await adoptNewSet(suite, "large-reap");
      const hashes = await seedLargeSet(set, "large-reap");
      const held = hashes.slice(0, 12_000);
      const dropped = hashes.slice(held.length);
      try {
        await db
          .delete(repoObjects)
          .where(inArray(repoObjects.objectHash, dropped));

        // Past the held run every object is taken, so a batch tests `take`
        // for the rows up to its limit and one more, not the whole range.
        const { rows } = await db.execute<{
          "QUERY PLAN": [{ Plan: PlanNode }];
        }>(
          sql`explain (analyze, format json) ${sweepStatements.reapBatch(
            held.at(-1)!,
            1000
          )}`
        );
        expect(linksProbed(rows[0]!["QUERY PLAN"][0].Plan)).toBeLessThan(2000);

        const swept = await sweepSaveContent();

        expect(swept.reaped).toBeGreaterThanOrEqual(dropped.length);
        expect(await objectRows(dropped)).toEqual([]);
        expect(await objectRows(held)).toEqual(held);
        expect(await linksOf(set.repoId)).toEqual(held);
      } finally {
        await removeObjects(hashes);
      }
    },
    LARGE_TIMEOUT
  );
});

describe("startSaveContentSweeper", () => {
  it("queues a sweep at boot, then daily, and at once when the retention changes", () => {
    jest.useFakeTimers();
    const sweep = mock(async () => undefined);
    const stop = startSaveContentSweeper(sweep);
    try {
      expect(sweep).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(DAY_MS);
      expect(sweep).toHaveBeenCalledTimes(2);

      stubInstancePolicy({ jobs: { saveContentRetentionDays: 30 } });
      expect(sweep).toHaveBeenCalledTimes(3);
    } finally {
      stop();
      jest.useRealTimers();
    }
  });
});

describe("the save_content_sweep job", () => {
  const pendingJobs = () =>
    db.query.jobs.findMany({
      where: {
        kind: "save_content_sweep",
        status: { in: ["queued", "running"] },
      },
    });

  it("queues one sweep and skips while one is queued or running", async () => {
    await mediaQueue.idle();
    const first = await enqueueSaveContentSweep();
    expect(first).toBeNumber();
    expect(await enqueueSaveContentSweep()).toBeUndefined();
    await mediaQueue.idle();
    expect(await pendingJobs()).toEqual([]);
    expect(await enqueueSaveContentSweep()).toBeNumber();
    await mediaQueue.idle();
  });

  it("records the run: its time, and the bytes the reap freed", async () => {
    requireProject();
    await mediaQueue.idle();
    const set = await adoptNewSet(suite, "sweep-job");
    const object = await reapableObject(set, "sweep-job");
    const jobId = await enqueueSaveContentSweep();
    await mediaQueue.idle();

    const row = await db.query.jobs.findFirst({ where: { id: jobId } });
    expect(row?.status).toBe("done");
    expect(row?.result).toMatchObject({
      pruned: expect.any(Number),
      unlinked: expect.any(Number),
      reaped: expect.any(Number),
    });
    expect(Number(row?.result?.bytesFreed)).toBeGreaterThanOrEqual(
      object.frame.length
    );
    expect(await lastSaveContentSweep()).toMatchObject({
      status: "done",
      finishedAt: expect.any(Date),
    });
  });

  it("records a failed run, and reads it back as the last one", async () => {
    await mediaQueue.idle();
    const execute = db.execute.bind(db);
    const dialect = new PgDialect();
    const spy = spyOn(db, "execute").mockImplementation((async (
      query: Parameters<typeof db.execute>[0]
    ) => {
      if (dialect.sqlToQuery(query as SQL).sql.includes("walk(")) {
        throw new Error("killed");
      }
      return execute(query);
    }) as typeof db.execute);
    let jobId: number | undefined;
    try {
      jobId = await enqueueSaveContentSweep();
      await mediaQueue.idle();
    } finally {
      spy.mockRestore();
    }

    const row = await db.query.jobs.findFirst({ where: { id: jobId } });
    expect(row?.status).toBe("failed");
    expect(await lastSaveContentSweep()).toMatchObject({
      status: "failed",
      bytesFreed: 0,
    });
  });
});
