import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { db } from "../index.js";
import { publicUserMask, publicUserSchema } from "../schema/auth.js";
import {
  comments,
  commentSchema,
  type NewComment,
} from "../schema/comments.js";
import { rawCommentTargetEnum } from "../schema/enums.js";
import { COMMENT_TARGETS } from "../../entities/index.js";
import { type MemberRole, roleSatisfies } from "./authorization.js";

export const commentWithUserSchema = commentSchema.extend({
  user: publicUserSchema.nullable(),
  resolver: publicUserSchema.nullable(),
  viewerCan: z.object({ amend: z.boolean(), resolve: z.boolean() }),
});

export const commentWithRepliesSchema = commentWithUserSchema.extend({
  replies: z.array(commentWithUserSchema),
});

type CommentTarget = (typeof rawCommentTargetEnum)[number];

/**
 * Who is asking: their user id (null for an anonymous share reader) and their
 * role in the comment's project (null when they hold none, as a share guest).
 */
export type CommentActor = { userId: string | null; role: MemberRole | null };

/** An actor that writes: a write always has a signed-in user behind it. */
export type CommentWriter = CommentActor & { userId: string };

/**
 * What the actor may do with a comment: the author amends it; a member who is
 * the author or an editor resolves a top-level comment (a share guest, who has
 * no role, never does), and a reply is never resolved on its own.
 */
function withViewerCan<
  T extends { userId: string | null; parentId: number | null },
>(comment: T, actor: CommentActor) {
  const amend = actor.userId != null && comment.userId === actor.userId;
  const resolve =
    actor.role != null &&
    comment.parentId == null &&
    (amend || roleSatisfies(actor.role, "editor"));
  return { ...comment, viewerCan: { amend, resolve } };
}

/**
 * Resolver for `authorizeProject`: a comment's project is the project of the
 * entity it targets, which that entity answers for itself.
 */
export async function projectIdForCommentTarget(
  targetType: CommentTarget,
  targetId: number
) {
  if (Number.isNaN(targetId)) return null;
  return COMMENT_TARGETS[targetType].projectIdFor(targetId);
}

export async function projectIdForComment(commentId: number) {
  if (Number.isNaN(commentId)) return null;
  const [row] = await db
    .select({ projectId: comments.projectId })
    .from(comments)
    .where(eq(comments.id, commentId));
  return row?.projectId ?? null;
}

/**
 * A reply hangs under a comment on the same entity. Anything else — a parent on
 * a different target, in a different project, or gone — is not a thread this
 * comment can join, and is refused the same way a missing parent is so the
 * error says nothing about another project's comments.
 */
async function assertReplyParent(
  parentId: number,
  targetType: CommentTarget,
  targetId: number
) {
  const [parent] = await db
    .select({ targetType: comments.targetType, targetId: comments.targetId })
    .from(comments)
    .where(eq(comments.id, parentId));

  if (
    !parent ||
    parent.targetType !== targetType ||
    parent.targetId !== targetId
  ) {
    throw new HTTPException(404, {
      message: "Parent comment not found on this target",
    });
  }
}

export async function createComment(
  comment: Omit<NewComment, "projectId">,
  actor: CommentWriter,
  projectId: number
) {
  if (comment.parentId != null) {
    await assertReplyParent(
      comment.parentId,
      comment.targetType,
      comment.targetId
    );
  }

  const id = await db.transaction(async (tx) => {
    // The caller found the target when it resolved its project; the lock is
    // what keeps it there until the comment commits.
    const target = COMMENT_TARGETS[comment.targetType];
    if (
      target.lockForComment &&
      !(await target.lockForComment(tx, comment.targetId))
    ) {
      throw new HTTPException(404, { message: "Comment target not found" });
    }

    const [result] = await tx
      .insert(comments)
      .values({ ...comment, userId: actor.userId, projectId })
      .returning({ id: comments.id });

    if (!result) throw new Error("Failed to create comment");
    return result.id;
  });

  return getComment(id, actor);
}

/**
 * Comments on a track audio either mark a point on the waveform (`positionMs`)
 * or address the version as a whole (no position). The un-positioned ones read
 * as the general discussion and belong above the markers, so the ordering is
 * spelled out with `nulls first` rather than left to Postgres' `nulls last`
 * default for ascending sorts.
 */
const commentOrder = (c: typeof comments) => [
  sql`${c.positionMs} asc nulls first`,
  asc(c.createdAt),
];

export async function getCommentsForTarget(
  targetType: (typeof rawCommentTargetEnum)[number],
  targetId: number,
  actor: CommentActor
) {
  const results = await db.query.comments.findMany({
    where: {
      targetType,
      targetId,
      parentId: {
        isNull: true,
      },
    },
    with: {
      user: { columns: publicUserMask },
      resolver: { columns: publicUserMask },
      replies: {
        with: {
          user: { columns: publicUserMask },
          resolver: { columns: publicUserMask },
        },
        orderBy: commentOrder,
      },
    },
    orderBy: commentOrder,
  });

  return results.map((root) => ({
    ...withViewerCan(root, actor),
    replies: root.replies.map((reply) => withViewerCan(reply, actor)),
  }));
}

async function getComment(commentId: number, actor: CommentActor) {
  const result = await db.query.comments.findFirst({
    where: { id: commentId },
    with: {
      user: { columns: publicUserMask },
      resolver: { columns: publicUserMask },
    },
  });

  if (!result) throw new HTTPException(404);

  return withViewerCan(result, actor);
}

/** Which entity a comment sits on, for a caller that needs no more than that. */
export async function getCommentTarget(commentId: number) {
  const [row] = await db
    .select({ targetType: comments.targetType, targetId: comments.targetId })
    .from(comments)
    .where(eq(comments.id, commentId));

  if (!row) throw new HTTPException(404);

  return row;
}

/**
 * Tells a comment that is not there apart from one that belongs to someone
 * else. Only runs when a write matched no rows, so the ordinary path stays a
 * single statement.
 */
async function rejectUnownedComment(
  commentId: number,
  action: "edit" | "delete"
) {
  const [row] = await db
    .select({ id: comments.id })
    .from(comments)
    .where(eq(comments.id, commentId));

  return row
    ? new HTTPException(403, {
        message: `You can only ${action} your own comments`,
      })
    : new HTTPException(404);
}

export async function updateComment(
  commentId: number,
  data: Partial<NewComment>,
  actor: CommentWriter
) {
  // Ownership rides in the `where`, so a non-owner's update simply matches
  // nothing rather than being caught after a separate read.
  const [result] = await db
    .update(comments)
    .set(data)
    .where(and(eq(comments.id, commentId), eq(comments.userId, actor.userId)))
    .returning();

  if (!result) throw await rejectUnownedComment(commentId, "edit");

  return getComment(result.id, actor);
}

/**
 * Moves a top-level comment between open and resolved. The state check rides in
 * the `where`, so of two concurrent calls only one matches a row and reports
 * `changed`; a comment already in the wanted state keeps its resolver and time.
 */
async function setResolution(
  commentId: number,
  actor: CommentWriter,
  resolved: boolean
) {
  const existing = await getComment(commentId, actor);
  if (existing.parentId != null) {
    throw new HTTPException(400, {
      message: "Only a top-level comment can be resolved",
    });
  }
  if (!existing.viewerCan.resolve) {
    throw new HTTPException(403, {
      message: "Only the author or a project editor can resolve a comment",
    });
  }

  const [moved] = await db
    .update(comments)
    .set(
      resolved
        ? { resolvedAt: new Date(), resolvedBy: actor.userId }
        : { resolvedAt: null, resolvedBy: null }
    )
    .where(
      and(
        eq(comments.id, commentId),
        resolved ? isNull(comments.resolvedAt) : isNotNull(comments.resolvedAt)
      )
    )
    .returning({ id: comments.id });

  return { comment: await getComment(commentId, actor), changed: !!moved };
}

/** Resolves an open comment as the actor; a resolved one is left as it is. */
export function resolveComment(commentId: number, actor: CommentWriter) {
  return setResolution(commentId, actor, true);
}

/** Reopens a resolved comment; an open one is left as it is. */
export function reopenComment(commentId: number, actor: CommentWriter) {
  return setResolution(commentId, actor, false);
}

export async function deleteComment(commentId: number, userId: string) {
  const [result] = await db
    .delete(comments)
    .where(and(eq(comments.id, commentId), eq(comments.userId, userId)))
    .returning({ id: comments.id });

  if (!result) throw await rejectUnownedComment(commentId, "delete");

  return { deleted: true };
}
