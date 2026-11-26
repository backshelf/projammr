"use client";

import {
  collectionToPlayable,
  trackToPlayable,
} from "@/components/music-player/play-track";
import {
  useIsCurrent,
  useIsPlaying,
  usePlayerActions,
} from "@/components/music-player/player-hooks";
import type { MusicPlayerTrack } from "@/components/music-player/types";
import { usePlaybackPolicy } from "@/lib/policies/provider";
import { useCallback, useState } from "react";

export type PlaybackSubject = {
  kind: "track" | "collection";
  id: number;
  title?: string;
  /** The collection a track is being played from, for "play from here". */
  collectionId?: number;
  /** An already-resolved version of the track, when the caller holds one. */
  playable?: MusicPlayerTrack;
};

/**
 * Playback of one entity from any surface that shows it — the desktop row's
 * play column, the phone card's artwork, the action sheet's Play row. The
 * subject is resolved to playable items on demand; a subject that is already
 * loaded toggles the transport instead of resolving again.
 */
export function usePlayback({
  kind,
  id,
  title,
  collectionId,
  playable,
}: PlaybackSubject) {
  const { playNow, playNext, enqueue, togglePlay } = usePlayerActions();
  const isLoaded = useIsCurrent(kind, id, playable?.asset.id);
  const isPlaying = useIsPlaying();
  const [loading, setLoading] = useState(false);
  const { versionToPlay, noAudioFallback, rowPlayContext } =
    usePlaybackPolicy();

  const showPause = isLoaded && isPlaying;

  const resolve = useCallback((): Promise<MusicPlayerTrack[] | null> => {
    if (playable) return Promise.resolve([playable]);
    return kind === "track"
      ? trackToPlayable(id, { versionToPlay, noAudioFallback }, title)
      : collectionToPlayable(id, versionToPlay);
  }, [kind, id, title, playable, versionToPlay, noAudioFallback]);

  const run = useCallback(
    async (apply: (items: MusicPlayerTrack[]) => void) => {
      setLoading(true);
      try {
        const items = await resolve();
        if (items && items.length > 0) apply(items);
      } finally {
        setLoading(false);
      }
    },
    [resolve]
  );

  const playInContext = useCallback(async () => {
    if (
      kind !== "track" ||
      collectionId === undefined ||
      rowPlayContext === "track"
    ) {
      return run((items) => playNow(items));
    }
    setLoading(true);
    try {
      const items = await collectionToPlayable(collectionId, versionToPlay);
      if (!items || items.length === 0) return;
      const startIndex = items.findIndex((item) => item.ownerId === id);
      if (startIndex < 0) {
        const single = await trackToPlayable(
          id,
          { versionToPlay, noAudioFallback },
          title
        );
        if (single && single.length > 0) playNow(single);
        return;
      }
      playNow(items, startIndex);
    } finally {
      setLoading(false);
    }
  }, [
    kind,
    collectionId,
    rowPlayContext,
    id,
    title,
    versionToPlay,
    noAudioFallback,
    run,
    playNow,
  ]);

  const toggle = useCallback(
    () => (isLoaded ? togglePlay() : playInContext()),
    [isLoaded, togglePlay, playInContext]
  );

  const queueNext = useCallback(() => run(playNext), [run, playNext]);
  const queueLast = useCallback(() => run(enqueue), [run, enqueue]);

  return {
    isLoaded,
    showPause,
    loading,
    toggle,
    playInContext,
    queueNext,
    queueLast,
  };
}
