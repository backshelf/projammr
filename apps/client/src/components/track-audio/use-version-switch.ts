"use client";

import {
  usePlayerActions,
  useMusicPlayerStore,
} from "@/components/music-player/player-hooks";
import type { MusicPlayerTrack } from "@/components/music-player/types";
import { browserApi } from "@/lib/browser-api";
import type { TrackAudioWithAsset } from "@workspace/api/api";
import { useEffect, useState } from "react";

/**
 * The versions of the playing track and the swap rule, for any surface that
 * shows the player rather than the track page (the track page already has
 * the sibling versions from `useTrackAudio()`). Fetches lazily, only while
 * `enabled`, so a surface that isn't visible doesn't fire the request.
 */
export function useVersionSwitch(
  current: MusicPlayerTrack | null,
  enabled: boolean
) {
  const trackId = current?.ownerType === "track" ? current.ownerId : null;
  const [loaded, setLoaded] = useState<{
    trackId: number;
    audios: TrackAudioWithAsset[];
  } | null>(null);

  // The versions are only this track's while they name it. Playing a
  // different track leaves the previous list in state until its own fetch
  // lands, and offering that list would swap in an asset from the track that
  // is no longer playing.
  const audios = loaded?.trackId === trackId ? loaded.audios : null;

  useEffect(() => {
    if (!enabled || trackId === null) return;

    const ctrl = new AbortController();
    browserApi
      .GET("/api/tracks/{id}/audios", {
        params: { path: { id: String(trackId) } },
        signal: ctrl.signal,
      })
      .then((r) => {
        if (r.data) setLoaded({ trackId, audios: r.data });
      })
      .catch((error: unknown) => {
        // Closing the sheet aborts the request; only a real failure surfaces.
        if (!ctrl.signal.aborted) throw error;
      });

    return () => ctrl.abort();
  }, [trackId, enabled]);

  const { playAt } = usePlayerActions();
  const store = useMusicPlayerStore();

  const select = (audioId: number) => {
    const next = audios?.find((a) => a.id === audioId);
    if (!next || !current || next.asset.id === current.asset.id) return;
    playAt(swapVersion(current, next), store.getProgress());
  };

  return {
    audios,
    select,
    available: trackId !== null && (audios?.length ?? 0) > 1,
  };
}

/**
 * The same track at another version: identity fields kept, asset and
 * trackAudio replaced.
 */
export function swapVersion(
  track: MusicPlayerTrack,
  audio: TrackAudioWithAsset
): MusicPlayerTrack {
  return {
    ...track,
    asset: audio.asset,
    trackAudio: {
      id: audio.id,
      version: audio.version,
      isPrimary: audio.isPrimary,
      lufs: audio.lufs,
    },
  };
}
