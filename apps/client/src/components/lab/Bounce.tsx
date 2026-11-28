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
import { IconLoader2, IconUpload } from "@tabler/icons-react";
import { Button } from "@workspace/ui/components/button";
import { playedBars, WaveBars } from "@workspace/ui/components/waveform";
import { cn } from "@workspace/ui/lib/utils";
import { toBars } from "@workspace/ui/lib/waveform-bars";
import { useMemo } from "react";

/** Enough bars to read as the song's shape at the sheet's narrowest. */
const PRINT_BARS = 96;
const NO_PEAKS: number[] = [];

/**
 * Prints what the Lab plays to a local 24-bit FLAC download: the
 * `OfflineAudioContext` render and encode run behind the store's `bounce`
 * action, reporting each phase through `useBounce`. Once downloaded, an
 * opt-in `Upload` button lets the listener attach that rendered file to the
 * track via `uploadBounce`.
 *
 * The version's own waveform is the print. It waits in faint ink, and the
 * render draws it in the artwork colour from left to right as far as it has
 * really got; the encode, download and optional upload hold the finished print
 * while the caption updates, and an uploaded bounce links the attachment by
 * name. A failed render clears the print and says why; a failed upload keeps
 * the print and Upload button so the listener can retry. Without stored peaks
 * the caption alone carries the progress.
 */
export function Bounce({ current }: { current: MusicPlayerTrack }) {
  const status = useBounce();
  const { bounce, uploadBounce } = usePlayerActions();
  const view = bounceView(status);

  const peaks =
    useTrackAudioMeasure<number[]>(current.trackAudio?.id ?? null, "peaks") ??
    NO_PEAKS;
  const bars = useMemo(() => toBars(peaks, PRINT_BARS), [peaks]);

  const href =
    view.uploadedName != null && current.projectId != null
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
          {view.downloadedName && (
            <>
              {" · "}
              <span className="text-ink">{view.downloadedName}</span>
            </>
          )}
          {view.uploadedName && (
            <>
              {" · "}
              {href ? (
                <AppLink
                  href={href}
                  className="text-ink underline decoration-ink-faint underline-offset-2 hover:decoration-ink"
                >
                  {view.uploadedName}
                </AppLink>
              ) : (
                <span className="text-ink">{view.uploadedName}</span>
              )}
            </>
          )}
        </p>
        <div className="flex shrink-0 items-center gap-1">
          {view.canUpload && (
            <Button
              variant="ghost"
              size="sm"
              onClick={uploadBounce}
              disabled={view.running !== null}
            >
              {view.running === "upload" ? (
                <IconLoader2 className="animate-spin" />
              ) : (
                <IconUpload />
              )}
              Upload
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={bounce}
            disabled={view.running !== null}
          >
            Bounce
          </Button>
        </div>
      </div>
    </div>
  );
}
