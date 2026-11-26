"use client";

import { ArtField } from "@/components/music-player/ArtField";
import {
  useCurrentArt,
  useCurrentTrack,
} from "@/components/music-player/player-hooks";
import { useNowPlaying } from "@/components/music-player/now-playing-context";
import { ownerRoute } from "@/components/music-player/owners";
import {
  SecondaryControls,
  Transport,
} from "@/components/music-player/PlayerControls";
import { QueuePopover } from "@/components/music-player/QueuePopover";
import { Scrub } from "@/components/music-player/Scrub";
import { SidebarReveal } from "@/components/sidebar/SidebarReveal";
import { artistLabel, trackLabel } from "@/components/music-player/types";
import { AppLink } from "@/components/navigation/AppLink";
import { VersionBadge } from "@/components/track-audio/VersionBadge";
import { hrefFromParsedRoute } from "@/lib/utils";
import { IconArrowsDiagonal, IconPlaylist } from "@tabler/icons-react";
import { IconButton } from "@workspace/ui/components/icon-button";
import { useSidebar } from "@workspace/ui/components/sidebar";
import { cn } from "@workspace/ui/lib/utils";

/**
 * The playing track's cover, used as a surface rather than a thumbnail. The
 * card sits in the bottom-left corner: inside the sidebar column beneath the
 * account row while the sidebar is open, and floating over the page as a
 * detached card once it closes. It is a desktop surface — a phone gets the
 * mini-player and the now-playing view instead.
 *
 * The artwork is the only colour here; everything drawn on top is white or
 * near-black over a scrim.
 */
const CARD = cn(
  "group/player fixed bottom-0 left-0 isolate z-40 hidden flex-col justify-end overflow-hidden md:flex",
  "px-3.5 pt-2.5 pb-2",
  // A border on all four sides from the start, with the three that are flush
  // against the viewport left transparent. The detached state only recolours
  // them, so the box never changes size when the two states cross-fade.
  "border border-transparent",
  // Geometry, not just ink: no motion utility covers the corner the card
  // travels to, so the property list is spelled out on the shared scale.
  "transition-[bottom,left,width,border-color,border-radius,background-color,box-shadow]",
  "duration-(--dur-settle) ease-arrive"
);

const CARD_ANCHORED = cn(
  "min-h-(--player-card) w-[var(--sidebar-width,16rem)]",
  "rounded-none border-t-rule bg-paper-sunk"
);

/** Detached, glass replaces the solid fill because what the card now sits over
 *  is page content, and a shadow makes it an object resting on the page. */
const CARD_DETACHED = cn(
  "bottom-3 left-3 min-h-0 w-60 rounded-lg border-glass-edge bg-glass",
  "shadow-float backdrop-blur-[20px] backdrop-saturate-[1.3]"
);

export const MusicPlayer = () => {
  const current = useCurrentTrack();
  const art = useCurrentArt();
  const { state } = useSidebar();
  const { setOpen } = useNowPlaying();

  // A closed sidebar is what makes this a card: the panel it was part of is
  // gone, so it detaches from the corner.
  const detached = state === "collapsed";

  // Nothing playing, or a track with no cover: no artwork theatre, just the
  // panel. The scrim goes with the art — over a bare panel it would only mute
  // the type it exists to make legible.
  const bare = !current?.cover;

  const route = current ? ownerRoute(current) : null;

  const trackHref =
    current?.projectId != null && route
      ? hrefFromParsedRoute(route, current.projectId)
      : null;

  return (
    <div
      className={cn(CARD, detached ? CARD_DETACHED : CARD_ANCHORED)}
      style={art}
      data-bare={bare ? "" : undefined}
    >
      {!bare && <ArtField cover={current?.cover ?? null} scrim={"card"} />}

      <div className={cn("flex flex-col gap-2", !bare && "on-art")}>
        <div className={"min-w-0"}>
          <span
            className={
              "block truncate text-small text-ink [&_a:hover]:underline"
            }
          >
            {current ? (
              trackHref ? (
                <AppLink href={trackHref}>{trackLabel(current)}</AppLink>
              ) : (
                trackLabel(current)
              )
            ) : (
              "Nothing playing"
            )}
            {current?.trackAudio && (
              <VersionBadge
                version={current.trackAudio.version}
                active
                className={"ml-1.5 align-middle"}
              />
            )}
          </span>
          <span
            className={cn(
              "block truncate text-micro",
              bare ? "text-ink-soft" : "on-art-soft"
            )}
          >
            {current &&
              [current.album, artistLabel(current)].filter(Boolean).join(" · ")}
          </span>
        </div>

        {/* The transport is centred under the identity, with the queue and the
            sidebar reveal pushed to the trailing edge, so the play button
            stays the optical centre of the card. */}
        <div className={"flex items-center justify-center gap-0.5"}>
          <SecondaryControls.Volume size={"card"} />
          <Transport size={"card"} />
          <SecondaryControls.Overflow size={"card"} />
          <span className={"ml-auto flex items-center gap-0.5"}>
            <IconButton
              aria-label={"Now playing"}
              onClick={() => setOpen(true)}
            >
              <IconArrowsDiagonal />
            </IconButton>
            <QueuePopover>
              <IconButton aria-label={"Queue"}>
                <IconPlaylist />
              </IconButton>
            </QueuePopover>
            <SidebarReveal />
          </span>
        </div>
      </div>

      <Scrub size={"card"} detached={detached} />
    </div>
  );
};
