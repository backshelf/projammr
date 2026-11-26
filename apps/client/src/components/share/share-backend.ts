import {
  createShareComment,
  deleteShareComment,
  getShareComments,
  updateShareComment,
} from "@/actions/sharelinks";
import type { CommentBackend } from "@/components/comments/comment-backend";

/**
 * The comment thread as a share link can reach it. Every call carries the
 * token, which is what the API authorises against — the reader holds no
 * membership of the project the track belongs to.
 */
export function shareCommentBackend(
  token: string,
  viewerId: string | null
): CommentBackend {
  return {
    viewerId,
    list: (_targetType, targetId) => getShareComments(token, targetId),
    create: (comment) =>
      createShareComment(token, {
        trackAudioId: comment.targetId,
        content: comment.content,
        positionMs: comment.positionMs ?? undefined,
        parentId: comment.parentId ?? undefined,
      }),
    update: (commentId, content) =>
      updateShareComment(token, commentId, content),
    remove: (commentId) => deleteShareComment(token, commentId),
  };
}
