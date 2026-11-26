import {
  artistLabel,
  trackLabel,
  type MusicPlayerTrack,
} from "@/components/music-player/types";
import { IconVolume } from "@tabler/icons-react";

/**
 * The loaded track at the head of a queue listing, in the same row shape as
 * the upcoming ones so the two read as one list. It carries no controls: the
 * queue's actions are all about what comes next.
 */
export function CurrentTrackRow({ track }: { track: MusicPlayerTrack }) {
  const artists = artistLabel(track);

  return (
    <div className={"flex shrink-0 items-center gap-1 bg-ink/4 px-2 py-1"}>
      <span className={"p-0.5 text-art"} aria-hidden>
        <IconVolume size={14} />
      </span>
      <div className={"min-w-0 flex-1"}>
        <p className={"truncate text-small font-semibold"}>
          {trackLabel(track)}
        </p>
        {artists && (
          <p className={"truncate text-micro text-ink-soft"}>{artists}</p>
        )}
      </div>
    </div>
  );
}
