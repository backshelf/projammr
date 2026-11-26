import { afterEach, describe, expect, it, jest, mock, spyOn } from "bun:test";
import { inArray } from "drizzle-orm";
import { setupSuite } from "../../test/fixtures.js";
import {
  restoreInstancePolicy,
  stubInstancePolicy,
} from "../../test/instance-policy.js";
import { db } from "../index.js";
import { activity } from "../schema/activity.js";
import { saves } from "../schema/saves.js";
import { startRetentionSweeper, sweepRetention } from "./retention.js";

const suite = setupSuite("Retention sweeper");
const { requireProject, mkSession } = suite;

/**
 * The sweeper works across the whole instance, and this file runs beside
 * others writing history of their own. A century's retention and rows dated
 * before it keep every case to the rows it wrote itself: nothing else in the
 * suite is that old.
 */
const CENTURY_DAYS = 36_500;
const ancient = (day: number) => new Date(Date.UTC(1920, 0, day));
const keptDate = new Date(Date.UTC(1990, 0, 1));

async function mkActivity(createdAt: Date): Promise<number> {
  const [row] = await db
    .insert(activity)
    .values({
      projectId: suite.projectId,
      entityType: "track",
      entityId: 1,
      action: "created",
      createdAt,
    })
    .returning({ id: activity.id });
  return row!.id;
}

async function mkSave(sessionId: number, fileUpdatedAt: Date): Promise<number> {
  const [row] = await db
    .insert(saves)
    .values({
      sessionId,
      projectId: suite.projectId,
      fileUpdatedAt,
      source: "scan",
    })
    .returning({ id: saves.id });
  return row!.id;
}

const remainingActivity = async (ids: number[]) =>
  (
    await db
      .select({ id: activity.id })
      .from(activity)
      .where(inArray(activity.id, ids))
  ).map((row) => row.id);

const remainingSaves = async (ids: number[]) =>
  (
    await db
      .select({ id: saves.id })
      .from(saves)
      .where(inArray(saves.id, ids))
      .orderBy(saves.id)
  ).map((row) => row.id);

afterEach(() => {
  restoreInstancePolicy();
  mock.restore();
});

describe("sweepRetention", () => {
  it("keeps every row while the instance sets no retention", async () => {
    requireProject();
    const old = await mkActivity(ancient(1));

    expect(await sweepRetention()).toBeNull();
    expect(await remainingActivity([old])).toEqual([old]);
  });

  it("deletes activity older than the retention and keeps the rest", async () => {
    requireProject();
    const oldActivity = [
      await mkActivity(ancient(1)),
      await mkActivity(ancient(2)),
    ];
    const keptActivity = await mkActivity(keptDate);

    stubInstancePolicy({ jobs: { activityRetentionDays: CENTURY_DAYS } });
    const swept = await sweepRetention();

    expect(swept?.activity).toBeGreaterThanOrEqual(2);
    expect(await remainingActivity([...oldActivity, keptActivity])).toEqual([
      keptActivity,
    ]);
  });

  it("saves survive activity retention", async () => {
    requireProject();
    const session = await mkSession();
    const oldSaves = [
      await mkSave(session.id, ancient(1)),
      await mkSave(session.id, ancient(2)),
    ];
    const keptSave = await mkSave(session.id, keptDate);

    stubInstancePolicy({ jobs: { activityRetentionDays: CENTURY_DAYS } });
    await sweepRetention();

    expect(await remainingSaves([...oldSaves, keptSave])).toEqual([
      ...oldSaves,
      keptSave,
    ]);
  });

  it("deletes in bounded batches rather than one statement", async () => {
    requireProject();
    const old: number[] = [];
    for (let day = 1; day <= 5; day++) old.push(await mkActivity(ancient(day)));

    stubInstancePolicy({ jobs: { activityRetentionDays: CENTURY_DAYS } });
    const deletes = spyOn(db, "delete");
    await sweepRetention(2);

    expect(await remainingActivity(old)).toEqual([]);
    // Two, two and one: at least three statements for five rows, more if an
    // earlier case left an old row of its own behind.
    const activityDeletes = deletes.mock.calls.filter(
      ([table]) => table === activity
    );
    expect(activityDeletes.length).toBeGreaterThanOrEqual(3);
  });
});

describe("startRetentionSweeper", () => {
  it("sweeps at boot, then daily, and at once when the retention changes", () => {
    jest.useFakeTimers();
    const sweep = mock(async () => null);
    const stop = startRetentionSweeper(sweep);
    try {
      expect(sweep).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(24 * 60 * 60 * 1000);
      expect(sweep).toHaveBeenCalledTimes(2);

      stubInstancePolicy({ jobs: { activityRetentionDays: 90 } });
      expect(sweep).toHaveBeenCalledTimes(3);
    } finally {
      stop();
      jest.useRealTimers();
    }
  });
});
