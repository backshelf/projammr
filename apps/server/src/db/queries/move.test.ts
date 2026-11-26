import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db, type Tx } from "../index.js";
import { activity } from "../schema/activity.js";
import { assets } from "../schema/assets.js";
import {
  collectionAttachments,
  sessionAttachments,
  trackAttachments,
} from "../schema/attachments.js";
import { users } from "../schema/auth.js";
import { collections, collectionTracks } from "../schema/collections.js";
import { comments } from "../schema/comments.js";
import { entityLabels, labels } from "../schema/labels.js";
import { members, projects } from "../schema/projects.js";
import { repos } from "../schema/repos.js";
import { saves } from "../schema/saves.js";
import { sessionSamples } from "../schema/session-samples.js";
import { sessions } from "../schema/sessions.js";
import { statuses } from "../schema/statuses.js";
import { trackAudios, trackRelations, tracks } from "../schema/tracks.js";
import { newStorageKey, storedFilePath } from "../../lib/storage.js";
import { deleteProjectRow } from "../../entities/project/queries.js";
import {
  bulkMoveSessions,
  bulkUpdateSessions,
  createSession,
  updateSession,
} from "../../entities/session/queries.js";
import { withProjectPolicyForTest } from "./project-policy.js";
import { holdTransaction } from "../../test/held-transaction.js";
import { seedScale } from "../../test/priority.js";
import { adoptSet } from "./repos.js";
import { fieldKey, setValues } from "./custom-fields.js";
import { priorityLevels } from "../schema/priority-levels.js";
import {
  createPriorityLevel,
  updatePriorityLevel,
  withDefaultLevel,
} from "./priority-levels.js";
import {
  type CustomField,
  customFields,
  customFieldValues,
} from "../schema/custom-fields.js";
import {
  type DroppedField,
  moveCollectionToProject,
  moveEntities,
  moveSessionToProject,
  moveTrackToProject,
  previewMove,
} from "./move.js";
import {
  createRelationType,
  getRelationTypes,
  relationTypeByName,
  seedRelationTypes,
} from "./track-relation-types.js";

/**
 * The rule the move implements turns on what a row shares with the project it
 * is leaving, so every case needs two projects and a member who may write in
 * both. Each test seeds its own pair; `afterAll` drops them and the cascade
 * takes everything the test wrote with them.
 */
let actorId: string;
let outsiderId: string;
const seededProjects: number[] = [];

let uniqueCounter = 0;
const unique = (label: string) =>
  `${label} ${Date.now()}-${uniqueCounter++}-${Math.random()
    .toString(36)
    .slice(2, 6)}`;

async function seedUser(name: string): Promise<string> {
  const id = unique(name).replace(/[^a-zA-Z0-9]/g, "");
  await db.insert(users).values({
    id,
    name,
    email: `${id}@example.com`,
  });
  return id;
}

/** A project the actor is an editor in, registered for teardown. */
async function seedProject(label: string): Promise<number> {
  const [project] = await db
    .insert(projects)
    .values({ name: unique(label) })
    .returning({ id: projects.id });
  const id = project!.id;
  seededProjects.push(id);
  await seedScale(id);
  await seedRelationTypes(db, id);
  await db
    .insert(members)
    .values({ projectId: id, userId: actorId, role: "editor" });
  return id;
}

/** A project's relation type of this name. */
async function relationTypeId(projectId: number, name: string) {
  const type = await relationTypeByName(projectId, name);
  if (!type) throw new Error(`project ${projectId} has no type "${name}"`);
  return type.id;
}

/** A source and a target project, both writable by the actor. */
async function seedPair(): Promise<{ source: number; target: number }> {
  return {
    source: await seedProject("Move Source"),
    target: await seedProject("Move Target"),
  };
}

/** A project the actor can only view, for the "refused in the target" cases. */
async function seedViewerOnlyProject(label: string): Promise<number> {
  const [project] = await db
    .insert(projects)
    .values({ name: unique(label) })
    .returning({ id: projects.id });
  const id = project!.id;
  seededProjects.push(id);
  await seedScale(id);
  await db
    .insert(members)
    .values({ projectId: id, userId: actorId, role: "viewer" });
  return id;
}

async function seedTrack(
  projectId: number,
  title = "Track",
  priorityId?: number
): Promise<number> {
  const [row] = await db
    .insert(tracks)
    .values(
      await withDefaultLevel({
        title: unique(title),
        artists: [],
        projectId,
        priorityId,
      })
    )
    .returning({ id: tracks.id });
  return row!.id;
}

async function seedCollection(
  projectId: number,
  title = "Collection",
  priorityId?: number
): Promise<number> {
  const [row] = await db
    .insert(collections)
    .values(
      await withDefaultLevel({ title: unique(title), projectId, priorityId })
    )
    .returning({ id: collections.id });
  return row!.id;
}

async function seedSession(
  projectId: number,
  trackId: number | null = null,
  priorityId?: number
): Promise<number> {
  const [row] = await db
    .insert(sessions)
    .values(
      await withDefaultLevel({
        name: unique("Session"),
        daw: "Ableton",
        projectId,
        trackId,
        priorityId,
      })
    )
    .returning({ id: sessions.id });
  return row!.id;
}

async function seedAsset(projectId: number): Promise<number> {
  const [row] = await db
    .insert(assets)
    .values({
      name: unique("Asset"),
      type: "audio/wav",
      size: 1,
      assetPath: `assets/${unique("path").replace(/[^a-zA-Z0-9]/g, "")}.wav`,
      projectId,
    })
    .returning({ id: assets.id });
  return row!.id;
}

async function seedStatus(
  projectId: number | null,
  name: string
): Promise<number> {
  const [row] = await db
    .insert(statuses)
    .values({ name, projectId, percentage: 50 })
    .returning({ id: statuses.id });
  return row!.id;
}

async function seedLabel(
  projectId: number,
  name: string,
  colourHex = "#123456"
): Promise<number> {
  const [row] = await db
    .insert(labels)
    .values({ projectId, name, colourHex })
    .returning({ id: labels.id });
  return row!.id;
}

const projectOfAsset = async (id: number) =>
  (
    await db
      .select({ projectId: assets.projectId })
      .from(assets)
      .where(eq(assets.id, id))
  )[0]?.projectId;

const projectOfTrack = async (id: number) =>
  (
    await db
      .select({ projectId: tracks.projectId })
      .from(tracks)
      .where(eq(tracks.id, id))
  )[0]?.projectId;

const trackAttachmentIds = async (trackId: number) =>
  (
    await db
      .select({ assetId: trackAttachments.assetId })
      .from(trackAttachments)
      .where(eq(trackAttachments.trackId, trackId))
  ).map((row) => row.assetId);

beforeAll(async () => {
  actorId = await seedUser("MoveActor");
  outsiderId = await seedUser("MoveOutsider");
});

afterAll(async () => {
  if (seededProjects.length > 0) {
    await db.transaction(async (tx) => {
      for (const projectId of seededProjects) {
        await deleteProjectRow(tx, projectId);
      }
    });
  }
  await db.delete(users).where(inArray(users.id, [actorId, outsiderId]));
});

describe("moving a track between projects", () => {
  it("carries the assets only it references and unlinks the shared ones", async () => {
    const { source, target } = await seedPair();
    const trackId = await seedTrack(source, "Exclusive Owner");
    const bystander = await seedTrack(source, "Bystander");

    const exclusive = await seedAsset(source);
    const shared = await seedAsset(source);
    await db.insert(trackAttachments).values([
      { trackId, assetId: exclusive },
      { trackId, assetId: shared },
      { trackId: bystander, assetId: shared },
    ]);

    await moveTrackToProject(trackId, target, actorId);

    expect(await projectOfTrack(trackId)).toBe(target);
    expect(await projectOfAsset(exclusive)).toBe(target);
    expect(await projectOfAsset(shared)).toBe(source);
    expect(await trackAttachmentIds(trackId)).toEqual([exclusive]);
  });

  it("takes its sessions and audios with it", async () => {
    const { source, target } = await seedPair();
    const trackId = await seedTrack(source);
    const sessionId = await seedSession(source, trackId);
    const audioAsset = await seedAsset(source);
    await db
      .insert(trackAudios)
      .values({ trackId, assetId: audioAsset, version: 1 });

    await moveTrackToProject(trackId, target, actorId);

    const [session] = await db
      .select({ projectId: sessions.projectId, trackId: sessions.trackId })
      .from(sessions)
      .where(eq(sessions.id, sessionId));
    expect(session).toEqual({ projectId: target, trackId });
    expect(await projectOfAsset(audioAsset)).toBe(target);
  });

  it("drops an audio whose asset the source project still uses elsewhere", async () => {
    const { source, target } = await seedPair();
    const trackId = await seedTrack(source);
    const bystander = await seedTrack(source, "Bystander");
    const shared = await seedAsset(source);
    const spectrogramKey = newStorageKey("analysis", "png");
    await Bun.write(storedFilePath(spectrogramKey), "png");

    await db
      .insert(trackAudios)
      .values({ trackId, assetId: shared, version: 1, spectrogramKey });
    await db
      .insert(trackAttachments)
      .values({ trackId: bystander, assetId: shared });

    await moveTrackToProject(trackId, target, actorId);

    expect(await projectOfAsset(shared)).toBe(source);
    const audios = await db
      .select()
      .from(trackAudios)
      .where(eq(trackAudios.trackId, trackId));
    expect(audios).toHaveLength(0);
    // The dropped version's spectrogram goes with it once the move commits.
    expect(await Bun.file(storedFilePath(spectrogramKey)).exists()).toBe(false);
  });

  it("leaves the collections it was in behind", async () => {
    const { source, target } = await seedPair();
    const trackId = await seedTrack(source);
    const collectionId = await seedCollection(source);
    await db.insert(collectionTracks).values({ collectionId, trackId });

    await moveTrackToProject(trackId, target, actorId);

    const memberships = await db
      .select()
      .from(collectionTracks)
      .where(eq(collectionTracks.trackId, trackId));
    expect(memberships).toHaveLength(0);
  });

  it("drops a relation to a track staying behind", async () => {
    const { source, target } = await seedPair();
    const moving = await seedTrack(source, "Moving");
    const staying = await seedTrack(source, "Staying");
    await db.insert(trackRelations).values({
      fromTrackId: moving,
      toTrackId: staying,
      relationTypeId: await relationTypeId(source, "remix"),
    });

    await moveTrackToProject(moving, target, actorId);

    const remaining = await db
      .select()
      .from(trackRelations)
      .where(eq(trackRelations.fromTrackId, moving));
    expect(remaining).toHaveLength(0);
  });

  it("keeps a relation between two tracks that move together, on the target's type of the same name", async () => {
    const { source, target } = await seedPair();
    const first = await seedTrack(source, "Pair A");
    const second = await seedTrack(source, "Pair B");
    const collectionId = await seedCollection(source);
    await db.insert(collectionTracks).values([
      { collectionId, trackId: first },
      { collectionId, trackId: second },
    ]);
    await db.insert(trackRelations).values([
      {
        fromTrackId: first,
        toTrackId: second,
        relationTypeId: await relationTypeId(source, "remix"),
      },
      {
        fromTrackId: second,
        toTrackId: first,
        relationTypeId: await relationTypeId(source, "live version"),
      },
    ]);
    const targetTypesBefore = await getRelationTypes(target);

    await moveCollectionToProject(collectionId, target, actorId);

    expect(await projectOfTrack(first)).toBe(target);
    expect(await projectOfTrack(second)).toBe(target);
    const remaining = await db
      .select({
        fromTrackId: trackRelations.fromTrackId,
        relationTypeId: trackRelations.relationTypeId,
      })
      .from(trackRelations)
      .where(inArray(trackRelations.fromTrackId, [first, second]))
      .orderBy(trackRelations.fromTrackId);
    expect(remaining).toEqual([
      {
        fromTrackId: first,
        relationTypeId: await relationTypeId(target, "remix"),
      },
      {
        fromTrackId: second,
        relationTypeId: await relationTypeId(target, "live version"),
      },
    ]);
    // The target already had both names, so its list is as it was.
    expect(
      (await getRelationTypes(target)).map(({ id, name, rank }) => ({
        id,
        name,
        rank,
      }))
    ).toEqual(
      targetTypesBefore.map(({ id, name, rank }) => ({ id, name, rank }))
    );
  });

  it("gives the target the types it has no name for, after its last, and leaves the source's alone", async () => {
    const { source, target } = await seedPair();
    const first = await seedTrack(source, "Sampled A");
    const second = await seedTrack(source, "Sampled B");
    const collectionId = await seedCollection(source);
    await db.insert(collectionTracks).values([
      { collectionId, trackId: first },
      { collectionId, trackId: second },
    ]);
    const sampled = await createRelationType(
      source,
      { name: "sampled in" },
      actorId
    );
    const quoted = await createRelationType(
      source,
      { name: "quoted in" },
      actorId
    );
    await db.insert(trackRelations).values([
      { fromTrackId: first, toTrackId: second, relationTypeId: quoted.id },
      { fromTrackId: second, toTrackId: first, relationTypeId: sampled.id },
    ]);

    await moveCollectionToProject(collectionId, target, actorId);

    const targetTypes = await getRelationTypes(target);
    expect(
      targetTypes.slice(-2).map(({ name, inUse }) => ({ name, inUse }))
    ).toEqual([
      { name: "sampled in", inUse: 1 },
      { name: "quoted in", inUse: 1 },
    ]);
    expect(targetTypes.at(-1)!.rank).toBeGreaterThan(targetTypes.at(-3)!.rank);
    const [moved] = await db
      .select({ relationTypeId: trackRelations.relationTypeId })
      .from(trackRelations)
      .where(eq(trackRelations.fromTrackId, first));
    expect(moved?.relationTypeId).toBe(
      await relationTypeId(target, "quoted in")
    );

    // The source keeps its own types, now unused.
    const sourceTypes = await getRelationTypes(source);
    expect(
      sourceTypes
        .filter((type) => type.id === sampled.id || type.id === quoted.id)
        .map((type) => type.inUse)
    ).toEqual([0, 0]);
  });

  it("carries its comments into the target project", async () => {
    const { source, target } = await seedPair();
    const trackId = await seedTrack(source);
    const [comment] = await db
      .insert(comments)
      .values({
        targetType: "track",
        targetId: trackId,
        projectId: source,
        content: "Needs more cowbell",
      })
      .returning({ id: comments.id });

    await moveTrackToProject(trackId, target, actorId);

    const [row] = await db
      .select({ projectId: comments.projectId })
      .from(comments)
      .where(eq(comments.id, comment!.id));
    expect(row?.projectId).toBe(target);
  });

  it("moves a track that owns nothing at all", async () => {
    const { source, target } = await seedPair();
    const trackId = await seedTrack(source, "Bare");

    await moveTrackToProject(trackId, target, actorId);

    expect(await projectOfTrack(trackId)).toBe(target);
  });
});

describe("moving a collection between projects", () => {
  it("takes the tracks it alone holds and leaves the shared ones", async () => {
    const { source, target } = await seedPair();
    const moving = await seedCollection(source, "Moving");
    const staying = await seedCollection(source, "Staying");
    const exclusive = await seedTrack(source, "Exclusive Track");
    const shared = await seedTrack(source, "Shared Track");

    await db.insert(collectionTracks).values([
      { collectionId: moving, trackId: exclusive },
      { collectionId: moving, trackId: shared },
      { collectionId: staying, trackId: shared },
    ]);

    await moveCollectionToProject(moving, target, actorId);

    expect(await projectOfTrack(exclusive)).toBe(target);
    expect(await projectOfTrack(shared)).toBe(source);

    const remaining = await db
      .select({ trackId: collectionTracks.trackId })
      .from(collectionTracks)
      .where(eq(collectionTracks.collectionId, moving));
    expect(remaining.map((row) => row.trackId)).toEqual([exclusive]);
  });

  it("unlinks an attachment the source project still uses", async () => {
    const { source, target } = await seedPair();
    const collectionId = await seedCollection(source);
    const bystander = await seedTrack(source, "Bystander");
    const shared = await seedAsset(source);

    await db.insert(collectionAttachments).values({
      collectionId,
      assetId: shared,
    });
    await db
      .insert(trackAttachments)
      .values({ trackId: bystander, assetId: shared });

    await moveCollectionToProject(collectionId, target, actorId);

    expect(await projectOfAsset(shared)).toBe(source);
    const remaining = await db
      .select()
      .from(collectionAttachments)
      .where(eq(collectionAttachments.collectionId, collectionId));
    expect(remaining).toHaveLength(0);
  });

  it("moves an empty collection", async () => {
    const { source, target } = await seedPair();
    const collectionId = await seedCollection(source, "Empty");

    await moveCollectionToProject(collectionId, target, actorId);

    const [row] = await db
      .select({ projectId: collections.projectId })
      .from(collections)
      .where(eq(collections.id, collectionId));
    expect(row?.projectId).toBe(target);
  });
});

describe("moving a session between projects", () => {
  it("clears the track link when the track stays behind", async () => {
    const { source, target } = await seedPair();
    const trackId = await seedTrack(source);
    const sessionId = await seedSession(source, trackId);

    await moveSessionToProject(sessionId, target, actorId);

    const [row] = await db
      .select({ projectId: sessions.projectId, trackId: sessions.trackId })
      .from(sessions)
      .where(eq(sessions.id, sessionId));
    expect(row).toEqual({ projectId: target, trackId: null });
    expect(await projectOfTrack(trackId)).toBe(source);
  });

  it("rewrites its saves' project_id", async () => {
    const { source, target } = await seedPair();
    const sessionId = await seedSession(source);
    const [save] = await db
      .insert(saves)
      .values({
        sessionId,
        projectId: source,
        fileUpdatedAt: new Date(),
        source: "scan",
      })
      .returning({ id: saves.id });

    await moveSessionToProject(sessionId, target, actorId);

    const [row] = await db
      .select({ projectId: saves.projectId })
      .from(saves)
      .where(eq(saves.id, save!.id));
    expect(row?.projectId).toBe(target);
  });

  it("rewrites its samples' project_id", async () => {
    const { source, target } = await seedPair();
    const sessionId = await seedSession(source);
    await db.insert(sessionSamples).values({
      sessionId,
      projectId: source,
      path: "Samples/kick.wav",
      kind: "project",
      status: "present",
      position: 0,
    });

    await moveSessionToProject(sessionId, target, actorId);

    const rows = await db
      .select({ projectId: sessionSamples.projectId })
      .from(sessionSamples)
      .where(eq(sessionSamples.sessionId, sessionId));
    expect(rows).toEqual([{ projectId: target }]);
  });

  it("carries an attachment nothing else references", async () => {
    const { source, target } = await seedPair();
    const sessionId = await seedSession(source);
    const exclusive = await seedAsset(source);
    const shared = await seedAsset(source);
    const bystander = await seedTrack(source, "Bystander");

    await db.insert(sessionAttachments).values([
      { sessionId, assetId: exclusive },
      { sessionId, assetId: shared },
    ]);
    await db
      .insert(trackAttachments)
      .values({ trackId: bystander, assetId: shared });

    await moveSessionToProject(sessionId, target, actorId);

    expect(await projectOfAsset(exclusive)).toBe(target);
    expect(await projectOfAsset(shared)).toBe(source);

    const remaining = await db
      .select({ assetId: sessionAttachments.assetId })
      .from(sessionAttachments)
      .where(eq(sessionAttachments.sessionId, sessionId));
    expect(remaining.map((row) => row.assetId)).toEqual([exclusive]);
  });
});

describe("moving many entities", () => {
  it("moves three tracks with exclusive and shared sessions, cascading each row", async () => {
    const { source, target } = await seedPair();
    const trackIds = [
      await seedTrack(source, "Bulk A"),
      await seedTrack(source, "Bulk B"),
      await seedTrack(source, "Bulk C"),
    ];
    const sessionIds = await Promise.all(
      trackIds.map((trackId) => seedSession(source, trackId))
    );
    const bystander = await seedTrack(source, "Bystander");
    const shared = await seedAsset(source);
    await db
      .insert(trackAttachments)
      .values(trackIds.map((trackId) => ({ trackId, assetId: shared })));
    await db
      .insert(trackAttachments)
      .values({ trackId: bystander, assetId: shared });

    const moved = await moveEntities(
      "track",
      trackIds,
      source,
      target,
      actorId
    );

    expect(moved.ids.sort((a, b) => a - b)).toEqual(
      [...trackIds].sort((a, b) => a - b)
    );
    for (const trackId of trackIds) {
      expect(await projectOfTrack(trackId)).toBe(target);
    }
    const sessionRows = await db
      .select({ projectId: sessions.projectId })
      .from(sessions)
      .where(inArray(sessions.id, sessionIds));
    for (const row of sessionRows) expect(row.projectId).toBe(target);
    // The asset is still referenced by the bystander track staying in the
    // source project, so it stays behind rather than following the three.
    expect(await projectOfAsset(shared)).toBe(source);
  });

  it("drops the tracks a collection selection shares with a collection staying behind", async () => {
    const { source, target } = await seedPair();
    const moving = [
      await seedCollection(source, "Moving A"),
      await seedCollection(source, "Moving B"),
    ];
    const staying = await seedCollection(source, "Staying");
    const exclusive = await seedTrack(source, "Exclusive");
    const shared = await seedTrack(source, "Shared");

    await db.insert(collectionTracks).values([
      { collectionId: moving[0]!, trackId: exclusive },
      { collectionId: moving[1]!, trackId: shared },
      { collectionId: staying, trackId: shared },
    ]);

    await moveEntities("collection", moving, source, target, actorId);

    expect(await projectOfTrack(exclusive)).toBe(target);
    expect(await projectOfTrack(shared)).toBe(source);
    for (const collectionId of moving) {
      const [row] = await db
        .select({ projectId: collections.projectId })
        .from(collections)
        .where(eq(collections.id, collectionId));
      expect(row?.projectId).toBe(target);
    }
  });

  it("clears every moved session's track link left behind", async () => {
    const { source, target } = await seedPair();
    const trackId = await seedTrack(source);
    const sessionIds = [
      await seedSession(source, trackId),
      await seedSession(source, null),
    ];

    await moveEntities("session", sessionIds, source, target, actorId);

    const rows = await db
      .select({ id: sessions.id, trackId: sessions.trackId })
      .from(sessions)
      .where(inArray(sessions.id, sessionIds));
    for (const row of rows) expect(row.trackId).toBeNull();
    expect(await projectOfTrack(trackId)).toBe(source);
  });

  it("refuses when the actor is only a viewer in the target, and nothing moves", async () => {
    const source = await seedProject("Bulk Source");
    const target = await seedViewerOnlyProject("Bulk Target Viewer");
    const trackIds = [
      await seedTrack(source, "Guarded A"),
      await seedTrack(source, "Guarded B"),
    ];

    await expect(
      moveEntities("track", trackIds, source, target, actorId)
    ).rejects.toMatchObject({ status: 403 });

    for (const trackId of trackIds) {
      expect(await projectOfTrack(trackId)).toBe(source);
    }
  });

  it("moves none of the selection when one id belongs to another project", async () => {
    const { source, target } = await seedPair();
    const elsewhere = await seedProject("Bulk Elsewhere");
    const trackId = await seedTrack(source, "In Selection");
    const foreignTrackId = await seedTrack(elsewhere, "Not In Source");

    await expect(
      moveEntities("track", [trackId, foreignTrackId], source, target, actorId)
    ).rejects.toMatchObject({ status: 404 });

    expect(await projectOfTrack(trackId)).toBe(source);
    expect(await projectOfTrack(foreignTrackId)).toBe(elsewhere);
  });
});

describe("remapping a moved entity's status", () => {
  it("re-points a project status the target also defines", async () => {
    const { source, target } = await seedPair();
    const name = unique("Mixing");
    const sourceStatus = await seedStatus(source, name);
    const targetStatus = await seedStatus(target, name);
    const trackId = await seedTrack(source);
    await db
      .update(tracks)
      .set({ statusId: sourceStatus })
      .where(eq(tracks.id, trackId));

    await moveTrackToProject(trackId, target, actorId);

    const [row] = await db
      .select({ statusId: tracks.statusId })
      .from(tracks)
      .where(eq(tracks.id, trackId));
    expect(row?.statusId).toBe(targetStatus);
  });

  it("clears a project status the target has no name for", async () => {
    const { source, target } = await seedPair();
    const sourceStatus = await seedStatus(source, unique("Only Here"));
    const collectionId = await seedCollection(source);
    await db
      .update(collections)
      .set({ statusId: sourceStatus })
      .where(eq(collections.id, collectionId));

    await moveCollectionToProject(collectionId, target, actorId);

    const [row] = await db
      .select({ statusId: collections.statusId })
      .from(collections)
      .where(eq(collections.id, collectionId));
    expect(row?.statusId).toBeNull();
  });

  it("leaves a global status alone", async () => {
    const { source, target } = await seedPair();
    const globalStatus = await seedStatus(null, unique("Global"));
    const trackId = await seedTrack(source);
    await db
      .update(tracks)
      .set({ statusId: globalStatus })
      .where(eq(tracks.id, trackId));

    await moveTrackToProject(trackId, target, actorId);

    const [row] = await db
      .select({ statusId: tracks.statusId })
      .from(tracks)
      .where(eq(tracks.id, trackId));
    expect(row?.statusId).toBe(globalStatus);

    await db.delete(statuses).where(eq(statuses.id, globalStatus));
  });
});

describe("remapping a moved entity's priority", () => {
  /** A project's level of this name. */
  const levelOf = async (projectId: number, name: string) => {
    const [row] = await db
      .select({ id: priorityLevels.id })
      .from(priorityLevels)
      .where(
        and(
          eq(priorityLevels.projectId, projectId),
          eq(priorityLevels.name, name)
        )
      );
    return row!.id;
  };

  /** A level only the source project's scale has. */
  const seedOwnLevel = async (projectId: number, name: string) =>
    (await createPriorityLevel(projectId, { name, colour: "#AA3366" }, actorId))
      .id;

  const priorityOf = async (
    table: typeof tracks | typeof collections | typeof sessions,
    id: number
  ) =>
    (
      await db
        .select({ priorityId: table.priorityId })
        .from(table)
        .where(eq(table.id, id))
    )[0]?.priorityId;

  it("re-points every moved row at the target's level of the same name", async () => {
    const { source, target } = await seedPair();
    const trackId = await seedTrack(
      source,
      "Remap",
      await levelOf(source, "High")
    );
    const sessionId = await seedSession(
      source,
      trackId,
      await levelOf(source, "Low")
    );

    const moved = await moveTrackToProject(trackId, target, actorId);

    expect(moved.priorityId).toBe(await levelOf(target, "High"));
    expect(await priorityOf(sessions, sessionId)).toBe(
      await levelOf(target, "Low")
    );
    expect(moved.priorityFallbacks).toEqual([]);
  });

  it("falls back to the target's default for a name its scale lacks, and reports it", async () => {
    const { source, target } = await seedPair();
    const mixdown = await seedOwnLevel(source, "Mixdown");
    const trackId = await seedTrack(source, "Fallback", mixdown);
    const sessionId = await seedSession(source, trackId, mixdown);
    await updatePriorityLevel(
      target,
      await levelOf(target, "Low"),
      { isDefault: true },
      actorId
    );

    const moved = await moveTrackToProject(trackId, target, actorId);

    const targetDefault = await levelOf(target, "Low");
    expect(moved.priorityId).toBe(targetDefault);
    expect(await priorityOf(sessions, sessionId)).toBe(targetDefault);
    expect(moved.priorityFallbacks).toEqual([
      { from: "Mixdown", to: "Low", count: 2 },
    ]);
  });

  it("remaps a collection and the tracks it carries, each by its own name", async () => {
    const { source, target } = await seedPair();
    const collectionId = await seedCollection(
      source,
      "Remap EP",
      await seedOwnLevel(source, "Release Week")
    );
    const trackId = await seedTrack(
      source,
      "EP Track",
      await levelOf(source, "Urgent")
    );
    await db.insert(collectionTracks).values({ collectionId, trackId });

    const moved = await moveCollectionToProject(collectionId, target, actorId);

    expect(moved.priorityId).toBe(await levelOf(target, "None"));
    expect(await priorityOf(tracks, trackId)).toBe(
      await levelOf(target, "Urgent")
    );
    expect(moved.priorityFallbacks).toEqual([
      { from: "Release Week", to: "None", count: 1 },
    ]);
  });

  it("reports the fallbacks of a bulk move across every row it carried", async () => {
    const { source, target } = await seedPair();
    const draft = await seedOwnLevel(source, "Draft");
    const later = await seedOwnLevel(source, "Later");
    const sessionIds = [
      await seedSession(source, null, draft),
      await seedSession(source, null, draft),
      await seedSession(source, null, later),
      await seedSession(source, null, await levelOf(source, "Medium")),
    ];

    const { priorityFallbacks } = await moveEntities(
      "session",
      sessionIds,
      source,
      target,
      actorId
    );

    expect(priorityFallbacks).toEqual([
      { from: "Draft", to: "None", count: 2 },
      { from: "Later", to: "None", count: 1 },
    ]);
    expect(await priorityOf(sessions, sessionIds[3]!)).toBe(
      await levelOf(target, "Medium")
    );
  });
});

describe("remapping a moved entity's labels", () => {
  it("creates the label in the target project with the same colour", async () => {
    const { source, target } = await seedPair();
    const name = unique("Needs Vocals");
    const sourceLabel = await seedLabel(source, name, "#ABCDEF");
    const trackId = await seedTrack(source);
    await db.insert(entityLabels).values({
      labelId: sourceLabel,
      entityType: "track",
      entityId: trackId,
    });

    await moveTrackToProject(trackId, target, actorId);

    const [created] = await db
      .select({ id: labels.id, colourHex: labels.colourHex })
      .from(labels)
      .where(and(eq(labels.projectId, target), eq(labels.name, name)));
    expect(created?.colourHex).toBe("#ABCDEF");

    const links = await db
      .select({ labelId: entityLabels.labelId })
      .from(entityLabels)
      .where(
        and(
          eq(entityLabels.entityType, "track"),
          eq(entityLabels.entityId, trackId)
        )
      );
    expect(links.map((row) => row.labelId)).toEqual([created!.id]);
  });

  it("reuses the target project's label of the same name", async () => {
    const { source, target } = await seedPair();
    const name = unique("Sample Clearance");
    const sourceLabel = await seedLabel(source, name, "#111111");
    const targetLabel = await seedLabel(target, name, "#222222");
    const trackId = await seedTrack(source);
    await db.insert(entityLabels).values({
      labelId: sourceLabel,
      entityType: "track",
      entityId: trackId,
    });

    await moveTrackToProject(trackId, target, actorId);

    const inTarget = await db
      .select({ id: labels.id })
      .from(labels)
      .where(and(eq(labels.projectId, target), eq(labels.name, name)));
    expect(inTarget.map((row) => row.id)).toEqual([targetLabel]);

    const links = await db
      .select({ labelId: entityLabels.labelId })
      .from(entityLabels)
      .where(
        and(
          eq(entityLabels.entityType, "track"),
          eq(entityLabels.entityId, trackId)
        )
      );
    expect(links.map((row) => row.labelId)).toEqual([targetLabel]);
  });
});

describe("refusing a move", () => {
  it("refuses a caller who cannot write in the target project", async () => {
    const { source, target } = await seedPair();
    const trackId = await seedTrack(source);

    await expect(
      moveTrackToProject(trackId, target, outsiderId)
    ).rejects.toMatchObject({ status: 403 });

    expect(await projectOfTrack(trackId)).toBe(source);
  });

  it("refuses a move into the project the entity is already in", async () => {
    const { source } = await seedPair();
    const trackId = await seedTrack(source);

    await expect(
      moveTrackToProject(trackId, source, actorId)
    ).rejects.toMatchObject({ status: 400 });
  });

  it("answers 404 for an entity that is not there", async () => {
    const { target } = await seedPair();

    await expect(moveTrackToProject(-1, target, actorId)).rejects.toMatchObject(
      { status: 404 }
    );
  });
});

describe("refusing to move a session a dit repo holds", () => {
  /** A repo in `projectId` that has adopted the session as a set. */
  async function adoptIntoRepo(projectId: number, sessionId: number) {
    const [repo] = await db
      .insert(repos)
      .values({ projectId, name: unique("Repo") })
      .returning({ id: repos.id, name: repos.name });
    await db
      .update(sessions)
      .set({ repoId: repo!.id, ditSetId: unique("set") })
      .where(eq(sessions.id, sessionId));
    return repo!;
  }

  const projectOfSession = async (id: number) =>
    (
      await db
        .select({ projectId: sessions.projectId })
        .from(sessions)
        .where(eq(sessions.id, id))
    )[0]?.projectId;

  const projectOfCollection = async (id: number) =>
    (
      await db
        .select({ projectId: collections.projectId })
        .from(collections)
        .where(eq(collections.id, id))
    )[0]?.projectId;

  const refusal = (sessionName: string, repoName: string) =>
    `Session "${sessionName}" is a dit set in repo "${repoName}"; a session in a repo can't move to another project.`;

  const nameOfSession = async (id: number) =>
    (
      await db
        .select({ name: sessions.name })
        .from(sessions)
        .where(eq(sessions.id, id))
    )[0]!.name;

  it("refuses a single session move and leaves the row where it was", async () => {
    const { source, target } = await seedPair();
    const sessionId = await seedSession(source);
    const repo = await adoptIntoRepo(source, sessionId);

    await expect(
      moveSessionToProject(sessionId, target, actorId)
    ).rejects.toMatchObject({
      status: 409,
      message: refusal(await nameOfSession(sessionId), repo.name),
    });

    expect(await projectOfSession(sessionId)).toBe(source);
  });

  it("refuses a bulk session move without moving the sessions outside a repo", async () => {
    const { source, target } = await seedPair();
    const free = await seedSession(source);
    const held = await seedSession(source);
    const repo = await adoptIntoRepo(source, held);

    await expect(
      moveEntities("session", [free, held], source, target, actorId)
    ).rejects.toMatchObject({
      status: 409,
      message: refusal(await nameOfSession(held), repo.name),
    });

    expect(await projectOfSession(free)).toBe(source);
    expect(await projectOfSession(held)).toBe(source);
  });

  it("names the first session in a repo by id", async () => {
    const { source, target } = await seedPair();
    const first = await seedSession(source);
    const second = await seedSession(source);
    const firstRepo = await adoptIntoRepo(source, first);
    await adoptIntoRepo(source, second);

    await expect(
      moveEntities("session", [second, first], source, target, actorId)
    ).rejects.toMatchObject({
      message: refusal(await nameOfSession(first), firstRepo.name),
    });
  });

  it("refuses a track move whose session is in a repo, moving nothing", async () => {
    const { source, target } = await seedPair();
    const trackId = await seedTrack(source);
    const free = await seedSession(source, trackId);
    const held = await seedSession(source, trackId);
    const repo = await adoptIntoRepo(source, held);

    await expect(
      moveTrackToProject(trackId, target, actorId)
    ).rejects.toMatchObject({
      status: 409,
      message: refusal(await nameOfSession(held), repo.name),
    });

    expect(await projectOfTrack(trackId)).toBe(source);
    expect(await projectOfSession(free)).toBe(source);
    expect(await projectOfSession(held)).toBe(source);
  });

  it("refuses a collection move that pulls in a track holding a repo session", async () => {
    const { source, target } = await seedPair();
    const collectionId = await seedCollection(source);
    const trackId = await seedTrack(source);
    const held = await seedSession(source, trackId);
    const repo = await adoptIntoRepo(source, held);
    await db.insert(collectionTracks).values({ collectionId, trackId });

    await expect(
      moveCollectionToProject(collectionId, target, actorId)
    ).rejects.toMatchObject({
      status: 409,
      message: refusal(await nameOfSession(held), repo.name),
    });

    expect(await projectOfCollection(collectionId)).toBe(source);
    expect(await projectOfTrack(trackId)).toBe(source);
    expect(await projectOfSession(held)).toBe(source);
  });

  it("refuses the preview of such a move", async () => {
    const { source, target } = await seedPair();
    const trackId = await seedTrack(source);
    const held = await seedSession(source, trackId);
    await adoptIntoRepo(source, held);

    await expect(
      previewMove("track", [trackId], source, target, actorId)
    ).rejects.toMatchObject({ status: 409 });
  });

  it("still moves a session outside a repo, and a track none of whose sessions are in one", async () => {
    const { source, target } = await seedPair();
    const heldTrack = await seedTrack(source);
    const held = await seedSession(source, heldTrack);
    await adoptIntoRepo(source, held);

    const freeTrack = await seedTrack(source);
    const freeInTrack = await seedSession(source, freeTrack);
    const sibling = await seedSession(source, heldTrack);
    const lone = await seedSession(source);

    await moveSessionToProject(lone, target, actorId);
    await moveTrackToProject(freeTrack, target, actorId);
    // A sibling of a held session still moves on its own: it leaves its
    // track behind, and the track stays with the held session.
    await moveSessionToProject(sibling, target, actorId);

    expect(await projectOfSession(lone)).toBe(target);
    expect(await projectOfTrack(freeTrack)).toBe(target);
    expect(await projectOfSession(freeInTrack)).toBe(target);
    expect(await projectOfSession(sibling)).toBe(target);
    expect(await projectOfSession(held)).toBe(source);
    expect(await projectOfTrack(heldTrack)).toBe(source);
  });
});

describe("a move racing an adoption into a repo", () => {
  async function seedRepo(projectId: number) {
    const [repo] = await db
      .insert(repos)
      .values({ projectId, name: unique("Repo") })
      .returning({ id: repos.id, projectId: repos.projectId });
    return repo!;
  }

  const rowOf = async (id: number) =>
    (
      await db
        .select({ projectId: sessions.projectId, repoId: sessions.repoId })
        .from(sessions)
        .where(eq(sessions.id, id))
    )[0]!;

  /** What a promise rejected with, or null when it resolved. */
  const rejection = (promise: Promise<unknown>) =>
    promise.then(
      () => null,
      (error: unknown) => error
    );

  it("moves the session and refuses the adoption when the move locked it first", async () => {
    const { source, target } = await seedPair();
    const sessionId = await seedSession(source);
    const repo = await seedRepo(source);

    const move = await holdTransaction(async (tx) => {
      await tx
        .update(sessions)
        .set({ projectId: target })
        .where(eq(sessions.id, sessionId));
    });
    const adopted = rejection(
      adoptSet(repo, actorId, {
        ditSetId: unique("set"),
        fileName: "a.als",
        sessionId,
      })
    );
    await move.blocking();
    await move.commit();

    expect(await adopted).toMatchObject({ status: 404 });
    expect(await rowOf(sessionId)).toEqual({ projectId: target, repoId: null });
    // The held update stands in for a move without remapping the priority, so
    // the row would block its source project's teardown.
    await db.delete(sessions).where(eq(sessions.id, sessionId));
  });

  it("adopts the session and refuses the move when the adoption committed first", async () => {
    const { source, target } = await seedPair();
    const sessionId = await seedSession(source);
    const repo = await seedRepo(source);

    const adoption = await holdTransaction(async (tx) => {
      await tx
        .update(sessions)
        .set({ repoId: repo.id, ditSetId: unique("set") })
        .where(eq(sessions.id, sessionId));
    });
    const moved = rejection(moveSessionToProject(sessionId, target, actorId));
    await adoption.blocking();
    await adoption.commit();

    expect(await moved).toMatchObject({ status: 409 });
    expect(await rowOf(sessionId)).toEqual({
      projectId: source,
      repoId: repo.id,
    });
  });

  it("refuses a bulk move when an adoption of one of its sessions committed first", async () => {
    const { source, target } = await seedPair();
    const free = await seedSession(source);
    const sessionId = await seedSession(source);
    const repo = await seedRepo(source);

    const adoption = await holdTransaction(async (tx) => {
      await tx
        .update(sessions)
        .set({ repoId: repo.id, ditSetId: unique("set") })
        .where(eq(sessions.id, sessionId));
    });
    const moved = rejection(
      moveEntities("session", [free, sessionId], source, target, actorId)
    );
    await adoption.blocking();
    await adoption.commit();

    expect(await moved).toMatchObject({ status: 409 });
    expect(await rowOf(free)).toEqual({ projectId: source, repoId: null });
    expect(await rowOf(sessionId)).toEqual({
      projectId: source,
      repoId: repo.id,
    });
  });
});

describe("a move racing a session written onto its track", () => {
  const rowOf = async (id: number) =>
    (
      await db
        .select({ projectId: sessions.projectId, trackId: sessions.trackId })
        .from(sessions)
        .where(eq(sessions.id, id))
    )[0];

  const sessionsOn = async (trackId: number) =>
    db
      .select({ id: sessions.id, projectId: sessions.projectId })
      .from(sessions)
      .where(eq(sessions.trackId, trackId))
      .orderBy(sessions.id);

  /** What a promise rejected with, or null when it resolved. */
  const rejection = (promise: Promise<unknown>) =>
    promise.then(
      () => null,
      (error: unknown) => error
    );

  /** Holds a session's row lock, so whoever locks it next queues behind it. */
  const lockingSession = (id: number) => async (tx: Tx) => {
    await tx
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.id, id))
      .for("update");
  };

  /**
   * Starts moving `trackId` and returns once the move has locked the track and
   * queued on `anchor`, one of the track's sessions a held transaction locks:
   * from then until `held` commits, the move holds the track against writers.
   */
  async function moveQueuedOn(trackId: number, anchor: number, target: number) {
    const held = await holdTransaction(lockingSession(anchor));
    const moved = rejection(moveTrackToProject(trackId, target, actorId));
    await held.blocking();
    return { held, moved };
  }

  const newSession = (projectId: number, trackId: number) => ({
    name: unique("Session"),
    daw: "Ableton" as const,
    projectId,
    trackId,
    main: false,
  });

  it("refuses a session created on the track while the move holds it", async () => {
    const { source, target } = await seedPair();
    const track = await seedTrack(source);
    const anchor = await seedSession(source, track);
    const { held, moved } = await moveQueuedOn(track, anchor, target);

    const created = rejection(createSession(newSession(source, track)));
    await held.blocking(2);
    await held.commit();

    expect(await moved).toBeNull();
    expect(await created).toMatchObject({ status: 404 });
    expect(await sessionsOn(track)).toEqual([
      { id: anchor, projectId: target },
    ]);
  });

  it("moves a session created on the track before the move locked it", async () => {
    const { source, target } = await seedPair();
    const track = await seedTrack(source);
    const [main] = await db
      .update(sessions)
      .set({ main: true })
      .where(eq(sessions.id, await seedSession(source, track)))
      .returning({ id: sessions.id });

    // The create takes the track, then queues on the track's main, which it
    // has to clear; the move then queues on the track behind the create.
    const held = await holdTransaction(lockingSession(main!.id));
    // `main` is left unset so the project's default makes it the track's main.
    const fresh = { ...newSession(source, track), main: undefined };
    const created = withProjectPolicyForTest(
      source,
      { defaults: { newSessionMain: true } },
      () => createSession(fresh)
    );
    await held.blocking();
    const moved = rejection(moveTrackToProject(track, target, actorId));
    await held.blocking(2);
    await held.commit();

    const createdSession = await created;
    expect(await moved).toBeNull();
    expect(await sessionsOn(track)).toEqual([
      { id: main!.id, projectId: target },
      { id: createdSession.id, projectId: target },
    ]);
  });

  it("refuses re-linking a session onto the track while the move holds it", async () => {
    const { source, target } = await seedPair();
    const track = await seedTrack(source);
    const anchor = await seedSession(source, track);
    const elsewhere = await seedTrack(source);
    const session = await seedSession(source, elsewhere);
    const { held, moved } = await moveQueuedOn(track, anchor, target);

    const relinked = rejection(
      bulkMoveSessions(
        [{ sessionId: session, trackId: track, main: false }],
        source,
        actorId
      )
    );
    await held.blocking(2);
    await held.commit();

    expect(await moved).toBeNull();
    expect(await relinked).toMatchObject({ status: 404 });
    expect(await rowOf(session)).toEqual({
      projectId: source,
      trackId: elsewhere,
    });
    expect(await sessionsOn(track)).toEqual([
      { id: anchor, projectId: target },
    ]);
  });

  it("moves a session re-linked onto the track before the move locked it", async () => {
    const { source, target } = await seedPair();
    const track = await seedTrack(source);
    const session = await seedSession(source, await seedTrack(source));

    // The re-link takes the track, then queues on the session it re-links;
    // the move then queues on the track behind the re-link.
    const held = await holdTransaction(lockingSession(session));
    const relinked = rejection(
      bulkMoveSessions(
        [{ sessionId: session, trackId: track, main: false }],
        source,
        actorId
      )
    );
    await held.blocking();
    const moved = rejection(moveTrackToProject(track, target, actorId));
    await held.blocking(2);
    await held.commit();

    expect(await relinked).toBeNull();
    expect(await moved).toBeNull();
    expect(await rowOf(session)).toEqual({ projectId: target, trackId: track });
  });

  it("refuses re-linking one of the track's sessions away while the move holds it", async () => {
    const { source, target } = await seedPair();
    const track = await seedTrack(source);
    // Locked by the move before it queues on the anchor, which sorts after it.
    const session = await seedSession(source, track);
    const anchor = await seedSession(source, track);
    const elsewhere = await seedTrack(source);
    const { held, moved } = await moveQueuedOn(track, anchor, target);

    const relinked = rejection(
      bulkMoveSessions(
        [{ sessionId: session, trackId: elsewhere, main: false }],
        source,
        actorId
      )
    );
    await held.blocking(2);
    await held.commit();

    expect(await moved).toBeNull();
    expect(await relinked).toMatchObject({ status: 404 });
    expect(await rowOf(session)).toEqual({ projectId: target, trackId: track });
  });

  it("refuses patching a session onto the track while the move holds it", async () => {
    const { source, target } = await seedPair();
    const track = await seedTrack(source);
    const anchor = await seedSession(source, track);
    const session = await seedSession(source);
    const { held, moved } = await moveQueuedOn(track, anchor, target);

    const patched = rejection(updateSession(session, { trackId: track }));
    await held.blocking(2);
    await held.commit();

    expect(await moved).toBeNull();
    expect(await patched).toMatchObject({ status: 404 });
    expect(await rowOf(session)).toEqual({ projectId: source, trackId: null });
  });

  it("refuses patching one of the track's sessions onto another track while the move holds it", async () => {
    const { source, target } = await seedPair();
    const track = await seedTrack(source);
    const session = await seedSession(source, track);
    const anchor = await seedSession(source, track);
    const elsewhere = await seedTrack(source);
    const { held, moved } = await moveQueuedOn(track, anchor, target);

    const patched = rejection(updateSession(session, { trackId: elsewhere }));
    await held.blocking(2);
    await held.commit();

    expect(await moved).toBeNull();
    expect(await patched).toMatchObject({ status: 404 });
    expect(await rowOf(session)).toEqual({ projectId: target, trackId: track });
  });

  it("refuses bulk-patching sessions onto the track while the move holds it", async () => {
    const { source, target } = await seedPair();
    const track = await seedTrack(source);
    const anchor = await seedSession(source, track);
    const session = await seedSession(source);
    const { held, moved } = await moveQueuedOn(track, anchor, target);

    const patched = rejection(
      bulkUpdateSessions(
        source,
        { ids: [session] },
        { trackId: track },
        actorId
      )
    );
    await held.blocking(2);
    await held.commit();

    expect(await moved).toBeNull();
    expect(await patched).toMatchObject({ status: 404 });
    expect(await rowOf(session)).toEqual({ projectId: source, trackId: null });
  });

  it("refuses a second move of the track that queued behind the first", async () => {
    const { source, target } = await seedPair();
    const other = await seedProject("Move Other");
    const track = await seedTrack(source);
    const anchor = await seedSession(source, track);
    const first = await moveQueuedOn(track, anchor, target);

    const second = rejection(moveTrackToProject(track, other, actorId));
    await first.held.blocking(2);
    await first.held.commit();

    expect(await first.moved).toBeNull();
    expect(await second).toMatchObject({ status: 404 });
    expect(await projectOfTrack(track)).toBe(target);
    expect(await sessionsOn(track)).toEqual([
      { id: anchor, projectId: target },
    ]);
  });

  it("refuses a second move of a session that queued behind the first", async () => {
    const { source, target } = await seedPair();
    const other = await seedProject("Move Other");
    const session = await seedSession(source);
    // Both moves queue on the held session, the second behind the first.
    const held = await holdTransaction(lockingSession(session));
    const moved = rejection(moveSessionToProject(session, target, actorId));
    await held.blocking();
    const second = rejection(moveSessionToProject(session, other, actorId));
    await held.blocking(2);
    await held.commit();

    expect(await moved).toBeNull();
    expect(await second).toMatchObject({ status: 404 });
    expect(await rowOf(session)).toEqual({ projectId: target, trackId: null });
  });

  it("refuses a second move of a trackless collection that queued behind the first", async () => {
    const { source, target } = await seedPair();
    const other = await seedProject("Move Other");
    const collection = await seedCollection(source);
    // Both moves queue on the held collection, the second behind the first.
    const held = await holdTransaction(async (tx) => {
      await tx
        .select({ id: collections.id })
        .from(collections)
        .where(eq(collections.id, collection))
        .for("update");
    });
    const moved = rejection(
      moveCollectionToProject(collection, target, actorId)
    );
    await held.blocking();
    const second = rejection(
      moveCollectionToProject(collection, other, actorId)
    );
    await held.blocking(2);
    await held.commit();

    expect(await moved).toBeNull();
    expect(await second).toMatchObject({ status: 404 });
    const [row] = await db
      .select({ projectId: collections.projectId })
      .from(collections)
      .where(eq(collections.id, collection));
    expect(row?.projectId).toBe(target);
  });

  it("records only its own change when a bulk patch waits out a lock on its track", async () => {
    const { source } = await seedPair();
    const track = await seedTrack(source);
    const session = await seedSession(source);
    // Stands in for a move or move preview that holds the track and then
    // leaves it in the project.
    const held = await holdTransaction(async (tx) => {
      await tx
        .select({ id: tracks.id })
        .from(tracks)
        .where(eq(tracks.id, track))
        .for("no key update");
    });

    const patched = rejection(
      bulkUpdateSessions(
        source,
        { ids: [session] },
        { trackId: track },
        actorId
      )
    );
    await held.blocking();
    // Another write lands on the session while the bulk patch waits.
    await updateSession(session, { name: unique("Renamed") });
    await held.commit();

    expect(await patched).toBeNull();
    const recorded = await db
      .select({ changes: activity.changes })
      .from(activity)
      .where(
        and(eq(activity.entityType, "session"), eq(activity.entityId, session))
      );
    expect(recorded.map((row) => Object.keys(row.changes ?? {}))).toEqual([
      ["trackId"],
    ]);
  });

  it("lets a custom-field write on the track through while the move holds it", async () => {
    const { source, target } = await seedPair();
    const track = await seedTrack(source);
    const anchor = await seedSession(source, track);
    const [filled, empty] = await db
      .insert(customFields)
      .values(
        ["Filled", "Empty"].map((name, rank) => ({
          projectId: source,
          kind: "track" as const,
          name: unique(name),
          type: "text" as const,
          options: [],
          rank,
        }))
      )
      .returning({ id: customFields.id });
    await db
      .insert(customFieldValues)
      .values({ fieldId: filled!.id, trackId: track, textValue: "old" });
    const move = await moveQueuedOn(track, anchor, target);

    // The write locks the value it updates, then inserts one whose foreign-key
    // check takes the track; the move later drops the updated value. Were the
    // track locked against that check, each would wait on the other.
    const written = rejection(
      setValues("track", source, [track], {
        [fieldKey(filled!.id)]: "new",
        [fieldKey(empty!.id)]: "added",
      })
    );
    const queued = move.held.blocking(2);
    queued.catch(() => {});
    await Promise.race([written, queued]);
    await move.held.commit();

    expect(await written).toBeNull();
    expect(await move.moved).toBeNull();
    expect(await rowOf(anchor)).toEqual({ projectId: target, trackId: track });
  });
});

describe("remapping a moved entity's custom values", () => {
  async function seedField(
    projectId: number,
    field: {
      kind?: "track" | "collection";
      name: string;
      type: CustomField["type"];
      options?: { id: string; label: string }[];
    }
  ): Promise<CustomField> {
    const [row] = await db
      .insert(customFields)
      .values({
        projectId,
        kind: field.kind ?? "track",
        name: field.name,
        type: field.type,
        options: field.options ?? [],
        rank: 0,
      })
      .returning();
    return row!;
  }

  const valuesOf = (owner: { trackId?: number; collectionId?: number }) =>
    db
      .select({
        fieldId: customFieldValues.fieldId,
        numberValue: customFieldValues.numberValue,
        optionValue: customFieldValues.optionValue,
        textValue: customFieldValues.textValue,
      })
      .from(customFieldValues)
      .where(
        owner.trackId != null
          ? eq(customFieldValues.trackId, owner.trackId)
          : eq(customFieldValues.collectionId, owner.collectionId!)
      );

  it("carries values onto the target's field of the same name and type, and reports the rest", async () => {
    const { source, target } = await seedPair();
    const tempo = await seedField(source, { name: "Tempo", type: "number" });
    const mood = await seedField(source, {
      name: "Mood",
      type: "select",
      options: [
        { id: "s-happy", label: "Happy" },
        { id: "s-sad", label: "Sad" },
      ],
    });
    const notes = await seedField(source, { name: "Notes", type: "text" });
    const released = await seedField(source, {
      name: "Released",
      type: "checkbox",
    });
    const targetTempo = await seedField(target, {
      name: "Tempo",
      type: "number",
    });
    const targetMood = await seedField(target, {
      name: "Mood",
      type: "select",
      options: [{ id: "t-happy", label: "Happy" }],
    });
    // The same name as another type is no match.
    await seedField(target, { name: "Released", type: "text" });
    // The same name on the other kind is no match either.
    await seedField(target, {
      kind: "collection",
      name: "Notes",
      type: "text",
    });

    const happy = await seedTrack(source, "Happy");
    const sad = await seedTrack(source, "Sad");
    await db.insert(customFieldValues).values([
      { fieldId: tempo.id, trackId: happy, numberValue: 120 },
      { fieldId: mood.id, trackId: happy, optionValue: "s-happy" },
      { fieldId: notes.id, trackId: happy, textValue: "keep?" },
      { fieldId: released.id, trackId: happy, boolValue: true },
      { fieldId: mood.id, trackId: sad, optionValue: "s-sad" },
    ]);

    const preview = await previewMove(
      "track",
      [happy, sad],
      source,
      target,
      actorId
    );
    // The preview writes nothing.
    expect(await valuesOf({ trackId: happy })).toHaveLength(4);

    const { droppedFields } = await moveEntities(
      "track",
      [happy, sad],
      source,
      target,
      actorId
    );
    const expected: DroppedField[] = [
      {
        fieldId: mood.id,
        kind: "track",
        name: "Mood",
        type: "select",
        count: 1,
      },
      {
        fieldId: notes.id,
        kind: "track",
        name: "Notes",
        type: "text",
        count: 1,
      },
      {
        fieldId: released.id,
        kind: "track",
        name: "Released",
        type: "checkbox",
        count: 1,
      },
    ];
    expect(sortById(droppedFields)).toEqual(sortById(expected));
    expect(sortById(preview)).toEqual(sortById(expected));

    expect(await valuesOf({ trackId: happy })).toEqual(
      expect.arrayContaining([
        {
          fieldId: targetTempo.id,
          numberValue: 120,
          optionValue: null,
          textValue: null,
        },
        {
          fieldId: targetMood.id,
          numberValue: null,
          optionValue: "t-happy",
          textValue: null,
        },
      ])
    );
    expect(await valuesOf({ trackId: happy })).toHaveLength(2);
    expect(await valuesOf({ trackId: sad })).toEqual([]);
  });

  it("carries the values of the tracks a collection takes with it, and leaves a shared track's alone", async () => {
    const { source, target } = await seedPair();
    const format = await seedField(source, {
      kind: "collection",
      name: "Format",
      type: "text",
    });
    const bpm = await seedField(source, { name: "BPM", type: "number" });
    const lost = await seedField(source, { name: "Lost", type: "url" });
    const targetFormat = await seedField(target, {
      kind: "collection",
      name: "Format",
      type: "text",
    });
    const targetBpm = await seedField(target, { name: "BPM", type: "number" });

    const collection = await seedCollection(source);
    const other = await seedCollection(source);
    const exclusive = await seedTrack(source, "Exclusive");
    const shared = await seedTrack(source, "Shared");
    await db.insert(collectionTracks).values([
      { collectionId: collection, trackId: exclusive, trackNumber: 1 },
      { collectionId: collection, trackId: shared, trackNumber: 2 },
      { collectionId: other, trackId: shared, trackNumber: 1 },
    ]);
    await db.insert(customFieldValues).values([
      { fieldId: format.id, collectionId: collection, textValue: "Vinyl" },
      { fieldId: bpm.id, trackId: exclusive, numberValue: 98 },
      { fieldId: lost.id, trackId: exclusive, urlValue: "https://x.test" },
      { fieldId: bpm.id, trackId: shared, numberValue: 120 },
      { fieldId: lost.id, trackId: shared, urlValue: "https://y.test" },
    ]);

    const preview = await previewMove(
      "collection",
      [collection],
      source,
      target,
      actorId
    );
    const moved = await moveCollectionToProject(collection, target, actorId);

    const expected: DroppedField[] = [
      { fieldId: lost.id, kind: "track", name: "Lost", type: "url", count: 1 },
    ];
    expect(preview).toEqual(expected);
    expect(moved.droppedFields).toEqual(expected);
    expect(await valuesOf({ collectionId: collection })).toEqual([
      {
        fieldId: targetFormat.id,
        numberValue: null,
        optionValue: null,
        textValue: "Vinyl",
      },
    ]);
    expect(await valuesOf({ trackId: exclusive })).toEqual([
      {
        fieldId: targetBpm.id,
        numberValue: 98,
        optionValue: null,
        textValue: null,
      },
    ]);
    // The shared track stays in the source project with both of its values.
    expect(await projectOfTrack(shared)).toBe(source);
    expect(
      (await valuesOf({ trackId: shared })).map((row) => row.fieldId).sort()
    ).toEqual([bpm.id, lost.id].sort());
  });

  it("previews and reports nothing for a session, which has no fields", async () => {
    const { source, target } = await seedPair();
    const sessionId = await seedSession(source);
    expect(
      await previewMove("session", [sessionId], source, target, actorId)
    ).toEqual([]);
    const moved = await moveSessionToProject(sessionId, target, actorId);
    expect(moved.droppedFields).toEqual([]);
  });

  it("refuses a preview the move itself would refuse", async () => {
    const { source } = await seedPair();
    const viewerOnly = await seedViewerOnlyProject("Preview viewer");
    const trackId = await seedTrack(source);
    await expect(
      previewMove("track", [trackId], source, viewerOnly, actorId)
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      previewMove("track", [trackId], source, source, actorId)
    ).rejects.toMatchObject({ status: 400 });
  });
});

function sortById<T extends { fieldId: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.fieldId - b.fieldId);
}
