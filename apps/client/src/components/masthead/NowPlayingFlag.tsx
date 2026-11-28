"use client";

import {
  playbackState,
  type PlaybackOwner,
} from "@/components/art/playing-light";
import {
  useCurrentTrack,
  useIsPlaying,
} from "@/components/music-player/player-hooks";
import { trackLabel } from "@/components/music-player/types";
import { AppLink } from "@/components/navigation/AppLink";
import { hrefFromParsedRoute } from "@/lib/utils";

/**
 * The masthead's quiet inline answer to the room's light when this page's
 * record is what the player holds: a small art dot beside `Playing`, or plain
 * ink beside `Paused`. On a collection page it names the playing track and
 * links to it inside this collection. Renders nothing when the player holds
 * something else.
 */
export function NowPlayingFlag({
  owner,
  projectId,
}: {
  owner: PlaybackOwner;
  projectId: number;
}) {
  const current = useCurrentTrack();
  const isPlaying = useIsPlaying();
  const state = playbackState(current, isPlaying, owner);

  if (state === null) return null;

  const isActive = state === "playing";
  const label = isActive ? "Playing" : "Paused";
  const dot = isActive ? (
    <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-art" />
  ) : null;

  if (owner.kind === "track" || !current) {
    return (
      <span className="inline-flex items-center gap-1.5 text-micro text-ink-soft">
        {dot}
        <span>{label}</span>
      </span>
    );
  }

  return (
    <AppLink
      href={hrefFromParsedRoute(
        {
          kind: "track",
          trackId: current.ownerId,
          collectionId: owner.id,
        },
        projectId
      )}
      className="inline-flex items-center gap-1.5 text-micro text-ink-soft motion-ink hover:text-ink"
    >
      {dot}
      <span>
        {label} · {trackLabel(current)}
      </span>
    </AppLink>
  );
}
