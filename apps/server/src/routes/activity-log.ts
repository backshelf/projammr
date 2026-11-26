import { recordActivity, recordActivityBatch } from "../db/queries/activity.js";
import type { Comment } from "../db/schema/comments.js";
import { COMMENT_TARGETS } from "../entities/index.js";
import type { EntityKind } from "../entities/types.js";

/**
 * The identity is all these helpers read from the request, so they accept any
 * context that carries one — the authenticated routes and the root app alike.
 */
type Ctx = { get(key: "user"): { id: string } | null | undefined };

function actor(c: Ctx): string | null {
  return c.get("user")?.id ?? null;
}

/** Log that the caller created one entity. */
export function logCreate(
  c: Ctx,
  entityType: EntityKind,
  projectId: number,
  entityId: number
): Promise<void> {
  return recordActivity({
    projectId,
    entityType,
    entityId,
    userId: actor(c),
    action: "created",
  });
}

/** Log the field changes between `before` and `after` for one entity. */
export function logUpdate(
  c: Ctx,
  entityType: EntityKind,
  entityId: number,
  projectId: number,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  ignoredFields?: readonly string[]
): Promise<void> {
  return recordActivity({
    projectId,
    entityType,
    entityId,
    userId: actor(c),
    action: "updated",
    before,
    after,
    ignoredFields,
  });
}

/** Log that the caller deleted one entity. */
export function logDelete(
  c: Ctx,
  entityType: EntityKind,
  projectId: number,
  entityId: number
): Promise<void> {
  return recordActivity({
    projectId,
    entityType,
    entityId,
    userId: actor(c),
    action: "deleted",
  });
}

/**
 * Log that the caller deleted every entity in `entityIds`, in one write. The
 * rows are gone by the time this runs, so the project is passed in rather than
 * read off each of them.
 */
export function logDeletes(
  c: Ctx,
  entityType: EntityKind,
  projectId: number,
  entityIds: number[]
): Promise<void> {
  return recordActivityBatch(
    entityIds.map((entityId) => ({
      projectId,
      entityType,
      entityId,
      userId: actor(c),
      action: "deleted" as const,
    }))
  );
}

/**
 * Log that the caller archived (or unarchived) every entity in `entityIds`, in
 * one write: a row apiece, with no diff since the action is the whole change.
 */
export function logArchives(
  c: Ctx,
  entityType: EntityKind,
  projectId: number,
  entityIds: number[],
  action: "archived" | "unarchived"
): Promise<void> {
  return recordActivityBatch(
    entityIds.map((entityId) => ({
      projectId,
      entityType,
      entityId,
      userId: actor(c),
      action,
    }))
  );
}

/**
 * Every write that moves a note across the boundary of a track's lyrics slot
 * — linking, unlinking, creating already-linked, or deleting a linked note —
 * logs the same `updated` activity on that track, in whichever direction the
 * link moved. `logUpdate` diffs `before`/`after` itself, so only the two
 * documents need naming here. Shared by the REST notes routes and the MCP
 * notebook tools, over `activityContext(actor)` for the latter.
 */
export function logLinkChange(
  c: Ctx,
  link: { projectId: number; trackId: number },
  action: "linked" | "unlinked"
): Promise<void> {
  const [before, after] =
    action === "linked" ? [null, "linked"] : ["linked", null];
  return logUpdate(
    c,
    "track",
    link.trackId,
    link.projectId,
    {
      lyrics: before,
    },
    { lyrics: after }
  );
}

/**
 * Log that the caller commented on something, or resolved or reopened a
 * comment. The row hangs off the commented entity rather than the comment, so
 * it names that entity and shows in its scoped feed; the excerpt is read back
 * through `commentId`.
 */
export async function logComment(
  c: Ctx,
  comment: Comment,
  projectId: number | null,
  action: "commented" | "resolved" | "reopened" = "commented"
): Promise<void> {
  const target = await COMMENT_TARGETS[comment.targetType].activityTarget(
    comment.targetId
  );
  if (!target) return;

  return recordActivity({
    projectId,
    entityType: target.entityType,
    entityId: target.entityId,
    userId: actor(c),
    action,
    commentId: comment.id,
  });
}
