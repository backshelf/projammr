import { eq, isNull, or } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { db } from "../index.js";
import { type NewStatus, type Status, statuses } from "../schema/statuses.js";
import { recordActivity } from "./activity.js";
import type { ProjectResolution } from "./authorization.js";

/** Why a write to a global status is refused, whoever asks. */
export const GLOBAL_STATUS_CHANGE_REFUSAL = "Cannot change global statuses";
export const GLOBAL_STATUS_DELETE_REFUSAL = "Cannot delete global statuses";

/** How a status reads in the activity feed: its name and its percentage. */
function statusChangeLabel(
  status: Pick<Status, "name" | "percentage">
): string {
  return `${status.name} ${status.percentage}%`;
}

/**
 * Resolver for `authorizeProject`: a status carries its project id. Seeded
 * statuses carry none — they are shared by every project, so they answer
 * `"global"` and the caller decides what that means for the request.
 */
export async function projectIdForStatus(
  statusId: number
): Promise<ProjectResolution | "global"> {
  if (Number.isNaN(statusId)) return null;
  const [row] = await db
    .select({ projectId: statuses.projectId })
    .from(statuses)
    .where(eq(statuses.id, statusId));
  if (!row) return null;
  return row.projectId ?? "global";
}

export async function getStatus(statusId: number) {
  const [result] = await db
    .select()
    .from(statuses)
    .where(eq(statuses.id, statusId));

  return result;
}
export async function getStatusesInProject(projectId: number) {
  const result = await db
    .select()
    .from(statuses)
    .where(or(eq(statuses.projectId, projectId), isNull(statuses.projectId)));

  return result;
}

export async function createStatus(data: NewStatus, actorId: string) {
  const [result] = await db.insert(statuses).values(data).returning();
  if (!result)
    throw new Error(`Failed to create status: ${JSON.stringify(data)}`);

  // A status created with no project is global (seeded, not project work)
  // and has no project feed to land in.
  if (result.projectId != null) {
    await recordActivity({
      projectId: result.projectId,
      entityType: "project",
      entityId: result.projectId,
      userId: actorId,
      action: "updated",
      before: { status: null },
      after: { status: statusChangeLabel(result) },
    });
  }

  return result;
}

export async function updateStatus(
  id: number,
  data: Partial<
    Pick<
      Status | NewStatus,
      "name" | "percentage" | "description" | "colourHex"
    >
  >,
  actorId: string
) {
  const existing = await getStatus(id);
  if (!existing) throw new HTTPException(404);

  if (existing.projectId === null) {
    throw new HTTPException(403, { message: GLOBAL_STATUS_CHANGE_REFUSAL });
  }

  const [result] = await db
    .update(statuses)
    .set(data)
    .where(eq(statuses.id, id))
    .returning();

  if (!result) throw new HTTPException(404);

  await recordActivity({
    projectId: existing.projectId,
    entityType: "project",
    entityId: existing.projectId,
    userId: actorId,
    action: "updated",
    before: { status: statusChangeLabel(existing) },
    after: { status: statusChangeLabel(result) },
  });

  return result;
}

/**
 * Global statuses — the seeded ones, identified by carrying no project — are
 * shared by every project and cannot be deleted from any one of them. The
 * route resolver refuses these first; the guard here covers any other caller.
 */
export async function deleteStatus(id: number, actorId: string) {
  const existing = await getStatus(id);
  if (!existing) throw new HTTPException(404);

  if (existing.projectId === null) {
    throw new HTTPException(403, { message: GLOBAL_STATUS_DELETE_REFUSAL });
  }

  const [result] = await db
    .delete(statuses)
    .where(eq(statuses.id, id))
    .returning();

  if (!result) throw new HTTPException(404);

  await recordActivity({
    projectId: existing.projectId,
    entityType: "project",
    entityId: existing.projectId,
    userId: actorId,
    action: "updated",
    before: { status: statusChangeLabel(result) },
    after: { status: null },
  });

  return result;
}

export function calculateStatus(statusHavers: { status?: Status | null }[]) {
  const total = 100 * statusHavers.length;
  const actual = statusHavers.reduce(
    (acc, cur) => acc + (cur.status?.percentage || 0),
    0
  );

  return total > 0 ? (actual / total) * 100 : 0;
}
