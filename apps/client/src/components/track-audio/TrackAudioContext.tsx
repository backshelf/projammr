"use client";

import { useCommentThread } from "@/components/track-audio/AudioCommentSection";
import type {
  CommentWithReplies,
  TrackAudioWithAsset,
} from "@workspace/api/api";
import type { CommentMark } from "@workspace/ui/components/waveform";
import {
  createContext,
  type PropsWithChildren,
  use,
  useMemo,
  useState,
} from "react";

type TrackAudioContextValue = {
  audios: TrackAudioWithAsset[];
  primaryAudio: TrackAudioWithAsset | null;
  selected: TrackAudioWithAsset | null;
  selectedAudioId: number;
  setSelectedAudioId: (id: number) => void;
  comments: CommentWithReplies[];
  reloadComments: () => void;
  commentMarks: CommentMark[];
  registerScrollTarget: (id: number, node: HTMLDivElement | null) => void;
  scrollToComment: (id: number) => void;
  commentsOpen: boolean;
  setCommentsOpen: (open: boolean) => void;
};

const TrackAudioContext = createContext<TrackAudioContextValue | null>(null);

export const useTrackAudio = () => {
  const value = use(TrackAudioContext);
  if (!value)
    throw new Error("Track audio components require a TrackAudioProvider");
  return value;
};

/**
 * The waveform and the comment panel sit in different parts of the track page
 * but share a selected version, its threads and the panel's open state, so that
 * state lives here rather than in either of them.
 */
export function TrackAudioProvider({
  audios,
  primaryAudio,
  children,
}: PropsWithChildren<{
  audios: TrackAudioWithAsset[];
  primaryAudio: TrackAudioWithAsset | null;
}>) {
  const [selectedAudioId, setSelectedAudioId] = useState(primaryAudio?.id ?? 0);
  const [commentsOpen, setCommentsOpen] = useState(false);

  const selected =
    audios.find((audio) => audio.id === selectedAudioId) ?? primaryAudio;

  const {
    comments,
    reload: reloadComments,
    commentMarks,
    registerScrollTarget,
    scrollToComment,
  } = useCommentThread(selected?.id ?? 0);

  const value = useMemo(
    () => ({
      audios,
      primaryAudio,
      selected,
      selectedAudioId,
      setSelectedAudioId,
      comments,
      reloadComments,
      commentMarks,
      registerScrollTarget,
      scrollToComment,
      commentsOpen,
      setCommentsOpen,
    }),
    [
      audios,
      primaryAudio,
      selected,
      selectedAudioId,
      comments,
      reloadComments,
      commentMarks,
      registerScrollTarget,
      scrollToComment,
      commentsOpen,
    ]
  );

  return <TrackAudioContext value={value}>{children}</TrackAudioContext>;
}
