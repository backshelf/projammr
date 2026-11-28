"use client";

import { PlayGlyph } from "@/components/music-player/PlayGlyph";
import {
  useIsPlaying,
  usePlayerActions,
} from "@/components/music-player/player-hooks";
import { Scrub } from "@/components/music-player/Scrub";
import { DurationReadout } from "@/components/share/ShareMasthead";
import { useShareRoom } from "@/components/share/ShareRoom";
import { VersionBadge } from "@/components/track-audio/VersionBadge";
import {
  IconPlayerSkipBackFilled,
  IconPlayerSkipForwardFilled,
} from "@tabler/icons-react";
import { IconButton } from "@workspace/ui/components/icon-button";
import { useCanvasRoot } from "@workspace/ui/components/layout/scroll-root";
import { AnimatePresence, FADE, m } from "@workspace/ui/lib/motion";
import { COLUMN } from "@workspace/ui/lib/shell";
import { cn } from "@workspace/ui/lib/utils";
import { useEffect, useState } from "react";

/**
 * Sticky mini-transport pinned at the top of the share scroll container once
 * the masthead's play band scrolls out of view (e.g. while reading or writing
 * comments). Occupies zero layout height when hidden so it never shifts the
 * masthead or track list.
 */
export function ShareStickyTransport() {
  const { entries, index, entry, loaded, artwork, select, start } =
    useShareRoom();
  const { togglePlay, prev, next } = usePlayerActions();
  const isPlaying = useIsPlaying();
  const rootRef = useCanvasRoot();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!entry) return;
    const root = rootRef?.current ?? null;
    const target = (root ?? document).querySelector(
      '[data-slot="share-transport"]'
    );
    if (!target || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      ([item]) => {
        if (!item) return;
        const rootTop = item.rootBounds?.top ?? 0;
        setVisible(
          !item.isIntersecting && item.boundingClientRect.bottom <= rootTop + 1
        );
      },
      { root, threshold: 0 }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [entry, rootRef]);

  if (!entry) return null;

  const onArt = artwork !== null;

  return (
    <div className={"sticky top-0 z-30 h-0 overflow-visible"}>
      <AnimatePresence>
        {visible && (
          <m.div
            role={"region"}
            aria-label={"Playback controls"}
            variants={FADE}
            initial={"hidden"}
            animate={"shown"}
            exit={"leaving"}
            className={cn(
              "border-b border-glass-edge bg-glass backdrop-blur-[20px] backdrop-saturate-[1.2]",
              onArt && "on-art"
            )}
          >
            <div
              className={cn(
                COLUMN,
                "flex items-center gap-2.5 px-(--gutter) py-2"
              )}
            >
              <div className={"flex shrink-0 items-center gap-0.5"}>
                {entries.length > 1 && (
                  <IconButton
                    aria-label={"Previous"}
                    onClick={() =>
                      loaded
                        ? prev()
                        : select((index - 1 + entries.length) % entries.length)
                    }
                  >
                    <IconPlayerSkipBackFilled />
                  </IconButton>
                )}
                <IconButton
                  variant={"play"}
                  aria-label={
                    loaded && isPlaying
                      ? `Pause ${entry.title}`
                      : `Play ${entry.title}`
                  }
                  onClick={loaded ? togglePlay : start}
                >
                  <PlayGlyph playing={loaded && isPlaying} />
                </IconButton>
                {entries.length > 1 && (
                  <IconButton
                    aria-label={"Next"}
                    onClick={() =>
                      loaded ? next() : select((index + 1) % entries.length)
                    }
                  >
                    <IconPlayerSkipForwardFilled />
                  </IconButton>
                )}
              </div>

              <div className={"flex min-w-0 flex-1 items-center gap-2"}>
                <span className={"truncate text-small font-medium text-ink"}>
                  {entry.title}
                </span>
                {entry.version != null && (
                  <VersionBadge version={entry.version} active={loaded} />
                )}
              </div>

              {loaded && (
                <div className={"w-28 shrink-0 phone:hidden"}>
                  <Scrub size={"card"} showTimes={false} className={"mt-0"} />
                </div>
              )}

              <DurationReadout
                loaded={loaded}
                durationMs={entry.durationMs}
                onArt={onArt}
              />
            </div>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}
