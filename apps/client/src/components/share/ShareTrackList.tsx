"use client";

import { GlyphSwap } from "@/components/music-player/PlayGlyph";
import { useIsPlaying } from "@/components/music-player/player-hooks";
import { useShareRoom } from "@/components/share/ShareRoom";
import { VersionBadge } from "@/components/track-audio/VersionBadge";
import { IconPlayerPlayFilled, IconVolume } from "@tabler/icons-react";
import { useFormat } from "@workspace/ui/components/format-provider";
import {
  Row,
  RowMain,
  RowMeta,
  RowNum,
  RowTitle,
  Rows,
} from "@workspace/ui/components/layout/rows";
import { SectionHead } from "@workspace/ui/components/layout/section-head";
import { LayoutGroup, m, SPRING } from "@workspace/ui/lib/motion";
import { cn } from "@workspace/ui/lib/utils";

/**
 * The band behind the row the share is holding. One element for the whole
 * list, so it travels down to the next track rather than blinking out of one
 * row and into another. Ink rather than art, for the same reason the mark is:
 * a cover with no chroma to lend must still show which row is playing.
 */
function CurrentRowMark() {
  return (
    <m.span
      layoutId={"share-current"}
      transition={SPRING.control}
      className={
        "absolute inset-0 -z-1 bg-[color-mix(in_oklab,var(--ink)_7%,transparent)]"
      }
      aria-hidden
    />
  );
}

/**
 * What else is in the share. The playing row says so with a mark rather than a
 * colour swap, so the list reads the same whether or not the cover behind it
 * has any chroma to lend, and the band under it travels to the next row as the
 * queue advances rather than reappearing there. A share of one track has
 * nothing to choose between, so it draws nothing.
 */
export function ShareTrackList() {
  const { entries, index, loaded, artwork, select } = useShareRoom();
  const isPlaying = useIsPlaying();
  const format = useFormat();

  if (entries.length < 2) return null;

  return (
    <section className={cn(artwork && "on-art")}>
      <SectionHead count={entries.length}>Tracks</SectionHead>
      <LayoutGroup>
        <Rows>
          {entries.map((entry, position) => {
            const isCurrent = position === index;
            const playing = isCurrent && loaded && isPlaying;
            return (
              <Row
                as={"button"}
                key={entry.trackAudioId}
                type={"button"}
                onClick={() => select(position)}
                aria-current={isCurrent || undefined}
                className={"relative isolate w-full cursor-pointer text-left"}
              >
                {isCurrent && <CurrentRowMark />}
                <GlyphSwap
                  slot={playing ? "playing" : "idle"}
                  className={"w-6 shrink-0"}
                >
                  {playing ? (
                    <IconVolume className={"size-3.5 shrink-0 text-art"} />
                  ) : (
                    <>
                      <RowNum className={"fine:group-hover/row:hidden"}>
                        {position + 1}
                      </RowNum>
                      <IconPlayerPlayFilled
                        className={
                          "hidden size-3 shrink-0 text-ink-soft fine:group-hover/row:block"
                        }
                      />
                    </>
                  )}
                </GlyphSwap>
                <RowMain>
                  <RowTitle
                    className={cn(
                      isCurrent ? "text-ink" : "text-ink-soft",
                      artwork && !isCurrent && "on-art-soft"
                    )}
                  >
                    {entry.title}
                  </RowTitle>
                </RowMain>
                {entry.version != null && (
                  <VersionBadge version={entry.version} />
                )}
                {entry.durationMs != null && (
                  <RowMeta className={cn("shrink-0", artwork && "on-art-soft")}>
                    {format.duration(entry.durationMs)}
                  </RowMeta>
                )}
              </Row>
            );
          })}
        </Rows>
      </LayoutGroup>
    </section>
  );
}
