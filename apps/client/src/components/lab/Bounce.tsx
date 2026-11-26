"use client";

import { bounceView } from "@/components/lab/bounce-view";
import { ownerRoute } from "@/components/music-player/owners";
import {
  useBounce,
  usePlayerActions,
} from "@/components/music-player/player-hooks";
import type { MusicPlayerTrack } from "@/components/music-player/types";
import { AppLink } from "@/components/navigation/AppLink";
import { useTrackAudioMeasure } from "@/components/track-audio/measures";
import { hrefFromParsedRoute } from "@/lib/utils";
import { IconLoader2 } from "@tabler/icons-react";
import { Button } from "@workspace/ui/components/button";
import { playedBars, WaveBars } from "@workspace/ui/components/waveform";
import { cn } from "@workspace/ui/lib/utils";
import { toBars } from "@workspace/ui/lib/waveform-bars";
import { useMemo } from "react";

/** Enough bars to read as the song's shape at the sheet's narrowest. */
const PRINT_BARS = 96;
const NO_PEAKS: number[] = [];

/**
 * Prints what the Lab plays as a track attachment: the `OfflineAudioContext`
 * render, the 24-bit FLAC encode and the upload run behind the store's
 * `bounce` action, which reports each phase through `useBounce`.
 *
 * The version's own waveform is the print. It waits in faint ink, and the
 * render draws it in the artwork colour from left to right as far as it has
 * really got; the encode and the upload hold the finished print while the
 * caption counts, and a finished bounce keeps it and links the attachment by
 * name. A failed bounce clears the print and says why, with the button free
 * to try again. Without stored peaks the caption alone carries the progress.
 */
export function Bounce({ current }: { current: MusicPlayerTrack }) {
  const status = useBounce();
  const { bounce } = usePlayerActions();
  const view = bounceView(status);

  const peaks =
    useTrackAudioMeasure<number[]>(current.trackAudio?.id ?? null, "peaks") ??
    NO_PEAKS;
  const bars = useMemo(() => toBars(peaks, PRINT_BARS), [peaks]);

  const href =
    view.doneName != null && current.projectId != null
      ? hrefFromParsedRoute(ownerRoute(current), current.projectId)
      : null;

  return (
    <div className="flex flex-col gap-2">
      {bars.length > 0 && (
        <div
          aria-hidden
          className="wave pointer-events-none flex h-8 items-center justify-between overflow-hidden"
          style={{
            ["--played" as string]: playedBars(view.printed, bars.length),
          }}
        >
          <WaveBars bars={bars} />
        </div>
      )}
      <div className="flex items-center gap-3">
        <p
          role="status"
          className={cn(
            "min-w-0 flex-1 truncate text-small tabular-nums",
            view.failed ? "text-danger" : "text-ink-soft"
          )}
        >
          {view.caption}
          {view.doneName && (
            <>
              {" · "}
              {href ? (
                <AppLink
                  href={href}
                  className="text-ink underline decoration-ink-faint underline-offset-2 hover:decoration-ink"
                >
                  {view.doneName}
                </AppLink>
              ) : (
                <span className="text-ink">{view.doneName}</span>
              )}
            </>
          )}
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={bounce}
          disabled={view.running}
        >
          {view.running && <IconLoader2 className="animate-spin" />}
          Bounce
        </Button>
      </div>
    </div>
  );
}
