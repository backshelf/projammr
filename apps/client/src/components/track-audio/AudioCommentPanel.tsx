"use client";

import { useEntityKey } from "@/components/commands/entity-surface";
import { AudioCommentSection } from "@/components/track-audio/AudioCommentSection";
import { useTrackAudio } from "@/components/track-audio/TrackAudioContext";
import { VersionBadge } from "@/components/track-audio/VersionBadge";
import {
  AUDIO_PILL,
  isAllResolved,
  versionCommentsLabel,
} from "@/components/track-audio/audio-ui";
import { IconMessage } from "@tabler/icons-react";
import { cn } from "@workspace/ui/lib/utils";
import { useRef } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover";

/**
 * The comment threads for the selected audio version, in a popover anchored to
 * the audio block. Threads belong to one version, so the header names it; a
 * marker click on the waveform opens the popover and scrolls to that thread.
 */
export function AudioCommentPanel() {
  const {
    selected,
    comments,
    reloadComments,
    registerScrollTarget,
    commentsOpen,
    setCommentsOpen,
  } = useTrackAudio();

  const composerRef = useRef<HTMLTextAreaElement>(null);
  // Set by the `c` key alone, so the popover it opens starts with the composer
  // focused while a click on the pill keeps the popover's own focus.
  const focusComposerRef = useRef(false);

  useEntityKey(
    "comment",
    () => {
      if (commentsOpen) {
        composerRef.current?.focus();
        return;
      }
      focusComposerRef.current = true;
      setCommentsOpen(true);
    },
    selected != null
  );

  if (!selected) return null;

  const resolvedCount = comments.filter(
    (comment) => comment.resolvedAt != null
  ).length;
  const allResolved = isAllResolved(comments.length, resolvedCount);
  const label = versionCommentsLabel(
    comments.length,
    selected.version,
    resolvedCount
  );

  return (
    <Popover
      open={commentsOpen}
      onOpenChange={(open) => {
        if (!open) focusComposerRef.current = false;
        setCommentsOpen(open);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(AUDIO_PILL, allResolved && "border-rule")}
        >
          <IconMessage aria-hidden />
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        aria-label={label}
        initialFocus={() =>
          focusComposerRef.current ? (composerRef.current ?? true) : true
        }
        className="max-h-96 w-[min(26rem,calc(100vw-3rem))] overflow-y-auto p-3.5 px-4 pb-4 text-left"
      >
        <div className="mb-1 flex items-center gap-2 border-b border-rule pb-2.5">
          <VersionBadge version={selected.version} active />
          <span className="font-sub text-micro tracking-[0.1em] text-ink-soft uppercase">
            {allResolved ? label : "Comments on this version"}
          </span>
          {comments.length > 0 && !allResolved && (
            <span className="ml-auto text-micro text-ink-soft">
              {comments.length}
            </span>
          )}
        </div>
        <AudioCommentSection
          composerRef={composerRef}
          trackAudioId={selected.id}
          assetId={selected.assetId}
          comments={comments}
          onCommentsChange={reloadComments}
          registerScrollTarget={registerScrollTarget}
        />
      </PopoverContent>
    </Popover>
  );
}
