import { eq, getColumns, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../index.js";
import { activity } from "../schema/activity.js";
import { rawMemberRoleEnum } from "../schema/enums.js";
import { members, projects, projectSchema } from "../schema/projects.js";
import { tracks } from "../schema/tracks.js";

/** A project as `getProjectsForUser` answers it, with the home page's two extra figures. */
export const projectsForUserSchema = z.array(
  projectSchema.extend({
    /** The user's own role in the project. */
    role: z.enum(rawMemberRoleEnum),
    /** Live tracks only. */
    trackCount: z.number().int(),
    archivedTrackCount: z.number().int(),
    lastActivityAt: z.date().nullable(),
  })
);

/**
 * Every project the user belongs to, with the two figures the home page's
 * project list needs. Both are correlated scalar subqueries rather than a
 * join + `groupBy` so that neither fans the row count out against the other:
 * `activity_project` and `tracks_project_updated` cover them without a
 * sequential scan.
 */
export async function getProjectsForUser(userId: string) {
  return db
    .select({
      ...getColumns(projects),
      role: members.role,
      trackCount: sql<number>`(
        select count(*)::int from ${tracks} where ${tracks.projectId} = ${projects.id} and ${tracks.archivedAt} is null
      )`,
      archivedTrackCount: sql<number>`(
        select count(*)::int from ${tracks} where ${tracks.projectId} = ${projects.id} and ${tracks.archivedAt} is not null
      )`,
      lastActivityAt: sql<Date | null>`(
        select max(${activity.createdAt}) from ${activity} where ${activity.projectId} = ${projects.id}
      )`.mapWith(activity.createdAt),
    })
    .from(projects)
    .innerJoin(members, eq(projects.id, members.projectId))
    .where(eq(members.userId, userId));
}
