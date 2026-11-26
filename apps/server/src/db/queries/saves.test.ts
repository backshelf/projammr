import { beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { setupSuite } from "../../test/fixtures.js";
import { db } from "../index.js";
import { tracks } from "../schema/tracks.js";
import { getProjectSaves, recordRevisions } from "./saves.js";

const suite = setupSuite("Session saves");
const { mkTrack, mkSession } = suite;

const OLD = new Date("2026-03-01T00:00:00.000Z");
const RECENT = new Date("2026-03-10T00:00:00.000Z");
const SINCE = new Date("2026-03-05T00:00:00.000Z");

let liveSessionId: number;
let archivedSessionId: number;
let trackLessSessionId: number;

async function save(sessionId: number, fileUpdatedAt: Date) {
  await recordRevisions([
    { sessionId, projectId: suite.projectId, fileUpdatedAt, source: "scan" },
  ]);
}

const feedResult = (
  options: { since?: Date; liveTracksOnly?: boolean; limit?: number } = {}
) =>
  getProjectSaves(suite.projectId, {
    limit: 50,
    tz: "UTC",
    ...options,
  });

const feed = async (options: { since?: Date; liveTracksOnly?: boolean } = {}) =>
  (await feedResult(options)).saves;

const sessionIds = (rows: { session: { id: number } }[]) =>
  rows.map((row) => row.session.id).sort((a, b) => a - b);

beforeAll(async () => {
  if (suite.setUpFailed) return;

  const liveTrack = await mkTrack("Live");
  const archivedTrack = await mkTrack("Archived");
  await db
    .update(tracks)
    .set({ archivedAt: new Date() })
    .where(eq(tracks.id, archivedTrack));

  liveSessionId = (await mkSession({ trackId: liveTrack })).id;
  archivedSessionId = (await mkSession({ trackId: archivedTrack })).id;
  trackLessSessionId = (await mkSession()).id;

  await save(liveSessionId, OLD);
  await save(liveSessionId, RECENT);
  await save(archivedSessionId, RECENT);
  await save(trackLessSessionId, RECENT);
});

describe("getProjectSaves", () => {
  it("returns every save when neither option is given", async () => {
    suite.requireProject();
    const rows = await feed();
    expect(rows).toHaveLength(4);
  });

  it("leaves out a save older than `since`", async () => {
    suite.requireProject();
    const rows = await feed({ since: SINCE });
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.fileUpdatedAt >= SINCE)).toBe(true);
  });

  it("answers an empty list for a `since` in the future", async () => {
    suite.requireProject();
    expect(await feed({ since: new Date("2999-01-01T00:00:00Z") })).toEqual([]);
  });

  it("counts every matching save in `total`, past the limit", async () => {
    suite.requireProject();
    const { saves, total } = await feedResult({
      since: SINCE,
      limit: 1,
    });
    expect(saves).toHaveLength(1);
    expect(total).toBe(3);
    expect(saves[0]).not.toHaveProperty("total");
  });

  it("answers a `total` of 0 for a `since` in the future", async () => {
    suite.requireProject();
    const result = await feedResult({
      since: new Date("2999-01-01T00:00:00Z"),
    });
    expect(result).toEqual({ saves: [], total: 0 });
  });

  it("leaves out an archived track's session with `liveTracksOnly`", async () => {
    suite.requireProject();
    const rows = await feed({ liveTracksOnly: true });
    expect(sessionIds(rows)).not.toContain(archivedSessionId);
    expect(sessionIds(rows)).toContain(liveSessionId);
  });

  it("keeps a track-less session's saves with `liveTracksOnly`", async () => {
    suite.requireProject();
    const rows = await feed({ liveTracksOnly: true });
    expect(sessionIds(rows)).toContain(trackLessSessionId);
  });
});
