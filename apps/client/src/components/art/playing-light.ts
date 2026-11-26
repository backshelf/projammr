import type { MusicPlayerTrack } from "@/components/music-player/types";

/** The entity a masthead's playback light watches: a track's own audio, or
 *  any track queued from a collection. */
export type PlaybackOwner = { kind: "track" | "collection"; id: number };

export type PlaybackState = "playing" | "paused" | null;

/** Whether the loaded item belongs to this page: the track itself, or any
 *  track queued from this collection. */
export const belongsTo = (
  current: MusicPlayerTrack | null,
  owner: PlaybackOwner
): boolean =>
  current != null &&
  (owner.kind === "collection"
    ? current.collectionId === owner.id
    : current.ownerType === "track" && current.ownerId === owner.id);

/** `null` when the page's own audio is not what the player holds. */
export const playbackState = (
  current: MusicPlayerTrack | null,
  isPlaying: boolean,
  owner: PlaybackOwner
): PlaybackState =>
  belongsTo(current, owner) ? (isPlaying ? "playing" : "paused") : null;
