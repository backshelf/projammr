import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { getSessionsByDevice } from "../../entities/session/queries.js";
import { getQuietTracks } from "../../entities/track/queries.js";
import {
  adoptNewSet,
  commitPayload,
  objectsOf,
  pushCommits,
  pushSaves,
  pushSegments,
  savePayload,
  trackSeeds,
} from "../../test/dit-history.js";
import { setupSuite } from "../../test/fixtures.js";
import { db } from "../index.js";
import { activity } from "../schema/activity.js";
import { authSessions } from "../schema/auth.js";
import { sessions } from "../schema/sessions.js";
import { saves } from "../schema/saves.js";
import { bouncedFromOf } from "./track-audios.js";
import { timeInSetCoveredBy } from "./segments.js";
import { tracks } from "../schema/tracks.js";
import { getInstanceUser } from "./instance-users.js";
import { withDefaultLevel } from "./priority-levels.js";
import { getProjectsForUser } from "./user.js";

/*
 * Timestamp columns are `timestamp without time zone` holding UTC. A read
 * through a raw `sql` expression skips drizzle's own decoding, so the value
 * has to be decoded on purpose: parsed as a local time it lands hours away from
 * the stored instant in any process zone but UTC. Each read below runs with the
 * process zone east of UTC and must still answer the instant that was stored.
 */

const suite = setupSuite("Timestamp zone");
const { throwawayProject, requireProject, owner } = suite;
const { seedObjects, removeSeeded } = trackSeeds();

const STORED = new Date("2026-03-01T01:02:03.000Z");
const ZONE = "Australia/Sydney";

let originalTz: string | undefined;

beforeAll(() => {
  originalTz = process.env.TZ;
  process.env.TZ = ZONE;
});

afterAll(removeSeeded);

afterAll(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

describe("timestamps read through raw sql", () => {
  it("runs the process east of UTC", () => {
    // The naive parse of the stored wall time is ten or eleven hours off.
    expect(new Date("2026-03-01 01:02:03").getTime()).not.toBe(
      STORED.getTime()
    );
  });

  it("reads a project's lastActivityAt as the stored instant", async () => {
    const { id, owner } = await throwawayProject("ZoneActivity");
    await db.delete(activity).where(eq(activity.projectId, id));
    await db.insert(activity).values({
      projectId: id,
      entityType: "project",
      entityId: id,
      userId: owner.userId,
      action: "created",
      createdAt: STORED,
    });

    const projects = await getProjectsForUser(owner.userId);

    expect(projects.find((p) => p.id === id)?.lastActivityAt).toEqual(STORED);
  });

  it("reads an account's lastSeenAt as the stored instant", async () => {
    const { owner } = await throwawayProject("ZoneSeen");
    await db
      .update(authSessions)
      .set({ updatedAt: STORED })
      .where(eq(authSessions.userId, owner.userId));

    const account = await getInstanceUser(owner.userId);

    expect(account.lastSeenAt).toEqual(STORED);
  });

  it("reads a session's updatedAt as the stored instant", async () => {
    const { id } = await throwawayProject("ZoneDevice");
    await db.insert(sessions).values(
      await withDefaultLevel({
        name: "Zone session",
        daw: "ableton",
        projectId: id,
        updatedAt: STORED,
        structure: {
          tracks: [
            { kind: "audio" as const, name: "Verse", devices: ["Zone Synth"] },
          ],
        },
      })
    );

    const found = await getSessionsByDevice(id, "Zone Synth");

    expect(found.map((s) => s.updatedAt)).toEqual([STORED]);
  });

  it("reads a quiet track's lastTouchedAt as the stored instant", async () => {
    const { id } = await throwawayProject("ZoneQuiet");
    const [track] = await db
      .insert(tracks)
      .values(
        await withDefaultLevel({
          title: "Zone track",
          artists: [],
          projectId: id,
        })
      )
      .returning({ id: tracks.id });
    await db
      .update(tracks)
      .set({ updatedAt: STORED })
      .where(eq(tracks.id, track!.id));

    const { tracks: quiet } = await getQuietTracks(id, {
      before: new Date("2026-04-01T00:00:00.000Z"),
      limit: 10,
    });

    expect(quiet.map((t) => t.lastTouchedAt)).toEqual([STORED]);
  });

  it("compares a quiet track against the stored instant of its cutoff", async () => {
    const { id } = await throwawayProject("ZoneQuietCutoff");
    const [track] = await db
      .insert(tracks)
      .values(
        await withDefaultLevel({
          title: "Zone cutoff track",
          artists: [],
          projectId: id,
        })
      )
      .returning({ id: tracks.id });
    await db
      .update(tracks)
      .set({ updatedAt: STORED })
      .where(eq(tracks.id, track!.id));

    // Touched five hours after the cutoff: read as local time, the cutoff
    // would land ten or eleven hours later and list the track as quiet.
    const { tracks: quiet, total } = await getQuietTracks(id, {
      before: new Date(STORED.getTime() - 5 * 60 * 60 * 1000),
      limit: 10,
    });

    expect(quiet).toEqual([]);
    expect(total).toBe(0);
  });

  it("reads the save and commit a render was bounced from as the stored instants", async () => {
    requireProject();
    const set = await adoptNewSet(suite, "ZoneBounce");
    const save = savePayload("zone-bounce", STORED.getTime());
    await seedObjects(set.repoId, owner.userId, objectsOf(save));
    await pushSaves(suite, set, "main", [save]);
    const commit = commitPayload("zone-bounce", null, [save]);
    expect((await pushCommits(suite, set, "main", [commit])).status).toBe(201);
    const [row] = await db
      .select({ id: saves.id })
      .from(saves)
      .where(eq(saves.hash, save.hash));

    const bounced = (await bouncedFromOf([row!.id])).get(row!.id);

    expect(bounced?.savedAt).toEqual(STORED);
    expect(bounced?.commit?.committedAt).toEqual(
      new Date(STORED.getTime() + 1)
    );
  });

  it("measures time in the set the same in any zone", async () => {
    requireProject();
    const set = await adoptNewSet(suite, "ZoneTime");
    const first = savePayload("zone-time-1", STORED.getTime());
    const second = savePayload("zone-time-2", STORED.getTime() + 600_000);
    await seedObjects(set.repoId, owner.userId, [
      ...objectsOf(first),
      ...objectsOf(second),
    ]);
    await pushSaves(suite, set, "main", [first, second]);
    const one = commitPayload("zone-time-1", null, [first]);
    const two = commitPayload("zone-time-2", one.hash, [second]);
    await pushCommits(suite, set, "main", [one, two]);
    await pushSegments(suite, set, [
      {
        branch: "main",
        machineName: "studio",
        startedAt: STORED.getTime() + 120_000,
        endedAt: STORED.getTime() + 420_000,
        source: "script",
      },
    ]);
    const ids = await db.execute<{ id: number; hash: string }>(
      sql`select id, hash from commits where hash in (${one.hash}, ${two.hash})`
    );
    const byHash = new Map(ids.rows.map((r) => [r.hash, r.id]));

    const seconds = await timeInSetCoveredBy([...byHash.values()]);

    expect(seconds.get(byHash.get(two.hash)!)).toBe(300);
    expect(seconds.get(byHash.get(one.hash)!)).toBeUndefined();
  });
});
