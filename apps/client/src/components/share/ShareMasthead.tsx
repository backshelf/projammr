"use client";

import { mastheadTitle } from "@/components/masthead/Masthead";
import { useMastheadScroll } from "@/components/motion/masthead-scroll";
import {
  SecondaryControls,
  Transport,
} from "@/components/music-player/PlayerControls";
import { PlayGlyph } from "@/components/music-player/PlayGlyph";
import {
  useDuration,
  useIsPlaying,
  useLoadError,
  usePlayerActions,
  useProgressFrames,
  writeAttribute,
  writeText,
} from "@/components/music-player/player-hooks";
import { progressReadout } from "@/components/music-player/scrub-math";
import { useShareRoom } from "@/components/share/ShareRoom";
import { VersionBadge } from "@/components/track-audio/VersionBadge";
import { TrackWaveform } from "@/components/track/TrackWaveform";
import { shareFacts, shareTitle } from "@/lib/share-links";
import { IconDownload } from "@tabler/icons-react";
import { Button } from "@workspace/ui/components/button";
import { useFormat } from "@workspace/ui/components/format-provider";
import { IconButton } from "@workspace/ui/components/icon-button";
import { useArrival } from "@workspace/ui/components/motion/arrival";
import { m } from "@workspace/ui/lib/motion";
import { COLUMN, EYEBROW } from "@workspace/ui/lib/shell";
import { cn } from "@workspace/ui/lib/utils";
import { useRef } from "react";

/**
 * Elapsed/total once this entry is the one actually playing; otherwise the
 * total the server measured, so a reader knows how long the mix runs before
 * committing to pressing play. The accessible name spells out what the "/"
 * only implies visually.
 *
 * While playing, the elapsed half is written straight onto the DOM by
 * {@link useProgressFrames}, so the position never re-renders this or the
 * page around it.
 */
export function DurationReadout({
  loaded,
  durationMs,
  onArt,
}: {
  loaded: boolean;
  durationMs: number | null | undefined;
  onArt: boolean;
}) {
  const playerDuration = useDuration();
  const format = useFormat();
  const live = loaded && playerDuration > 0;
  const liveRef = useRef<HTMLSpanElement>(null);

  useProgressFrames((seconds) => {
    if (!live) return;
    const readout = progressReadout(seconds, playerDuration, "elapsed-total");
    writeText(liveRef.current, `${readout.lead} / ${readout.trail}`);
    writeAttribute(
      liveRef.current,
      "aria-label",
      `${readout.valueText} played`
    );
  });

  const className = cn(
    "shrink-0 text-micro text-ink-soft tabular-nums",
    onArt && "on-art-soft"
  );

  // Keyed apart so React never owns the text the draw writes into the live one.
  if (live) return <span key={"live"} ref={liveRef} className={className} />;

  if (durationMs == null) return null;

  return (
    <span
      key={"total"}
      aria-label={`${format.duration(durationMs)} total`}
      className={className}
    >
      {format.duration(durationMs)}
    </span>
  );
}

/**
 * The first viewport of a share: the entity masthead's grammar (an eyebrow of
 * facts, the title in the display face, a byline and the owner's description,
 * all receding as the page scrolls) with the play band beneath it. The art
 * field itself belongs to the room's `ArtProvider`; without artwork the field
 * is grayscale and the type keeps its plain colours.
 */
export function ShareMasthead() {
  const {
    sharelink,
    entries,
    entry,
    loaded,
    artwork,
    start,
    jumpToComment,
    thread,
  } = useShareRoom();
  const { togglePlay, retry } = usePlayerActions();
  const isPlaying = useIsPlaying();
  const loadError = useLoadError();
  const format = useFormat();

  const eyebrowArrival = useArrival("eyebrow");
  const titleArrival = useArrival("title");
  const bylineArrival = useArrival("byline");
  const headScroll = useMastheadScroll("head");

  const onArt = artwork !== null;
  const failed = loadError !== null && loadError.assetId === entry?.assetId;
  const showActiveTrack = entries.length > 1 && entry != null;
  const byline =
    entry?.version != null ? (
      <VersionBadge version={entry.version} />
    ) : entry?.createdAt ? (
      format.date(entry.createdAt)
    ) : null;

  return (
    <div className={cn(onArt && "on-art")}>
      <header
        className={cn(
          "masthead relative flex min-h-(--masthead-head) flex-col p-(--gutter) pb-7",
          "phone:pt-4"
        )}
      >
        <m.div style={headScroll} className={cn("mt-auto", COLUMN)}>
          <m.div {...eyebrowArrival} className={EYEBROW}>
            {shareFacts(sharelink)}
          </m.div>
          <m.h1 {...titleArrival} className={mastheadTitle(false)}>
            {shareTitle(sharelink)}
          </m.h1>
          {(showActiveTrack || byline) && (
            <m.div
              {...bylineArrival}
              className={cn(
                "flex flex-wrap items-center gap-x-3 gap-y-1 text-body text-ink-soft",
                onArt && "on-art-soft"
              )}
            >
              {showActiveTrack && (
                <span className={"font-medium text-ink"}>{entry.title}</span>
              )}
              {byline}
            </m.div>
          )}
          {sharelink.description && (
            <p
              className={cn(
                "mt-3 max-w-[60ch] text-body/[1.7] text-pretty whitespace-pre-wrap text-ink-soft",
                onArt && "on-art-soft"
              )}
            >
              {sharelink.description}
            </p>
          )}
        </m.div>
      </header>

      <section className={cn(COLUMN, "flex flex-col gap-3 px-(--gutter)")}>
        {entry ? (
          <>
            {/* The full transport only means something once this share is
                the loaded queue, and only a share with somewhere to skip to
                earns shuffle, repeat and the two skips around the play
                button. Everything else is the one control that starts it. On
                phones the waveform stacks full-width above the transport so
                the 5-button row never crushes it. */}
            <div
              data-slot={"share-transport"}
              className={
                "flex items-center gap-3 phone:flex-col phone:items-stretch phone:gap-2"
              }
            >
              <div
                className={
                  "flex shrink-0 items-center phone:order-2 phone:justify-center"
                }
              >
                {loaded && entries.length > 1 ? (
                  <Transport size={"full"} />
                ) : (
                  <IconButton
                    variant={"hero"}
                    aria-label={
                      loaded && isPlaying
                        ? `Pause ${entry.title}`
                        : `Play ${entry.title}`
                    }
                    onClick={loaded ? togglePlay : start}
                  >
                    <PlayGlyph playing={loaded && isPlaying} />
                  </IconButton>
                )}
              </div>
              <div
                className={
                  "flex min-w-0 flex-1 items-center gap-3 phone:order-1 phone:w-full"
                }
              >
                <div className={"min-w-0 flex-1"}>
                  {failed ? (
                    <div className={"flex flex-wrap items-center gap-3"}>
                      <p
                        role={"alert"}
                        className={cn(
                          "text-body text-ink-soft",
                          onArt && "on-art-soft"
                        )}
                      >
                        This audio can&apos;t be played right now.
                      </p>
                      <Button variant={"outline"} size={"sm"} onClick={retry}>
                        Try again
                      </Button>
                    </div>
                  ) : (
                    <TrackWaveform
                      assetId={entry.assetId}
                      playerTrack={entry.playable}
                      peaks={entry.peaks}
                      commentMarks={thread.commentMarks}
                      onMarkerClick={jumpToComment}
                      onPlay={start}
                      showClock={false}
                    />
                  )}
                </div>
                <DurationReadout
                  loaded={loaded}
                  durationMs={entry.durationMs}
                  onArt={onArt}
                />
              </div>
              <div className={"flex shrink-0 items-center phone:hidden"}>
                <SecondaryControls.Volume size={"card"} />
              </div>
            </div>

            {sharelink.isDownloadsEnabled && (
              <a
                href={`${entry.playable.asset.assetPath}&download`}
                className={cn(
                  "inline-flex w-fit items-center gap-1.5 text-micro text-ink-soft hover:text-ink",
                  onArt && "on-art-soft"
                )}
              >
                <IconDownload className={"size-3.5"} />
                Download {entry.title}
              </a>
            )}
          </>
        ) : (
          <p className={cn("text-body text-ink-soft", onArt && "on-art-soft")}>
            Nothing to play yet.
          </p>
        )}
      </section>
    </div>
  );
}
