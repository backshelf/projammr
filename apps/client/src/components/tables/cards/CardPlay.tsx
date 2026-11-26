"use client";

import { PlayGlyph } from "@/components/music-player/PlayGlyph";
import { usePlayback } from "@/components/music-player/use-playback";
import { IconButton } from "@workspace/ui/components/icon-button";

import type { RowCardPlay } from "./row-card-model";

/**
 * The card's artwork as its play control: a tap on the thumb plays the row, a
 * tap on the title opens it — the split the desktop row makes with its own
 * play column. A bare icon, the same treatment every other play affordance
 * gets, over the same hit area the thumb already occupies.
 */
export function CardPlayButton({
  play,
  entityLabel,
}: {
  play: RowCardPlay;
  entityLabel: string;
}) {
  const { showPause: playing, loading: resolving, toggle } = usePlayback(play);
  return (
    <IconButton
      variant="play"
      size="touch"
      className="on-art absolute inset-0"
      aria-label={`${playing ? "Pause" : "Play"} ${entityLabel} ${play.title}`}
      disabled={resolving}
      onClick={() => void toggle()}
    >
      <PlayGlyph playing={playing} loading={resolving} />
    </IconButton>
  );
}
