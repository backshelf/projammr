import { getMusicPlayerMetadata } from "@/actions/player-metadata";
import {
  MusicPlayerMetadata,
  MusicPlayerTrack,
} from "@/components/music-player/types";

/**
 * The audio endpoints describe what they hand back, so anything queued through
 * them arrives complete. This fills in the rest — an audio attachment played
 * straight off an entity page — one request at a time in play order. Results
 * are cached by asset id for the life of the store, failures included, so a
 * lookup is never repeated because the queue changed around it. A rebuilt queue
 * carries fresh bare track objects, so cached results are re-applied to it
 * immediately rather than skipped.
 */
export function createMetadataLoader(
  apply: (assetId: number, meta: MusicPlayerMetadata) => void
) {
  const resolved = new Map<number, MusicPlayerMetadata>();
  const failed = new Set<number>();
  let pending: MusicPlayerTrack[] = [];
  let generation = 0;
  let draining = false;

  const isWanted = (track: MusicPlayerTrack) =>
    !track.metadataResolved &&
    !resolved.has(track.asset.id) &&
    !failed.has(track.asset.id);

  async function drain() {
    draining = true;
    try {
      while (pending.length > 0) {
        const generationAtStart = generation;
        const track = pending.shift()!;
        if (!isWanted(track)) continue;

        try {
          const meta = await getMusicPlayerMetadata({
            ownerType: track.ownerType,
            ownerId: track.ownerId,
          });
          if (generation !== generationAtStart) break;
          if (!meta) {
            failed.add(track.asset.id);
            continue;
          }
          resolved.set(track.asset.id, meta as MusicPlayerMetadata);
          apply(track.asset.id, meta as MusicPlayerMetadata);
        } catch {
          if (generation !== generationAtStart) break;
          failed.add(track.asset.id);
        }
      }
    } finally {
      draining = false;
      // A cancel() during an in-flight lookup breaks the loop above with the
      // superseded generation; anything cancel() and a following prefetch()
      // left queued belongs to the new generation and still needs draining.
      if (pending.length > 0) void drain();
    }
  }

  return {
    prefetch(tracks: MusicPlayerTrack[]) {
      const queued = new Set(pending.map((t) => t.asset.id));
      for (const track of tracks) {
        if (track.metadataResolved) continue;
        const cached = resolved.get(track.asset.id);
        if (cached) {
          apply(track.asset.id, cached);
          continue;
        }
        if (!isWanted(track) || queued.has(track.asset.id)) continue;
        queued.add(track.asset.id);
        pending.push(track);
      }
      if (pending.length > 0 && !draining) void drain();
    },
    /** Abandons queued and in-flight lookups without discarding the cache. */
    cancel() {
      generation++;
      pending = [];
    },
  };
}
