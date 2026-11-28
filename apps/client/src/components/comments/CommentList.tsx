"use client";

import {
  canAmend,
  canReply,
  canResolve,
  useCommentBackend,
} from "@/components/comments/comment-backend";
import { useComposeKey } from "@/components/comments/use-compose-key";
import { useDeleteGate } from "@/hooks/use-delete-gate";
import { initials } from "@/lib/utils";
import { ConfirmDeleteDialog } from "@workspace/ui/components/confirm-delete-dialog";
import { useFormat } from "@workspace/ui/components/format-provider";
import { formatTimecode } from "@workspace/ui/lib/format";
import {
  Compose,
  ComposeField,
  ComposeFoot,
  ComposeHint,
  ComposeInput,
  Stamp,
  STAMP_SHAPE,
} from "@/components/comments/compose-ui";
import { IconClock } from "@tabler/icons-react";
import { AnimatePresence, m, OPTICAL } from "@workspace/ui/lib/motion";
import { useCoarsePointer } from "@workspace/ui/hooks/use-coarse-pointer";
import { useIsApplePlatform } from "@workspace/ui/hooks/use-apple-platform";
import { cn } from "@workspace/ui/lib/utils";
import {
  ActionError,
  CommentWithReplies,
  CommentWithUser,
} from "@workspace/api/api";
import { isActionError } from "@workspace/api/lib/action-result";
import { useState } from "react";
import { toast } from "sonner";

export default function CommentList({
  comments,
  onSeek,
  onChange,
  registerItem,
}: {
  comments: CommentWithReplies[] | ActionError;
  onSeek?: (positionMs: number) => void;
  onChange?: () => void;
  registerItem?: (commentId: number, node: HTMLDivElement | null) => void;
}) {
  if (isActionError(comments)) {
    return <p className="text-body text-ink-soft">Failed to load comments</p>;
  }

  if (comments.length === 0) {
    return <p className="text-small text-ink-soft">No comments yet.</p>;
  }

  return (
    <div>
      {/* A comment posted after the list was drawn fades in at its place, and
          one that is deleted fades out of it. */}
      <AnimatePresence initial={false}>
        {comments.map((comment) => (
          <CommentItem
            key={comment.id}
            comment={comment}
            onSeek={onSeek}
            onChange={onChange}
            registerItem={registerItem}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}

/** The actions under a comment: bare buttons that answer on colour alone. */
const COMMENT_ACTIONS = cn(
  "mt-1.5 flex gap-3.5 text-micro text-ink-soft",
  "[&_button]:cursor-pointer [&_button]:border-none [&_button]:bg-transparent",
  "[&_button]:p-0 [&_button]:text-inherit",
  "[&_button:hover]:text-ink",
  "[&_button]:coarse:flex [&_button]:coarse:min-h-11 [&_button]:coarse:items-center"
);

function CommentItem({
  comment,
  isReply = false,
  parentResolved = false,
  onSeek,
  onChange,
  registerItem,
}: {
  comment: CommentWithReplies | CommentWithUser;
  isReply?: boolean;
  parentResolved?: boolean;
  onSeek?: (positionMs: number) => void;
  onChange?: () => void;
  registerItem?: (commentId: number, node: HTMLDivElement | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [replying, setReplying] = useState(false);
  const [replyContent, setReplyContent] = useState("");
  const [content, setContent] = useState(comment.content);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);

  const backend = useCommentBackend();
  const apple = useIsApplePlatform();
  const coarse = useCoarsePointer();
  const format = useFormat();
  const user = comment.user;

  // Every backend's writes are `written()`, so the route is already re-rendered
  // in the action's own response. `onChange` is for a surface holding its own
  // copy of the thread (the audio rail); everyone else needs nothing here.
  const refresh = onChange ?? (() => {});
  const amendable = canAmend(backend, comment);
  const resolved = comment.resolvedAt != null;
  // A reply is settled along with the thread it sits under.
  const settled = resolved || parentResolved;

  const handleToggleResolved = async () => {
    const toggle = resolved ? backend.reopen : backend.resolve;
    if (!toggle) return;
    setToggling(true);
    const result = await toggle(comment.id);
    setToggling(false);
    if (isActionError(result)) {
      toast.error(result.error);
      return;
    }
    refresh();
  };

  const handleSave = async () => {
    if (content.trim() === "") return;
    setSaving(true);
    const result = await backend.update(comment.id, content);
    if (!isActionError(result)) setEditing(false);
    setSaving(false);
    refresh();
  };

  const handleCancel = () => {
    setContent(comment.content);
    setEditing(false);
  };

  const handleDelete = async () => {
    await backend.remove(comment.id);
    refresh();
  };
  const deletion = useDeleteGate("comment", handleDelete);

  const handleReply = async () => {
    if (replyContent.trim() === "") return;
    const result = await backend.create({
      targetType: comment.targetType,
      targetId: comment.targetId,
      content: replyContent.trim(),
      parentId: comment.id,
      positionMs: comment.positionMs,
    });
    if (isActionError(result)) {
      toast.error("Failed to post reply");
      return;
    }
    setReplying(false);
    setReplyContent("");
    refresh();
  };

  // Only live while `replying`, so the reply box's `mod+Enter` never shadows
  // the root composer's when both happen to hold focus during a transition.
  const replyKey = useComposeKey(handleReply, replying);

  const replies = "replies" in comment ? comment.replies || [] : [];
  const positionMs = comment.positionMs;

  return (
    <m.div
      ref={(node) => registerItem?.(comment.id, node)}
      variants={OPTICAL}
      initial={"hidden"}
      animate={"shown"}
      exit={"leaving"}
    >
      <div
        className={cn(
          "flex gap-3 border-t border-rule py-3.5 first:border-t-0",
          isReply && "ml-10"
        )}
      >
        <span
          className={cn(
            "grid size-7 shrink-0 place-items-center rounded-full text-micro text-ink",
            "bg-[color-mix(in_oklab,var(--art)_22%,var(--paper-sunk))]"
          )}
        >
          {user ? initials(user.name) : "?"}
        </span>
        <div className="min-w-0 flex-1">
          <div className="mb-[0.1875rem] flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span
              className={cn(
                "text-small motion-ink",
                settled ? "text-ink-soft" : "text-ink"
              )}
            >
              {user?.name || "Unknown"}
            </span>
            <span className="text-micro text-ink-soft tabular-nums">
              {format.relative(comment.createdAt)}
            </span>
            {typeof positionMs === "number" && onSeek && (
              <Stamp
                onClick={() => onSeek(positionMs)}
                title="Jump to this point"
              >
                <IconClock />
                {formatTimecode(positionMs)}
              </Stamp>
            )}
            {comment.resolvedAt != null && (
              <span
                className={cn(
                  STAMP_SHAPE,
                  "bg-paper-sunk text-ink-soft motion-ink"
                )}
              >
                Resolved · {comment.resolver?.name || "Unknown"} ·{" "}
                {format.relative(comment.resolvedAt)}
              </span>
            )}
          </div>

          {editing ? (
            <div className="flex flex-col gap-2">
              <ComposeInput
                className="rounded-md border border-rule px-2 py-1"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={3}
                autoFocus
              />
              <div className={COMMENT_ACTIONS}>
                <button onClick={handleSave} disabled={saving}>
                  Save
                </button>
                <button onClick={handleCancel} disabled={saving}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className="text-small/[1.65] [overflow-wrap:anywhere] whitespace-pre-wrap text-ink-soft">
                {comment.content}
              </p>
              <div className={COMMENT_ACTIONS}>
                {!isReply && canReply(backend) && (
                  <button onClick={() => setReplying((r) => !r)}>Reply</button>
                )}
                {!isReply && canResolve(backend, comment) && (
                  <button onClick={handleToggleResolved} disabled={toggling}>
                    {resolved ? "Reopen" : "Resolve"}
                  </button>
                )}
                {amendable && (
                  <>
                    <button onClick={() => setEditing(true)}>Edit</button>
                    <button onClick={() => deletion.request()}>Delete</button>
                    <ConfirmDeleteDialog
                      {...deletion.dialog}
                      title={
                        isReply ? "Delete this reply?" : "Delete this comment?"
                      }
                      description={
                        replies.length > 0
                          ? "Its replies go with it. This cannot be undone."
                          : undefined
                      }
                    />
                  </>
                )}
              </div>

              {replying && (
                <Compose {...replyKey.focusProps}>
                  <ComposeField>
                    <ComposeInput
                      onKeyDown={replyKey.onKeyDown}
                      value={replyContent}
                      onChange={(e) => setReplyContent(e.target.value)}
                      placeholder={
                        coarse
                          ? "Write a reply…"
                          : `Write a reply… (${apple ? "⌘+Enter" : "Ctrl+Enter"} to post)`
                      }
                      rows={2}
                      autoFocus
                    />
                    <ComposeFoot>
                      <ComposeHint />
                      <button
                        className="flex items-center text-small coarse:min-h-11"
                        onClick={handleReply}
                        disabled={replyContent.trim() === ""}
                      >
                        Reply
                      </button>
                    </ComposeFoot>
                  </ComposeField>
                </Compose>
              )}
            </>
          )}
        </div>
      </div>

      {replies.map((reply) => (
        <CommentItem
          key={reply.id}
          comment={{ ...reply } as CommentWithReplies}
          isReply
          parentResolved={resolved}
          onChange={onChange}
        />
      ))}
    </m.div>
  );
}
