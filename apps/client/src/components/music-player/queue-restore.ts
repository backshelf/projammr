/**
 * A kept queue fetched afresh: each entry is read again from the server, so a
 * restored queue plays what exists now and carries the metadata the server
 * has now. A version that is gone, a file that is gone, or a read that fails
 * resolves to null, for the caller to drop.
 */

import { audioToPlayable } from "@/components/music-player/play-track";
import type { StoredQueueEntry } from "@/components/music-player/player-storage";
import type {
  MusicPlayerTrack,
  PlayableAsset,
} from "@/components/music-player/types";
import { clientGetAsset, clientGetTrackAudios } from "@/lib/client-api";
import type { PlayableTrackAudio } from "@workspace/api/api";
import { isActionError } from "@workspace/api/lib/action-result";

/** The reads a restore makes; tests pass fakes. */
export type QueueReads = {
  /** A track's versions, or null when they cannot be read. */
  trackAudios: (trackId: number) => Promise<PlayableTrackAudio[] | null>;
  /** A file and the project it sits in, or null once it is gone. */
  asset: (
    assetId: number
  ) => Promise<(PlayableAsset & { projectId: number }) | null>;
};

const browserQueueReads: QueueReads = {
  async trackAudios(trackId) {
    const audios = await clientGetTrackAudios(trackId);
    return isActionError(audios) ? null : audios;
  },
  async asset(assetId) {
    const asset = await clientGetAsset(assetId);
    return asset === null || isActionError(asset) ? null : asset;
  },
};

/**
 * Each of `entries` as the player's track, or null where it no longer
 * resolves, in the order given. A track's versions are read once however
 * many of its versions the queue holds.
 */
export async function resolveStoredQueue(
  entries: readonly StoredQueueEntry[],
  reads: QueueReads = browserQueueReads
): Promise<(MusicPlayerTrack | null)[]> {
  const versions = new Map<number, Promise<PlayableTrackAudio[] | null>>();
  const versionsOf = (trackId: number) => {
    let read = versions.get(trackId);
    if (!read) {
      read = reads.trackAudios(trackId).catch(() => null);
      versions.set(trackId, read);
    }
    return read;
  };

  async function resolve(
    entry: StoredQueueEntry
  ): Promise<MusicPlayerTrack | null> {
    if (entry.kind === "version") {
      const audios = await versionsOf(entry.trackId);
      const audio = audios?.find(({ id }) => id === entry.trackAudioId);
      return audio ? audioToPlayable(entry.trackId, audio) : null;
    }
    const asset = await reads.asset(entry.assetId).catch(() => null);
    if (!asset) return null;
    return {
      asset: { id: asset.id, name: asset.name, assetPath: asset.assetPath },
      ownerType: entry.ownerType,
      ownerId: entry.ownerId,
      projectId: asset.projectId,
    };
  }

  return Promise.all(entries.map(resolve));
}
