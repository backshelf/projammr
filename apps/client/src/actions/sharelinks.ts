"use server";

import { serverApi } from "@/lib/server-api";
import { shareActionError } from "@/lib/share-links";
import { written } from "@/lib/write-action";
import {
  isActionError,
  toActionOutcome,
  toActionResult,
} from "@workspace/api/lib/action-result";
import type {
  ActionError,
  CommentWithReplies,
  CommentWithUser,
  ConvertSharelinkRequest,
  EditSharelink,
  NewShareComment,
  NewShareRequest,
  ShareOption,
  Sharelink,
} from "@workspace/api/api";

/** A call on one link, whose failure on a dead link names why it is dead. */
async function onLink<T>(
  result: Promise<T | ActionError>
): Promise<T | ActionError> {
  const value = await result;
  return isActionError(value) ? shareActionError(value) : value;
}

/** The raw envelope: the share page picks its shell from the status and
 *  `code`, so no message is imposed here. */
export const getSharelink = async (
  token: string
): Promise<Sharelink | ActionError> => {
  const res = await serverApi.GET("/api/share/{token}", {
    params: { path: { token } },
  });

  return toActionResult(res, "Failed to load this share");
};

/** Every link on an entity, for the editor managing them. Expired links are
 *  included — extending one is why an editor opens this list. */
export const listSharelinks = async (
  entityType: NewShareRequest["entityType"],
  entityId: number
): Promise<Sharelink[] | ActionError> => {
  const res = await serverApi.GET("/api/share", {
    params: { query: { entityType, entityId: String(entityId) } },
  });

  return toActionResult(res, "Failed to load share links");
};

export const getShareOptions = async (
  entityType: NewShareRequest["entityType"],
  entityId: number
): Promise<ShareOption[] | ActionError> => {
  const res = await serverApi.GET("/api/share/options", {
    params: { query: { entityType, entityId: String(entityId) } },
  });

  return toActionResult(res, "Failed to load the versions to share");
};

export const createSharelink = async (
  shareType: Sharelink["shareType"],
  body: NewShareRequest
): Promise<Sharelink | ActionError> => {
  const res = await serverApi.POST(
    shareType === "snapshot" ? "/api/share/snapshot" : "/api/share/connected",
    { body }
  );

  return written(toActionResult(res, "Failed to create the share link"));
};

export const updateSharelink = async (
  token: string,
  patch: EditSharelink
): Promise<Sharelink | ActionError> => {
  const res = await serverApi.PATCH("/api/share/{token}", {
    params: { path: { token } },
    body: patch,
  });

  return written(
    onLink(toActionResult(res, "Failed to update the share link"))
  );
};

export const updateSharelinkTracks = async (
  token: string,
  body: NonNullable<NewShareRequest["snapshotOverrides"]>
): Promise<Sharelink | ActionError> => {
  const res = await serverApi.PATCH("/api/share/{token}/tracks", {
    params: { path: { token } },
    body,
  });

  return written(
    onLink(toActionResult(res, "Failed to update the shared versions"))
  );
};

export const convertSharelink = async (
  token: string,
  body: ConvertSharelinkRequest
): Promise<Sharelink | ActionError> => {
  const res = await serverApi.POST("/api/share/{token}/convert", {
    params: { path: { token } },
    body,
  });

  return written(
    onLink(toActionResult(res, "Failed to convert the share link"))
  );
};

export const deleteSharelink = async (
  token: string
): Promise<{ deleted: true } | ActionError> => {
  const res = await serverApi.DELETE("/api/share/{token}", {
    params: { path: { token } },
  });

  return written(
    toActionOutcome(res, "Failed to delete the share link", {
      deleted: true,
    } as const)
  );
};

export const getShareComments = async (
  token: string,
  trackAudioId: number
): Promise<CommentWithReplies[] | ActionError> => {
  const res = await serverApi.GET("/api/share/{token}/comments", {
    params: { path: { token }, query: { id: String(trackAudioId) } },
  });

  if (res.response.ok && !res.data) return [];

  return onLink(toActionResult(res, "Failed to load comments"));
};

export const createShareComment = async (
  token: string,
  comment: NewShareComment
): Promise<CommentWithUser | ActionError> => {
  const res = await serverApi.POST("/api/share/{token}/comments", {
    params: { path: { token } },
    body: comment,
  });

  return written(onLink(toActionResult(res, "Failed to post your comment")));
};

export const updateShareComment = async (
  token: string,
  commentId: number,
  content: string
): Promise<CommentWithUser | ActionError> => {
  const res = await serverApi.PATCH("/api/share/{token}/comments/{id}", {
    params: { path: { token, id: String(commentId) } },
    body: { content },
  });

  return written(onLink(toActionResult(res, "Failed to update your comment")));
};

export const deleteShareComment = async (
  token: string,
  commentId: number
): Promise<{ deleted: boolean } | ActionError> => {
  const res = await serverApi.DELETE("/api/share/{token}/comments/{id}", {
    params: { path: { token, id: String(commentId) } },
  });

  return written(
    onLink(
      toActionOutcome(res, "Failed to delete your comment", {
        deleted: true,
      } as const)
    )
  );
};
