"use client";

import {
  createComment,
  deleteComment,
  getCommentsForTarget,
  reopenComment,
  resolveComment,
  updateComment,
} from "@/actions/comments";
import type {
  ActionError,
  CommentWithReplies,
  CommentWithUser,
  NewComment,
} from "@workspace/api/api";
import type { CommentTarget } from "@workspace/api/lib/enums";
import { createContext, use, type ReactNode } from "react";

/**
 * Where a comment thread reads and writes. The thread components render the
 * same way wherever they appear; what changes between surfaces is which
 * endpoints they are allowed to reach — the project's own comment routes for a
 * member, a share link's token-gated ones for whoever holds the link.
 */
export type CommentBackend = {
  list: (
    targetType: CommentTarget,
    targetId: number
  ) => Promise<CommentWithReplies[] | ActionError>;
  create: (
    comment: Omit<NewComment, "userId">
  ) => Promise<CommentWithUser | ActionError>;
  update: (
    commentId: number,
    content: string
  ) => Promise<CommentWithUser | ActionError>;
  remove: (commentId: number) => Promise<{ deleted: boolean } | ActionError>;
  /** Mark a thread resolved. A surface that leaves it out never offers the control. */
  resolve?: (commentId: number) => Promise<CommentWithUser | ActionError>;
  /** Undo `resolve`. */
  reopen?: (commentId: number) => Promise<CommentWithUser | ActionError>;
  /**
   * Who is reading, for replying only: `null` is a reader with no identity at
   * all, who can only read, and anyone else may reply. What a reader may edit,
   * delete or resolve is the server's answer, carried on each comment as
   * `viewerCan`.
   */
  viewerId?: string | null;
};

const projectComments: CommentBackend = {
  list: getCommentsForTarget,
  create: createComment,
  update: updateComment,
  remove: deleteComment,
  resolve: resolveComment,
  reopen: reopenComment,
};

const CommentBackendContext = createContext<CommentBackend>(projectComments);

export const useCommentBackend = () => use(CommentBackendContext);

type Permitted = Pick<CommentWithUser, "viewerCan">;

/** Whether this reader may rewrite or remove a comment, as the server says. */
export function canAmend(_backend: CommentBackend, comment: Permitted) {
  return comment.viewerCan.amend;
}

/** Whether this reader may resolve or reopen a comment on this surface. */
export function canResolve(backend: CommentBackend, comment: Permitted) {
  return backend.resolve != null && comment.viewerCan.resolve;
}

/** Whether this reader may answer a thread at all. */
export function canReply(backend: CommentBackend) {
  return backend.viewerId !== null;
}

export function CommentBackendProvider({
  backend,
  children,
}: {
  backend: CommentBackend;
  children: ReactNode;
}) {
  return (
    <CommentBackendContext value={backend}>{children}</CommentBackendContext>
  );
}
