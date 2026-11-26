"use client";

import { StatusChip } from "@workspace/ui/components/status-chip";
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
 * The masthead's answer to the room's light: `Playing`/`Paused` beside the
 * status pill when this page's own record is what the player holds. On a
 * collection page it names the playing track and links to it inside this
 * collection. Renders nothing when the player holds something else.
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

  const label = state === "playing" ? "Playing" : "Paused";

  if (owner.kind === "track" || !current) {
    return (
      <StatusChip flag colour="var(--art)">
        {label}
      </StatusChip>
    );
  }

  return (
    <StatusChip flag colour="var(--art)">
      <AppLink
        href={hrefFromParsedRoute(
          {
            kind: "track",
            trackId: current.ownerId,
            collectionId: owner.id,
          },
          projectId
        )}
      >
        {label} · {trackLabel(current)}
      </AppLink>
    </StatusChip>
  );
}
