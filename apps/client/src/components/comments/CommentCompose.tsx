"use client";

import { useCommentBackend } from "@/components/comments/comment-backend";
import {
  Compose,
  ComposeField,
  ComposeFoot,
  ComposeHint,
  ComposeInput,
  Stamp,
} from "@/components/comments/compose-ui";
import { useComposeKey } from "@/components/comments/use-compose-key";
import { formatTimecode } from "@workspace/ui/lib/format";
import { IconClock } from "@tabler/icons-react";
import { isActionError } from "@workspace/api/lib/action-result";
import { useIsApplePlatform } from "@workspace/ui/hooks/use-apple-platform";
import { type Ref, useState } from "react";
import { toast } from "sonner";

export type CommentEntityType =
  "project" | "collection" | "track" | "session" | "track_audio";

export default function CommentCompose({
  entityType,
  entityId,
  positionMs,
  onTogglePinned,
  onComposeStart,
  onPosted,
  inputRef,
}: {
  entityType: CommentEntityType;
  entityId: number;
  positionMs?: number | null;
  onTogglePinned?: () => void;
  onComposeStart?: () => void;
  onPosted?: () => void;
  /** The composer's textarea, for a caller that moves focus into it. */
  inputRef?: Ref<HTMLTextAreaElement>;
}) {
  const backend = useCommentBackend();
  const apple = useIsApplePlatform();

  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (content.trim() === "") return;
    setSaving(true);

    const result = await backend.create({
      targetType: entityType,
      targetId: entityId,
      content: content.trim(),
      positionMs: positionMs ?? null,
    });

    setSaving(false);

    if (isActionError(result)) {
      toast.error("Failed to post comment");
      return;
    }

    setContent("");

    onPosted?.();
  };

  const composeKey = useComposeKey(handleSubmit);

  const pinned = positionMs !== null && positionMs !== undefined;

  return (
    <Compose {...composeKey.focusProps}>
      <ComposeField>
        <ComposeInput
          ref={inputRef}
          onKeyDown={composeKey.onKeyDown}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onFocus={() => {
            if (content === "") onComposeStart?.();
          }}
          placeholder="Write a comment…"
          rows={2}
        />
        <ComposeFoot>
          {onTogglePinned ? (
            <Stamp
              onClick={onTogglePinned}
              title={
                pinned
                  ? "Switch to a general comment"
                  : "Pin this comment to the playhead"
              }
            >
              <IconClock />
              {pinned ? `At ${formatTimecode(positionMs)}` : "General comment"}
            </Stamp>
          ) : (
            <ComposeHint className="coarse:hidden">
              {apple ? "⌘+Enter to post" : "Ctrl+Enter to post"}
            </ComposeHint>
          )}
          <button
            type="button"
            className="flex items-center text-small coarse:min-h-11"
            onClick={handleSubmit}
            disabled={saving || content.trim() === ""}
          >
            {saving ? "Posting…" : "Comment"}
          </button>
        </ComposeFoot>
      </ComposeField>
    </Compose>
  );
}
