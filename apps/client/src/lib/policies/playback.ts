/**
 * How the player behaves: what a fresh browser starts with, how far a seek
 * moves, what the queue does at its edges, which version of a track plays,
 * and how tracks meet. The signed-in shell hands its policy in through
 * `PoliciesProvider` and the player store's `initial`; anywhere outside it
 * (the share page) plays by {@link DEFAULT_PLAYBACK}, which is the player as
 * it has always behaved.
 */

import type { RepeatMode } from "@/components/music-player/types";
import type { VersionToPlay } from "@workspace/settings/groups/playback";

/** What the player does once the last track in the queue has ended. */
export type QueueEnd =
  /** Stays on the last track, stopped at its end. */
  | "stop"
  /** Goes back to the first track in the queue, stopped. */
  | "rewind"
  /** Empties the queue. */
  | "clear";

/** What a row's play button queues for a track listed inside a collection. */
type RowPlayContext =
  /** The collection, from this track on. */
  | "collection"
  /** This track alone. */
  | "track";

export type { VersionToPlay };

/** What playing a track that has no track audio does. */
type NoAudioFallback =
  /** Plays the newest audio attachment, saying so. */
  | "attachment"
  /** Says the track has no audio and plays nothing. */
  | "none";

export type PlaybackPolicy = {
  /** The volume a browser with none stored starts at, 0..1. */
  defaultVolume: number;
  startMuted: boolean;
  repeat: RepeatMode;
  shuffle: boolean;
  /** Whether the queue and its position survive a reload. */
  persistQueue: boolean;
  /** Seconds an arrow key seeks by; Shift takes the large step. */
  seekSmallSeconds: number;
  seekLargeSeconds: number;
  /** Past this many seconds in, "previous" restarts the track instead. */
  previousRestartsAfterSeconds: number;
  queueEnd: QueueEnd;
  /** Whether queueing into an idle player starts playing what was queued. */
  queueingStarts: boolean;
  rowPlayContext: RowPlayContext;
  versionToPlay: VersionToPlay;
  noAudioFallback: NoAudioFallback;
  /**
   * Whether a touch device routes through Web Audio for a surface that
   * reads the audio (the lava field, the live meters). Off keeps a phone
   * playing with its screen locked.
   */
  analysisOnTouch: boolean;
  /** Seconds the end of one track overlaps the start of the next; 0 cuts. */
  crossfadeSeconds: number;
};

/** The seconds one seek key moves by: the large step with Shift held. */
export const seekStep = (policy: PlaybackPolicy, large: boolean) =>
  large ? policy.seekLargeSeconds : policy.seekSmallSeconds;

export const DEFAULT_PLAYBACK: PlaybackPolicy = {
  defaultVolume: 1,
  startMuted: false,
  repeat: "off",
  shuffle: false,
  persistQueue: false,
  seekSmallSeconds: 5,
  seekLargeSeconds: 30,
  previousRestartsAfterSeconds: 3,
  queueEnd: "stop",
  queueingStarts: true,
  rowPlayContext: "collection",
  versionToPlay: "primary",
  noAudioFallback: "attachment",
  analysisOnTouch: false,
  crossfadeSeconds: 0,
};
