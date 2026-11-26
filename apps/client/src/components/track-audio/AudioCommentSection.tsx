"use client";

import CommentCompose from "@/components/comments/CommentCompose";
import CommentList from "@/components/comments/CommentList";
import { excerptOf } from "@/components/comments/excerpt";
import {
  useCurrentAssetId,
  useMusicPlayerStore,
  usePlayerActions,
} from "@/components/music-player/player-hooks";
import {
  useCommentBackend,
  type CommentBackend,
} from "@/components/comments/comment-backend";
import { useShellPolicy } from "@/lib/policies/provider";
import type { CommentWithReplies } from "@workspace/api/api";
import { isActionError } from "@workspace/api/lib/action-result";
import {
  type Ref,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/**
 * Comments pinned to a point in one audio version. Markers for these are drawn
 * by TrackAudioSection, which owns the scrubber; this component owns the
 * threads and hands their positions upward.
 */
export function AudioCommentSection({
  trackAudioId,
  assetId,
  comments,
  onCommentsChange,
  registerScrollTarget,
  onSeek,
  composerRef,
}: {
  /** The composer's textarea, for a caller that moves focus into it. */
  composerRef?: Ref<HTMLTextAreaElement>;
  trackAudioId: number;
  assetId: number;
  comments: CommentWithReplies[];
  onCommentsChange: () => void;
  registerScrollTarget: (
    commentId: number,
    node: HTMLDivElement | null
  ) => void;
  /** What following a timecode means here. Without one, a timecode leads
   *  somewhere only while this audio is the loaded one. */
  onSeek?: (positionMs: number) => void;
}) {
  const store = useMusicPlayerStore();
  const { seek } = usePlayerActions();
  const currentAssetId = useCurrentAssetId();
  const { audioCommentPinned } = useShellPolicy();

  const isLoaded = currentAssetId === assetId;
  // A new comment starts pinned to the playhead when the viewer's policy says
  // so, and only on the audio that is loaded: there is no playhead elsewhere.
  const pinnedByDefault = audioCommentPinned && isLoaded;

  const [pinned, setPinned] = useState(pinnedByDefault);
  const [composePosition, setComposePosition] = useState(0);

  // Pinning follows whichever audio is loaded, so the default resets when the
  // selected version changes or playback moves to another asset.
  const [pinnedFor, setPinnedFor] = useState({ trackAudioId, isLoaded });
  if (
    pinnedFor.trackAudioId !== trackAudioId ||
    pinnedFor.isLoaded !== isLoaded
  ) {
    setPinnedFor({ trackAudioId, isLoaded });
    setPinned(pinnedByDefault);
  }

  // A comment pins to wherever the playhead was when composing began, so the
  // chip does not tick along with playback while a comment is being written.
  const capturePosition = () => {
    setComposePosition(Math.round(store.getProgress() * 1000));
  };

  const handleTogglePinned = () => {
    if (!pinned) capturePosition();
    setPinned((value) => !value);
  };

  const handleSeek = useCallback(
    (positionMs: number) => {
      if (!isLoaded) return;
      seek(positionMs / 1000);
    },
    [isLoaded, seek]
  );

  return (
    <div>
      <div className="mb-4">
        <CommentCompose
          entityType="track_audio"
          entityId={trackAudioId}
          inputRef={composerRef}
          positionMs={pinned ? composePosition : null}
          onTogglePinned={isLoaded ? handleTogglePinned : undefined}
          onComposeStart={isLoaded && pinned ? capturePosition : undefined}
          onPosted={onCommentsChange}
        />
      </div>
      <CommentList
        comments={comments}
        onSeek={onSeek ?? (isLoaded ? handleSeek : undefined)}
        onChange={onCommentsChange}
        registerItem={registerScrollTarget}
      />
    </div>
  );
}

const NO_COMMENTS: CommentWithReplies[] = [];

/** Loads the threads for one audio version and re-fetches when it changes. */
const useAudioComments = (trackAudioId: number, backend?: CommentBackend) => {
  const contextBackend = useCommentBackend();
  const { list } = backend ?? contextBackend;

  const [state, setState] = useState<{
    trackAudioId: number;
    comments: CommentWithReplies[];
  }>({ trackAudioId, comments: [] });
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    if (!trackAudioId) return;

    const request = ++requestRef.current;
    const result = await list("track_audio", trackAudioId);
    if (request !== requestRef.current) return;

    setState({
      trackAudioId,
      comments: isActionError(result) ? [] : result,
    });
  }, [trackAudioId, list]);

  useEffect(() => {
    load();
  }, [load]);

  // Threads from the previously selected version are dropped immediately, so a
  // slow fetch never draws markers against the wrong audio.
  const comments =
    state.trackAudioId === trackAudioId ? state.comments : NO_COMMENTS;

  return { comments, reload: load };
};

/**
 * One audio version's threads, plus the two things every surface showing them
 * beside a waveform needs: the positions to pin above it, and a way to scroll
 * to the thread a pin belongs to.
 */
export const useCommentThread = (
  trackAudioId: number,
  backend?: CommentBackend
) => {
  const { comments, reload } = useAudioComments(trackAudioId, backend);
  const threadNodesRef = useRef(new Map<number, HTMLDivElement>());

  const commentMarks = useMemo(
    () =>
      comments
        .filter(
          (comment): comment is typeof comment & { positionMs: number } =>
            typeof comment.positionMs === "number"
        )
        .map((comment) => ({
          id: comment.id,
          positionMs: comment.positionMs,
          author: comment.user?.name,
          excerpt: excerptOf(comment.content),
          resolved: comment.resolvedAt != null,
          resolvedBy: comment.resolver?.name,
        })),
    [comments]
  );

  const registerScrollTarget = useCallback(
    (commentId: number, node: HTMLDivElement | null) => {
      if (node) threadNodesRef.current.set(commentId, node);
      else threadNodesRef.current.delete(commentId);
    },
    []
  );

  // A thread may have no node yet — the panel it lives in has to open first —
  // so the scroll waits a frame for the content to mount.
  const scrollToComment = useCallback((commentId: number) => {
    requestAnimationFrame(() => {
      threadNodesRef.current.get(commentId)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });
  }, []);

  // Stable between renders, so a context built on the thread (the share
  // room's) only changes when the thread does.
  return useMemo(
    () => ({
      comments,
      reload,
      commentMarks,
      registerScrollTarget,
      scrollToComment,
    }),
    [comments, reload, commentMarks, registerScrollTarget, scrollToComment]
  );
};
