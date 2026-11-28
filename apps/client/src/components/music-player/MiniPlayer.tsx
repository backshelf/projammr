"use client";

import { ArtField } from "@/components/music-player/ArtField";
import { CoverMorph } from "@/components/music-player/CoverMorph";
import { useIsMobile } from "@workspace/ui/hooks/use-mobile";
import { flickCommits } from "@/components/music-player/flick";
import { useNowPlaying } from "@/components/music-player/now-playing-context";
import {
  useCurrentArt,
  useCurrentTrack,
  useIsPlaying,
  useLabAltering,
  usePlayerActions,
} from "@/components/music-player/player-hooks";
import { Scrub } from "@/components/music-player/Scrub";
import { artistLabel, trackLabel } from "@/components/music-player/types";
import { VersionBadge } from "@/components/track-audio/VersionBadge";
import { imageUrl } from "@/lib/utils";
import { PlayGlyph } from "@/components/music-player/PlayGlyph";
import { IconPlayerSkipForwardFilled } from "@tabler/icons-react";
import { IconButton } from "@workspace/ui/components/icon-button";
import { TrackCell } from "@workspace/ui/components/table";
import { m, useDragControls } from "@workspace/ui/lib/motion";
import { LABEL } from "@workspace/ui/lib/shell";
import { cn } from "@workspace/ui/lib/utils";
import {
  useRef,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

/** How far the strip lifts before it is at its stop: the whole reach of the
 *  pull, and the distance a slow one has to cover to open the view. */
const PULL_REACH = 48;

/** Past this much travel the pointer was a pull rather than a tap, so the
 *  click it leaves behind belongs to the pull. */
const PULL_SLOP = 8;

/**
 * The phone's docked transport, above the tab bar: the playing track's
 * identity and the two controls a thumb reaches most often. Tinted the same
 * way as the desktop card — a blurred cover behind a paper scrim — because it
 * is the same surface at a smaller size, not a different one.
 *
 * A drag up the identity carries the whole strip with the finger, to the stop
 * at `PULL_REACH`, and opens the now-playing view when it commits — the same
 * motion that view's dismissal runs backwards. A pull that does not commit is
 * sprung back to the dock. The strip is sized from `--miniplayer-height`, not
 * from the `--miniplayer` reservation the dock flags on `body` a frame later,
 * so it never appears at zero height.
 */
export function MiniPlayer() {
  const current = useCurrentTrack();
  const art = useCurrentArt();
  const isPlaying = useIsPlaying();
  const { togglePlay, next } = usePlayerActions();
  const { coverInSheet, openFromCover, setOpen, setView } = useNowPlaying();
  const isPhone = useIsMobile();
  const labAltering = useLabAltering();

  const pull = useDragControls();
  const pulledRef = useRef(false);

  // The pull is the identity's: the play and next buttons and the scrubber own
  // the pointers that land on them, and a mouse has the click this gesture
  // stands in for. What moves is the whole strip, so the controls ride along.
  const startPull = (event: ReactPointerEvent) => {
    pulledRef.current = false;
    if (event.pointerType !== "touch") return;
    pull.start(event, { distanceThreshold: PULL_SLOP });
  };

  // A pull that snapped back must not then open what the snap-back refused,
  // and the click a finger leaves behind on release would do exactly that.
  const swallowPullClick = (event: ReactMouseEvent) => {
    if (!pulledRef.current) return;
    pulledRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  };

  if (!current) return null;

  const bare = !current.cover;

  return (
    <m.div
      drag={"y"}
      dragControls={pull}
      dragListener={false}
      dragConstraints={{ top: -PULL_REACH, bottom: 0 }}
      dragElastic={0.15}
      dragSnapToOrigin
      dragTransition={{ bounceStiffness: 600, bounceDamping: 40 }}
      onDragStart={() => {
        pulledRef.current = true;
      }}
      onDragEnd={(_, info) => {
        if (flickCommits(-info.offset.y, -info.velocity.y, PULL_REACH))
          openFromCover();
      }}
      className={
        "grain-surface relative isolate flex h-(--miniplayer-height) items-center gap-2 overflow-hidden px-(--gutter)"
      }
      style={art}
    >
      {!bare && <ArtField cover={current.cover ?? null} scrim={"card"} />}
      <div className={"absolute inset-x-0 top-0"}>
        <Scrub size={"hairline"} />
      </div>

      <button
        type={"button"}
        aria-label={"Now playing"}
        onClick={openFromCover}
        onPointerDownCapture={startPull}
        onClickCapture={swallowPullClick}
        className={cn("min-w-0 flex-1 touch-none text-left", !bare && "on-art")}
      >
        <TrackCell
          image={imageUrl(current.cover, 64)}
          size={"xl"}
          // The dock only exists on a phone; a hidden boundary elsewhere would
          // pair with the sheet's cover and animate from nowhere.
          wrapThumb={(thumb) => (
            <CoverMorph active={isPhone && !coverInSheet}>{thumb}</CoverMorph>
          )}
        >
          <span className={"min-w-0 flex-1"}>
            <span className={"block truncate text-small text-ink"}>
              {trackLabel(current)}
              {current.trackAudio && (
                <VersionBadge
                  version={current.trackAudio.version}
                  active
                  className={"ml-1.5 align-middle"}
                />
              )}
            </span>
            <span className={"block truncate text-micro text-ink-soft"}>
              {artistLabel(current)}
            </span>
          </span>
        </TrackCell>
      </button>

      {labAltering && (
        <button
          type={"button"}
          onClick={() => {
            setView("lab");
            setOpen(true);
          }}
          aria-label={"Lab active, open Lab"}
          className={cn(
            LABEL,
            "relative inline-flex h-4 shrink-0 items-center rounded-sm bg-art px-1 leading-none text-paper",
            "motion-press hover:opacity-85 focus-visible:ring-2 focus-visible:ring-art/40 focus-visible:outline-hidden",
            "coarse:after:absolute coarse:after:-inset-2 coarse:after:content-['']"
          )}
        >
          LAB
        </button>
      )}

      <IconButton
        size={"touch"}
        variant={"play"}
        aria-label={isPlaying ? "Pause" : "Play"}
        onClick={togglePlay}
      >
        <PlayGlyph playing={isPlaying} />
      </IconButton>
      <IconButton size={"touch"} aria-label={"Next"} onClick={next}>
        <IconPlayerSkipForwardFilled />
      </IconButton>
    </m.div>
  );
}
