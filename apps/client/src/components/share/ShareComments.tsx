"use client";

import CommentList from "@/components/comments/CommentList";
import { useShareRoom } from "@/components/share/ShareRoom";
import { ShareSignIn } from "@/components/share/ShareSignIn";
import { AudioCommentSection } from "@/components/track-audio/AudioCommentSection";
import { SectionHead } from "@workspace/ui/components/layout/section-head";
import { cn } from "@workspace/ui/lib/utils";

/** Who can see comments on a share, next to where a reader would compose one.
 *  A public share lists them back to every viewer of the link, not just the
 *  poster; a private one narrows a guest to their own. */
const VISIBILITY = {
  public: "Anyone with this link and the project's members can see comments.",
  private:
    "Comments here are private: you see your own, and the project's members see all of them.",
};

/** Compose and thread for a reader who holds a session, guest or member. */
function CommentThread() {
  const { entry, seek, thread } = useShareRoom();
  if (!entry) return null;

  return (
    <AudioCommentSection
      trackAudioId={entry.trackAudioId}
      assetId={entry.assetId}
      comments={thread.comments}
      onCommentsChange={thread.reload}
      registerScrollTarget={thread.registerScrollTarget}
      onSeek={seek}
    />
  );
}

/** What a reader with no session sees: the thread, and the way to be able to
 *  join it. */
function ReadOnlyThread({ onArt }: { onArt: boolean }) {
  const { seek, thread } = useShareRoom();

  return (
    <>
      <CommentList
        comments={thread.comments}
        onSeek={seek}
        registerItem={thread.registerScrollTarget}
      />
      <p
        className={cn("mt-6 text-small text-ink-soft", onArt && "on-art-soft")}
      >
        Sign in as a guest to leave a comment.
      </p>
      <ShareSignIn />
    </>
  );
}

/**
 * The share's comments on the audio it is showing. A share with nothing to
 * play has no audio to comment on, so it draws nothing.
 */
export function ShareComments() {
  const { sharelink, viewerId, entry, artwork, thread } = useShareRoom();
  if (!entry) return null;

  const onArt = artwork !== null;

  return (
    <section className={cn(onArt && "on-art")}>
      <SectionHead count={thread.comments.length || undefined}>
        Comments
      </SectionHead>
      <p
        className={cn("mb-3 text-micro text-ink-soft", onArt && "on-art-soft")}
      >
        {VISIBILITY[sharelink.isCommentsPrivate ? "private" : "public"]}
      </p>
      {viewerId ? <CommentThread /> : <ReadOnlyThread onArt={onArt} />}
    </section>
  );
}
