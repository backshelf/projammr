"use server";

import { serverApi } from "@/lib/server-api";
import { written } from "@/lib/write-action";
import {
  toActionOutcome,
  toActionResult,
} from "@workspace/api/lib/action-result";
import {
  ActionError,
  CommentWithReplies,
  CommentWithUser,
  NewComment,
} from "@workspace/api/api";
import type { CommentTarget } from "@workspace/api/lib/enums";

export const createComment = async (
  comment: Omit<NewComment, "userId">
): Promise<CommentWithUser | ActionError> => {
  const res = await serverApi.POST("/api/comments", { body: comment });

  return written(toActionResult(res, "Failed to create comment"));
};

export const getCommentsForTarget = async (
  targetType: CommentTarget,
  targetId: number
): Promise<CommentWithReplies[] | ActionError> => {
  const res = await serverApi.GET("/api/comments/{targetType}/{targetId}", {
    params: { path: { targetType, targetId: String(targetId) } },
  });

  if (res.response.ok && !res.data) return [];

  return toActionResult(res, "Failed to load comments");
};

export const updateComment = async (
  commentId: number,
  content: string
): Promise<CommentWithUser | ActionError> => {
  const res = await serverApi.PATCH("/api/comments/{id}", {
    params: { path: { id: String(commentId) } },
    body: { content },
  });

  return written(toActionResult(res, "Failed to update comment"));
};

export const resolveComment = async (
  commentId: number
): Promise<CommentWithUser | ActionError> => {
  const res = await serverApi.POST("/api/comments/{id}/resolve", {
    params: { path: { id: String(commentId) } },
  });

  return written(toActionResult(res, "Failed to resolve comment"));
};

export const reopenComment = async (
  commentId: number
): Promise<CommentWithUser | ActionError> => {
  const res = await serverApi.DELETE("/api/comments/{id}/resolve", {
    params: { path: { id: String(commentId) } },
  });

  return written(toActionResult(res, "Failed to reopen comment"));
};

export const deleteComment = async (
  commentId: number
): Promise<{ deleted: boolean } | ActionError> => {
  const res = await serverApi.DELETE("/api/comments/{id}", {
    params: { path: { id: String(commentId) } },
  });

  return written(
    toActionOutcome(res, "Failed to delete comment", {
      deleted: true,
    } as const)
  );
};
