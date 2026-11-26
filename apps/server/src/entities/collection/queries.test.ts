import { asc, eq } from "drizzle-orm";
import pg from "pg";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  spyOn,
} from "bun:test";
import { db } from "../../db/index.js";
import { users } from "../../db/schema/auth.js";
import { collections, collectionTracks } from "../../db/schema/collections.js";
import { projects } from "../../db/schema/projects.js";
import { tracks } from "../../db/schema/tracks.js";
import { seedScale } from "../../test/priority.js";
import { updateTrackNumberInCollection } from "./queries.js";

/**
 * One seeded project holds the collection under test; `afterAll` drops the
 * project and the cascade takes the collection, its tracks and the
 * memberships with it.
 */
let projectId: number;
let priorityId: number;
let collectionId: number;
let trackIds: number[];
let actorId: string;

const TRACK_COUNT = 5;

beforeAll(async () => {
  actorId = `numbering-actor-${Date.now()}`;
  await db.insert(users).values({
    id: actorId,
    name: "Numbering Actor",
    email: `${actorId}@example.com`,
  });

  const [project] = await db
    .insert(projects)
    .values({ name: `Collection Numbering Test ${Date.now()}` })
    .returning({ id: projects.id });
  projectId = project!.id;
  priorityId = await seedScale(projectId);

  const [collection] = await db
    .insert(collections)
    .values({ title: "Numbering", projectId, priorityId })
    .returning({ id: collections.id });
  collectionId = collection!.id;

  const inserted = await db
    .insert(tracks)
    .values(
      Array.from({ length: TRACK_COUNT }, (_, i) => ({
        title: `Track ${i + 1}`,
        artists: [],
        projectId,
        priorityId,
      }))
    )
    .returning({ id: tracks.id });
  trackIds = inserted.map((t) => t.id);
});

afterAll(async () => {
  await db.delete(projects).where(eq(projects.id, projectId));
  await db.delete(users).where(eq(users.id, actorId));
});

/** The collection's numbering as `trackId -> trackNumber`. */
async function currentNumbering() {
  const rows = await db
    .select({
      trackId: collectionTracks.trackId,
      trackNumber: collectionTracks.trackNumber,
    })
    .from(collectionTracks)
    .where(eq(collectionTracks.collectionId, collectionId))
    .orderBy(asc(collectionTracks.trackId));
  return new Map(rows.map((r) => [r.trackId, r.trackNumber]));
}

/** Seeds the memberships back to 1..n in `trackIds` order. */
async function resetNumbering() {
  await db
    .delete(collectionTracks)
    .where(eq(collectionTracks.collectionId, collectionId));
  await db.insert(collectionTracks).values(
    trackIds.map((trackId, i) => ({
      collectionId,
      trackId,
      trackNumber: i + 1,
    }))
  );
}

/**
 * Statements naming `collection_tracks`, as seen at the driver. The work runs
 * in a transaction on a pooled client, so the count is taken from
 * `Client.prototype.query` rather than the pool's own helper, and `BEGIN` /
 * `COMMIT` are filtered out by the table name.
 */
function countMembershipStatements(calls: unknown[][]) {
  return calls.filter((call) => {
    const arg = call[0] as string | { text?: string };
    const text = typeof arg === "string" ? arg : arg?.text;
    return typeof text === "string" && text.includes("collection_tracks");
  }).length;
}

beforeEach(async () => {
  await resetNumbering();
});

describe("updateTrackNumberInCollection", () => {
  it("swaps with whichever track already holds the number", async () => {
    const [first, , third] = trackIds as [number, number, number];

    await updateTrackNumberInCollection(collectionId, first, 3, actorId);

    const numbering = await currentNumbering();
    expect(numbering.get(first)).toBe(3);
    expect(numbering.get(third)).toBe(1);
  });

  it("leaves every other membership on its own number", async () => {
    const [first, second] = trackIds as [number, number];

    await updateTrackNumberInCollection(collectionId, first, 2, actorId);

    const numbering = await currentNumbering();
    expect(numbering.get(first)).toBe(2);
    expect(numbering.get(second)).toBe(1);
    for (let i = 2; i < TRACK_COUNT; i++) {
      expect(numbering.get(trackIds[i]!)).toBe(i + 1);
    }
  });

  it("renumbers in a bounded number of statements, not one per membership", async () => {
    const querySpy = spyOn(pg.Client.prototype, "query");
    querySpy.mockClear();

    await updateTrackNumberInCollection(collectionId, trackIds[0]!, 4, actorId);

    // The locking read, the clear, the set-assign and the read-back.
    expect(countMembershipStatements(querySpy.mock.calls)).toBeLessThanOrEqual(
      4
    );
    querySpy.mockRestore();
  });

  it("composes concurrent moves instead of losing one of them", async () => {
    const [first, second, third, fourth, fifth] = trackIds as [
      number,
      number,
      number,
      number,
      number,
    ];

    // Disjoint swaps: {first,second} and {fifth,fourth}. Without the FOR
    // UPDATE lock the second transaction builds its numbering from a snapshot
    // taken before the first committed, and silently reverts that pair.
    await Promise.all([
      updateTrackNumberInCollection(collectionId, first, 2, actorId),
      updateTrackNumberInCollection(collectionId, fifth, 4, actorId),
    ]);

    const numbering = await currentNumbering();
    expect(numbering.get(first)).toBe(2);
    expect(numbering.get(second)).toBe(1);
    expect(numbering.get(third)).toBe(3);
    expect(numbering.get(fourth)).toBe(5);
    expect(numbering.get(fifth)).toBe(4);

    // Still a dense 1..n numbering.
    const numbers = [...numbering.values()].sort((a, b) => a! - b!);
    expect(numbers).toEqual(
      Array.from({ length: TRACK_COUNT }, (_, i) => i + 1)
    );
  });

  it("404s for a track that is not in the collection", async () => {
    const [absent] = await db
      .insert(tracks)
      .values({ title: "Not a member", artists: [], projectId, priorityId })
      .returning({ id: tracks.id });

    await expect(
      updateTrackNumberInCollection(collectionId, absent!.id, 1, actorId)
    ).rejects.toMatchObject({ status: 404 });
  });
});
