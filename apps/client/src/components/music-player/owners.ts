import { ENTITIES } from "@/entities";
import type { MusicPlayerTrack } from "@/components/music-player/types";
import type { ParsedRoute } from "@/lib/route-parser";

/**
 * The page a playing item links back to: its owner kind's own page, from the
 * entity registry, keeping the collection it was reached through when its
 * kind needs one.
 */
export const ownerRoute = (track: MusicPlayerTrack): ParsedRoute =>
  ENTITIES[track.ownerType].pageRoute(track.ownerId, {
    collectionId: track.collectionId,
  });
