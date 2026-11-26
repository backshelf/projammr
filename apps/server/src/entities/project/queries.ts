import { eq, sql } from "drizzle-orm";
import { unionAll } from "drizzle-orm/pg-core";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { DAY_MS, HOUR_MS } from "../../lib/duration.js";
import { removeVariants } from "../../lib/images.js";
import { removeStoredFile } from "../../lib/storage.js";
import { db, type Tx } from "../../db/index.js";
import { artworkForProject, withArtwork } from "../../db/queries/artwork.js";
import type { StaticFileKind } from "../../db/queries/assets.js";
import { seedPriorityLevels } from "../../db/queries/priority-levels.js";
import { seedRelationTypes } from "../../db/queries/track-relation-types.js";
import { projectPolicy } from "../../db/queries/project-policy.js";
import { getProjectSaves, projectSaveSchema } from "../../db/queries/saves.js";
import { releasingProjectUsage } from "../../db/queries/storage-usage.js";
import {
  getRecentTrackAudios,
  lockDoomedVersions,
  spectrogramKeysForTracksMatching,
  trackAudioWithOwnerSchema,
} from "../../db/queries/track-audios.js";
import {
  assets,
  attachedAssetSchema,
  attachmentsWithUploadedBy,
} from "../../db/schema/assets.js";
import { rawMemberRoleEnum } from "../../db/schema/enums.js";
import { images } from "../../db/schema/images.js";
import {
  members,
  type NewProject,
  type Project,
  projects,
  projectSchema,
} from "../../db/schema/projects.js";
import { tracks } from "../../db/schema/tracks.js";
import { getQuietTracks, quietTrackSchema } from "../track/queries.js";

const getProjectSchema = projectSchema.extend({
  attachments: z.array(attachedAssetSchema),
  role: z.enum(rawMemberRoleEnum),
});

/**
 * A project with everything its page reads, minus the caller's role — which
 * the request carries, not the row.
 */
export const projectDetailSchema = withArtwork(getProjectSchema);

export type ProjectDetail = Omit<z.infer<typeof projectDetailSchema>, "role">;

export async function getProject(projectId: number): Promise<ProjectDetail> {
  const result = await db.query.projects.findFirst({
    where: { id: projectId },
    with: { attachments: attachmentsWithUploadedBy },
  });

  if (!result) throw new HTTPException(404);

  return { ...result, artwork: await artworkForProject(result) };
}

export const TODAY_RENDER_LIMIT = 12;
export const TODAY_SAVE_LIMIT = 12;
export const QUIET_LIMIT = 8;

export const projectTodaySchema = z.object({
  renders: z.array(trackAudioWithOwnerSchema),
  saves: z.array(projectSaveSchema),
  counts: z.object({ renders: z.number(), saves: z.number() }),
  quiet: z.object({ tracks: z.array(quietTrackSchema), total: z.number() }),
});

/**
 * What a project's home page reads in one go: the renders linked and the
 * saves made within the project's "today" window, and the tracks nobody has
 * touched for its quiet threshold. A threshold of 0 counts nothing quiet.
 */
export async function getProjectToday(
  projectId: number
): Promise<z.infer<typeof projectTodaySchema>> {
  const { conventions } = await projectPolicy(projectId);
  const now = Date.now();
  const since = new Date(now - conventions.todayNewHours * HOUR_MS);

  const [recent, revised, quiet] = await Promise.all([
    getRecentTrackAudios(projectId, since, TODAY_RENDER_LIMIT),
    getProjectSaves(projectId, {
      since,
      liveTracksOnly: true,
      tz: "UTC",
      limit: TODAY_SAVE_LIMIT,
    }),
    conventions.quietAfterDays > 0
      ? getQuietTracks(projectId, {
          before: new Date(now - conventions.quietAfterDays * DAY_MS),
          limit: QUIET_LIMIT,
        })
      : { tracks: [], total: 0 },
  ]);

  return {
    renders: recent.audios,
    saves: revised.saves,
    counts: { renders: recent.total, saves: revised.total },
    quiet,
  };
}

/**
 * Creates a project with its first membership, its starting priority scale
 * and its starting relation types. A project with no owner is unreachable —
 * nobody can see it, nobody can delete it, and it resolves to no member for
 * authorization — and one with no scale has no level to give its first track,
 * so the inserts share a transaction.
 */
export async function createProject(
  project: NewProject,
  ownerId: string
): Promise<Project> {
  return db.transaction(async (tx) => {
    const [result] = await tx
      .insert(projects)
      .values(project)
      .onConflictDoNothing()
      .returning();

    if (!result)
      throw new HTTPException(400, { message: "Project already exists" });

    await tx
      .insert(members)
      .values({ userId: ownerId, projectId: result.id, role: "owner" });
    await seedPriorityLevels(tx, result.id);
    await seedRelationTypes(tx, result.id);

    return result;
  });
}

/**
 * Deletes a project's row, and with it everything that cascades from it. Its
 * tracks go first, in their own statement: a track's priority level and its
 * relations' types are `RESTRICT` keys, and Postgres fires the project's
 * cascades in trigger-name order, which follows constraint OIDs as strings and
 * so differs between databases. Where the types' or levels' cascade ran before
 * the tracks', the key would refuse the delete.
 *
 * Before the first delete it holds the project's assets, their tracks' analysis
 * locks and the versions naming them, in the documented lock order
 * ({@link lockDoomedVersions}). A track's versions name assets of its own
 * project (linking checks it and a move takes them along or drops them), so
 * this reaches every version the cascade removes. A comment on one of them
 * share-locks it and then key-share-locks the project row, so the versions
 * must be held before the project row is deleted.
 */
export async function deleteProjectRow(tx: Tx, projectId: number) {
  await lockDoomedVersions(tx, eq(assets.projectId, projectId));
  await tx.delete(tracks).where(eq(tracks.projectId, projectId));
  return tx.delete(projects).where(eq(projects.id, projectId)).returning();
}

/**
 * Deletes a project and everything scoped to it: collections, tracks and
 * sessions along with members, statuses, uploaded assets and images, and
 * project attachments.
 *
 * The rows cascade, so the paths are read while they still exist and the bytes
 * are removed once the delete has committed. The storage counters cascade
 * nowhere on their own, so the project's own is dropped and every uploader who
 * had bytes here is re-derived around the delete. Its tracks' versions cascade
 * too, taking any spectrogram PNGs they named; those are read the same way,
 * through the track-audio module that owns them.
 */
export async function deleteProject(projectId: number): Promise<Project> {
  const stored = await unionAll(
    db
      .select({
        kind: sql<StaticFileKind>`'asset'`.as("kind"),
        assetPath: assets.assetPath,
      })
      .from(assets)
      .where(eq(assets.projectId, projectId)),
    db
      .select({
        kind: sql<StaticFileKind>`'image'`.as("kind"),
        assetPath: images.assetPath,
      })
      .from(images)
      .where(eq(images.projectId, projectId))
  );
  const spectrogramKeys = await spectrogramKeysForTracksMatching(
    eq(tracks.projectId, projectId)
  );

  const [result] = await releasingProjectUsage(projectId, () =>
    db.transaction((tx) => deleteProjectRow(tx, projectId))
  );

  if (!result) throw new HTTPException(404, { message: "Project not found" });

  for (const { kind, assetPath } of stored) {
    await removeStoredFile(assetPath);
    if (kind === "image") await removeVariants(assetPath);
  }
  for (const key of spectrogramKeys) await removeStoredFile(key);

  return result;
}

export async function updateProject(
  projectId: number,
  project: Partial<NewProject>
): Promise<Project> {
  const [result] = await db
    .update(projects)
    .set(project)
    .where(eq(projects.id, projectId))
    .returning();

  if (!result) throw new HTTPException(404, { message: "Project not found" });

  return result;
}

/** The bare project row — for diffing before an update. */
export async function getProjectRow(
  projectId: number
): Promise<Project | undefined> {
  const [row] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId));
  return row;
}
