import { and, eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "bun:test";
import { db } from "../../db/index.js";
import { recordRevisions } from "../../db/queries/saves.js";
import { withDefaultLevel } from "../../db/queries/priority-levels.js";
import { samplesForSessions } from "../../db/queries/session-samples.js";
import { collectionTracks } from "../../db/schema/collections.js";
import type { SessionSample } from "../../db/schema/samples.js";
import { entityLabels, labels } from "../../db/schema/labels.js";
import { projects } from "../../db/schema/projects.js";
import { saves } from "../../db/schema/saves.js";
import { type NewSession, sessions } from "../../db/schema/sessions.js";
import { setupSuite } from "../../test/fixtures.js";
import { seedScale } from "../../test/priority.js";
import { updateSession } from "./queries.js";

/**
 * Every test needs a project to hang its sessions off; `afterAll` drops the
 * seeded projects and the cascade takes the sessions and their saves
 * with them.
 */
const seededProjects: number[] = [];

const kick: SessionSample = {
  path: "/samples/kick.wav",
  kind: "project",
  status: "present",
};
const snare: SessionSample = {
  path: "/samples/snare.wav",
  kind: "library",
  status: "unknown",
};

let uniqueCounter = 0;
const unique = (label: string) =>
  `${label} ${Date.now()}-${uniqueCounter++}-${Math.random()
    .toString(36)
    .slice(2, 6)}`;

async function seedProject(): Promise<number> {
  const [project] = await db
    .insert(projects)
    .values({ name: unique("Saves Project") })
    .returning({ id: projects.id });
  const id = project!.id;
  seededProjects.push(id);
  await seedScale(id);
  return id;
}

async function seedSession(
  projectId: number,
  overrides: Partial<NewSession> = {}
): Promise<number> {
  const [row] = await db
    .insert(sessions)
    .values(
      await withDefaultLevel({
        name: unique("Session"),
        daw: "ableton",
        projectId,
        ...overrides,
      })
    )
    .returning({ id: sessions.id });
  return row!.id;
}

const savesFor = (sessionId: number) =>
  db.select().from(saves).where(eq(saves.sessionId, sessionId));

afterAll(async () => {
  if (seededProjects.length > 0) {
    await db.delete(projects).where(inArray(projects.id, seededProjects));
  }
});

describe("updateSession", () => {
  it("records one save when the patch carries a new localFileUpdatedAt", async () => {
    const projectId = await seedProject();
    const sessionId = await seedSession(projectId);

    await updateSession(sessionId, { localFileUpdatedAt: new Date() });

    expect(await savesFor(sessionId)).toHaveLength(1);
  });

  it("records no additional save when the patch repeats the same localFileUpdatedAt", async () => {
    const projectId = await seedProject();
    const sessionId = await seedSession(projectId);
    const localFileUpdatedAt = new Date();

    await updateSession(sessionId, { localFileUpdatedAt });
    expect(await savesFor(sessionId)).toHaveLength(1);

    await updateSession(sessionId, { localFileUpdatedAt });

    expect(await savesFor(sessionId)).toHaveLength(1);
  });

  it("marks a patch carrying DAW fields as a scan", async () => {
    const projectId = await seedProject();
    const sessionId = await seedSession(projectId);

    await updateSession(sessionId, {
      localFileUpdatedAt: new Date(),
      tempo: "128",
    });

    const [save] = await savesFor(sessionId);
    expect(save?.source).toBe("scan");
  });

  it("marks a patch carrying only the file time as an in-app save", async () => {
    const projectId = await seedProject();
    const sessionId = await seedSession(projectId);

    await updateSession(sessionId, { localFileUpdatedAt: new Date() });

    const [save] = await savesFor(sessionId);
    expect(save?.source).toBe("app");
  });

  it("records no save when the patch carries no localFileUpdatedAt", async () => {
    const projectId = await seedProject();
    const sessionId = await seedSession(projectId);

    await updateSession(sessionId, { name: unique("Renamed") });

    expect(await savesFor(sessionId)).toHaveLength(0);
  });

  it("copies the sample rows' paths, in position order, into a new save's meta", async () => {
    const projectId = await seedProject();
    const sessionId = await seedSession(projectId);

    await updateSession(sessionId, {
      localFileUpdatedAt: new Date(),
      samples: [snare, kick],
    });

    const [save] = await savesFor(sessionId);
    expect(save?.meta?.samplePaths).toEqual([snare.path, kick.path]);
  });

  it("copies the existing rows' paths when the patch carries no samples", async () => {
    const projectId = await seedProject();
    const sessionId = await seedSession(projectId);
    await updateSession(sessionId, { samples: [kick] });

    await updateSession(sessionId, { localFileUpdatedAt: new Date() });

    const [save] = await savesFor(sessionId);
    expect(save?.meta?.samplePaths).toEqual([kick.path]);
    expect(save?.source).toBe("app");
  });

  it("deletes the rows on null samples and records an empty path list", async () => {
    const projectId = await seedProject();
    const sessionId = await seedSession(projectId);
    await updateSession(sessionId, { samples: [kick] });

    await updateSession(sessionId, {
      localFileUpdatedAt: new Date(),
      samples: null,
    });

    expect(
      (await samplesForSessions([sessionId])).get(sessionId)
    ).toBeUndefined();
    const [save] = await savesFor(sessionId);
    expect(save?.meta?.samplePaths).toEqual([]);
  });

  it("marks a patch carrying samples as a scan", async () => {
    const projectId = await seedProject();
    const sessionId = await seedSession(projectId);

    await updateSession(sessionId, {
      localFileUpdatedAt: new Date(),
      samples: [kick],
    });

    const [save] = await savesFor(sessionId);
    expect(save?.source).toBe("scan");
  });

  it("leaves no row update, sample rows or save when a write inside the patch fails", async () => {
    const projectId = await seedProject();
    const name = unique("Untouched");
    const sessionId = await seedSession(projectId, { name });
    await updateSession(sessionId, { samples: [kick] });

    await expect(
      updateSession(sessionId, {
        name: unique("Renamed"),
        localFileUpdatedAt: new Date(),
        // Postgres refuses a NUL byte in text, after the row update ran.
        samples: [{ ...snare, path: "/samples/\u0000.wav" }],
      })
    ).rejects.toThrow();

    const [row] = await db
      .select({ name: sessions.name })
      .from(sessions)
      .where(eq(sessions.id, sessionId));
    expect(row?.name).toBe(name);
    expect((await samplesForSessions([sessionId])).get(sessionId)).toEqual([
      kick,
    ]);
    expect(await savesFor(sessionId)).toHaveLength(0);
  });
});

describe("session save routes", () => {
  const suite = setupSuite("Session Saves Routes");
  const { requireProject, request, mkSession, mkTrack, mkCollection } = suite;

  /** Records one save against a session, by the path the session was made with. */
  async function observe(localFilepath: string, at: number) {
    const [session] = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(
        and(
          eq(sessions.projectId, suite.projectId),
          eq(sessions.localFilepath, localFilepath)
        )
      );
    const stored = await recordRevisions([
      {
        sessionId: session!.id,
        projectId: suite.projectId,
        fileUpdatedAt: new Date(at),
        source: "scan",
      },
    ]);
    expect(stored).toBe(1);
  }

  /** The save count the heatmap reports for `day` under the given filters. */
  async function heatmapCount(query: string, day: string) {
    const from = Date.UTC(2026, 3, 1);
    const to = Date.UTC(2026, 3, 30);
    const res = await request(
      "viewer",
      `/projects/${suite.projectId}/heatmap?from=${from}&to=${to}&tz=UTC&${query}`
    );
    expect(res.status).toBe(200);
    const days = (await res.json()) as { day: string; saves: number }[];
    return days.find((d) => d.day === day)?.saves ?? 0;
  }

  it("lets a viewer read a session's saves and refuses an outsider", async () => {
    requireProject();
    const session = await mkSession({ localFilepath: unique("/mix/b.als") });

    const viewerRes = await request("viewer", `/sessions/${session.id}/saves`);
    expect(viewerRes.status).toBe(200);
    expect(await viewerRes.json()).toEqual([]);

    const outsiderRes = await request(
      "outsider",
      `/sessions/${session.id}/saves`
    );
    expect(outsiderRes.status).toBe(404);
  });

  it("buckets a 23:30 UTC save into the next day under Australia/Sydney but the same day under UTC", async () => {
    requireProject();

    const localFilepath = unique("/mix/heatmap.als");
    await mkSession({ name: "Heatmap Session", localFilepath });

    const saveAt = Date.UTC(2026, 0, 15, 23, 30, 0);
    await observe(localFilepath, saveAt);

    const from = Date.UTC(2026, 0, 15, 0, 0, 0);
    const to = Date.UTC(2026, 0, 17, 0, 0, 0);

    const utcRes = await request(
      "viewer",
      `/projects/${suite.projectId}/heatmap?from=${from}&to=${to}&tz=UTC`
    );
    expect(utcRes.status).toBe(200);
    const utcDays = (await utcRes.json()) as {
      day: string;
      saves: number;
    }[];
    expect(utcDays.find((d) => d.day === "2026-01-15")?.saves).toBe(1);
    expect(utcDays.find((d) => d.day === "2026-01-16")).toBeUndefined();

    const sydneyRes = await request(
      "viewer",
      `/projects/${suite.projectId}/heatmap?from=${from}&to=${to}&tz=Australia/Sydney`
    );
    expect(sydneyRes.status).toBe(200);
    const sydneyDays = (await sydneyRes.json()) as {
      day: string;
      saves: number;
    }[];
    expect(sydneyDays.find((d) => d.day === "2026-01-16")?.saves).toBe(1);
    expect(sydneyDays.find((d) => d.day === "2026-01-15")).toBeUndefined();
  });

  it("counts a member's projects on the cross-project heatmap", async () => {
    requireProject();

    const localFilepath = unique("/mix/me.als");
    await mkSession({ name: "Me Heatmap", localFilepath });

    const saveAt = Date.UTC(2026, 2, 3, 10, 0, 0);
    await observe(localFilepath, saveAt);

    const from = Date.UTC(2026, 2, 1, 0, 0, 0);
    const to = Date.UTC(2026, 2, 5, 0, 0, 0);
    const res = await request(
      "viewer",
      `/me/heatmap?from=${from}&to=${to}&tz=UTC`
    );

    expect(res.status).toBe(200);
    const days = (await res.json()) as {
      day: string;
      saves: number;
      projects: number;
    }[];
    expect(days.find((d) => d.day === "2026-03-03")).toMatchObject({
      saves: 1,
      projects: 1,
    });
  });

  it("narrows to sessions on tracks in one collection", async () => {
    requireProject();

    const inCollection = unique("/mix/in-coll.als");
    const outside = unique("/mix/out-coll.als");
    const trackId = await mkTrack(unique("Collected"));
    const collectionId = await mkCollection(unique("A Collection"));
    await db.insert(collectionTracks).values({ collectionId, trackId });

    await mkSession({ name: "In", localFilepath: inCollection, trackId });
    await mkSession({ name: "Out", localFilepath: outside });

    const at = Date.UTC(2026, 3, 10, 12, 0, 0);
    await observe(inCollection, at);
    await observe(outside, at);

    expect(await heatmapCount("", "2026-04-10")).toBe(2);
    expect(
      await heatmapCount(`collectionId=${collectionId}`, "2026-04-10")
    ).toBe(1);
  });

  it("narrows to sessions carrying one label", async () => {
    requireProject();

    const labelled = unique("/mix/labelled.als");
    const plain = unique("/mix/plain.als");
    const session = await mkSession({
      name: "Tagged",
      localFilepath: labelled,
    });
    await mkSession({ name: "Untagged", localFilepath: plain });

    const [label] = await db
      .insert(labels)
      .values({ name: unique("needs vocals"), projectId: suite.projectId })
      .returning({ id: labels.id });
    await db.insert(entityLabels).values({
      labelId: label!.id,
      entityType: "session",
      entityId: session.id,
    });

    const at = Date.UTC(2026, 3, 11, 12, 0, 0);
    await observe(labelled, at);
    await observe(plain, at);

    expect(await heatmapCount("", "2026-04-11")).toBe(2);
    expect(await heatmapCount(`labelId=${label!.id}`, "2026-04-11")).toBe(1);
  });

  it("narrows to one DAW", async () => {
    requireProject();

    const ableton = unique("/mix/live.als");
    const logic = unique("/mix/logic.logicx");
    await mkSession({ name: "Live", localFilepath: ableton, daw: "ableton" });
    await mkSession({ name: "Logic", localFilepath: logic, daw: "logic-pro" });

    const at = Date.UTC(2026, 3, 12, 12, 0, 0);
    await observe(ableton, at);
    await observe(logic, at);

    expect(await heatmapCount("", "2026-04-12")).toBe(2);
    expect(await heatmapCount("daw=logic-pro", "2026-04-12")).toBe(1);
  });

  it("combines filters rather than widening on each one", async () => {
    requireProject();

    const both = unique("/mix/both.als");
    const trackOnly = unique("/mix/track-only.als");
    const trackId = await mkTrack(unique("Filtered"));
    await mkSession({
      name: "Both",
      localFilepath: both,
      trackId,
      daw: "ableton",
    });
    await mkSession({
      name: "Track only",
      localFilepath: trackOnly,
      trackId,
      daw: "logic-pro",
    });

    const at = Date.UTC(2026, 3, 13, 12, 0, 0);
    await observe(both, at);
    await observe(trackOnly, at);

    expect(await heatmapCount(`trackId=${trackId}`, "2026-04-13")).toBe(2);
    expect(
      await heatmapCount(`trackId=${trackId}&daw=ableton`, "2026-04-13")
    ).toBe(1);
  });

  it("rejects an unknown time zone with 400", async () => {
    requireProject();
    const res = await request(
      "viewer",
      `/projects/${suite.projectId}/heatmap?from=0&to=1&tz=Not/AZone`
    );
    expect(res.status).toBe(400);
  });
});
