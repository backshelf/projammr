import {
  fromAudioOwner,
  type MusicPlayerTrack,
} from "@/components/music-player/types";
import type { ProjectToday } from "@workspace/api/api";

/** One linked track-audio version, as the project's today read reports it. */
export type TodayRender = ProjectToday["renders"][number];

/**
 * The player's track for one known version: exactly the audio that landed, not
 * the track's primary. With no owner the playable carries no cover or title,
 * and the row falls back to the asset's name.
 */
export function renderToPlayable(row: TodayRender): MusicPlayerTrack {
  return {
    asset: row.asset,
    ownerType: "track",
    ownerId: row.trackId,
    ...fromAudioOwner(row.owner),
    trackAudio: {
      id: row.id,
      version: row.version,
      isPrimary: row.isPrimary,
    },
  };
}
