"use client";

import {
  useDuration,
  useMusicPlayerStore,
  usePlayerActions,
  useProgressFrames,
  writeAttribute,
  writeText,
} from "@/components/music-player/player-hooks";
import {
  clampPosition,
  keyboardSeek,
  progressReadout,
} from "@/components/music-player/scrub-math";
import type { PlayerSize } from "@/components/music-player/types";
import { seekStep } from "@/lib/policies/playback";
import { usePlaybackPolicy } from "@/lib/policies/provider";
import { useFormat } from "@workspace/ui/components/format-provider";
import { cn } from "@workspace/ui/lib/utils";
import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

/** The mini-player wears the position as a hairline it cannot be seeked by. */
export type ScrubSize = PlayerSize | "hairline";

type ScrubGeometry = {
  root: string;
  /** The element that takes the pointer; wider than the track where a thumb
   *  needs somewhere to land. */
  hit: string;
  track: string;
  /** Null where the surface has no room for the elapsed / remaining pair. */
  times: string | null;
  thumb: boolean;
};

const FOCUS_RING =
  "focus-visible:ring-2 focus-visible:ring-art/40 focus-visible:outline-hidden";

/** Where a pointer can hover, the times answer it and are otherwise out of the
 *  way; a coarse pointer never hovers, so there they stay put. */
const HOVER_TIMES = cn(
  "block py-1 fine:opacity-0",
  "fine:group-focus-within/player:opacity-100 fine:group-hover/player:opacity-100"
);

/**
 * Anchored in the sidebar the times hold their space and only fade, because
 * the card is fixed to the bottom of that column: growing the row would push
 * the transport and the account row above it. A detached card has no such
 * neighbours, so it lets the times take their space only while shown.
 */
const DETACHED_TIMES = cn(
  HOVER_TIMES,
  "fine:grid fine:grid-rows-[0fr] fine:motion-move",
  "fine:group-focus-within/player:grid-rows-[1fr] fine:group-hover/player:grid-rows-[1fr]"
);

const GEOMETRY: Record<ScrubSize, ScrubGeometry> = {
  hairline: {
    root: "block",
    hit: "block w-full",
    track: "h-0.5",
    times: null,
    thumb: false,
  },
  card: {
    root: "relative mt-1",
    hit: cn(
      "relative flex h-5 w-full cursor-pointer items-center rounded-full",
      FOCUS_RING
    ),
    track: "h-1",
    times: cn(HOVER_TIMES, "fine:motion-reveal"),
    thumb: true,
  },
  full: {
    root: "relative",
    hit: cn(
      "relative flex h-11 w-full cursor-pointer items-center rounded-full",
      FOCUS_RING
    ),
    track: "h-1",
    times: "block pt-1",
    thumb: true,
  },
};

const TRACK = cn(
  "block w-full overflow-hidden rounded-full",
  "bg-[color-mix(in_oklab,var(--ink)_22%,transparent)]"
);

/**
 * The played part. Scaled rather than sized so the per-frame position update
 * stays on the compositor instead of laying the card out again.
 *
 * The frames that carry a jump rather than a tick of playback are marked
 * `data-seeking` on the slider, and only then does the scale transition: sixty
 * eased frames a second would smear the playhead, while an unannounced cut
 * across the bar reads as a glitch.
 */
const FILL = cn(
  "block h-full w-full origin-left scale-x-(--v) rounded-full bg-art motion-ink",
  "group-data-seeking/scrub:transition-[scale]",
  "group-data-seeking/scrub:duration-(--dur-quick) group-data-seeking/scrub:ease-arrive"
);

const TIME = "text-micro text-ink-soft tabular-nums";

/** How long the fill glides over a jump; matches `--dur-quick`. Held until the
 *  glide is over rather than cleared on the next frame, because dropping the
 *  transition property mid-flight cancels it and the fill snaps anyway. */
const GLIDE_MS = 140;

/**
 * A jump the fill should travel rather than cut across: a tap on the bar or a
 * keyboard seek. A drag cancels it, because there the fill is following a
 * finger and any easing reads as lag.
 */
type SeekGlide = { start: () => void; cancel: () => void };

/**
 * A drag has one subtlety: the rAF progress channel keeps emitting while the
 * finger is down and would snap the fill back out from under it. So the
 * scrubber holds its own position for the length of the drag and seeks once
 * on release — a seek per pointermove is dozens of `currentTime` writes a
 * mobile decoder has to answer.
 */
function useScrubDrag(
  duration: number,
  getProgress: () => number,
  seek: (seconds: number) => void,
  glide: SeekGlide
) {
  const [dragPos, setDragPos] = useState<number | null>(null);
  const playback = usePlaybackPolicy();

  const positionFor = (event: PointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return clampPosition((event.clientX - rect.left) / rect.width, duration);
  };

  const release = (event: PointerEvent<HTMLElement>) => {
    if (dragPos === null) return;
    seek(positionFor(event));
    setDragPos(null);
  };

  return {
    dragPos,
    handlers: {
      onPointerDown: (event: PointerEvent<HTMLElement>) => {
        if (!duration) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        glide.start();
        setDragPos(positionFor(event));
      },
      onPointerMove: (event: PointerEvent<HTMLElement>) => {
        if (dragPos === null) return;
        glide.cancel();
        setDragPos(positionFor(event));
      },
      onPointerUp: release,
      onPointerCancel: release,
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
        const target = keyboardSeek(
          event.key,
          dragPos ?? getProgress(),
          duration,
          seekStep(playback, event.shiftKey)
        );
        if (target === null) return;
        event.preventDefault();
        glide.start();
        seek(target);
      },
    },
  };
}

/**
 * The position of the playing track, and the way to change it.
 *
 * The playhead is painted straight onto the DOM by {@link useProgressFrames};
 * this component re-renders only for the duration, a drag, or a resize of the
 * surface around it.
 */
export function Scrub({
  size,
  detached = false,
  showTimes = true,
  className,
}: {
  size: ScrubSize;
  /** Card only: the card floats over the page rather than sitting in the
   *  sidebar column, and can grow downward to show the times. */
  detached?: boolean;
  /** Whether to render the elapsed / remaining row beneath the bar. */
  showTimes?: boolean;
  className?: string;
}) {
  const duration = useDuration();
  const { getProgress } = useMusicPlayerStore();
  const { seek } = usePlayerActions();

  const rootRef = useRef<HTMLDivElement>(null);
  const sliderRef = useRef<HTMLDivElement>(null);
  const leadRef = useRef<HTMLSpanElement>(null);
  const trailRef = useRef<HTMLSpanElement>(null);
  const { playerTime } = useFormat();

  // The deadline, not a boolean: the frames the glide covers are the frames
  // the fill may ease over, and the draw below is the only place that reads it.
  const glideUntilRef = useRef(0);
  const glide: SeekGlide = {
    start: () => {
      glideUntilRef.current = performance.now() + GLIDE_MS;
    },
    cancel: () => {
      glideUntilRef.current = 0;
    },
  };

  const { dragPos, handlers } = useScrubDrag(
    duration,
    getProgress,
    seek,
    glide
  );

  useProgressFrames((seconds) => {
    const readout = progressReadout(dragPos ?? seconds, duration, playerTime);
    rootRef.current?.style.setProperty("--v", String(readout.fraction));
    sliderRef.current?.toggleAttribute(
      "data-seeking",
      performance.now() < glideUntilRef.current
    );
    writeAttribute(
      sliderRef.current,
      "aria-valuenow",
      String(Math.round(readout.position))
    );
    writeAttribute(sliderRef.current, "aria-valuetext", readout.valueText);
    writeText(leadRef.current, readout.lead);
    writeText(trailRef.current, readout.trail);
  });

  const geometry = GEOMETRY[size];

  const bar = (
    <span className={cn(TRACK, geometry.track)} aria-hidden>
      <i className={FILL} />
    </span>
  );

  if (size === "hairline")
    return (
      <div ref={rootRef} className={geometry.root} aria-hidden>
        <span className={geometry.hit}>{bar}</span>
      </div>
    );

  // aria-valuenow and aria-valuetext are written by the draw above.
  return (
    <div ref={rootRef} className={cn(geometry.root, className)}>
      <div
        ref={sliderRef}
        className={cn("group/scrub touch-none", geometry.hit)}
        role={"slider"}
        tabIndex={0}
        aria-label={"Seek"}
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        {...handlers}
      >
        {bar}
        {geometry.thumb && (
          <span
            className={
              "pointer-events-none absolute inset-x-0 top-1/2 translate-x-[calc(var(--v)*100%)] -translate-y-1/2"
            }
            aria-hidden
          >
            <span
              className={cn(
                "-ml-1.5 block size-3 rounded-full bg-art shadow-float",
                "opacity-0 motion-reveal",
                "group-hover/scrub:opacity-100 group-focus-visible/scrub:opacity-100",
                dragPos !== null && "opacity-100"
              )}
            />
          </span>
        )}
      </div>
      {showTimes && geometry.times && (
        <span className={detached ? DETACHED_TIMES : geometry.times}>
          <span className={"flex min-h-0 justify-between overflow-hidden"}>
            <span ref={leadRef} className={TIME} />
            <span ref={trailRef} className={TIME} />
          </span>
        </span>
      )}
    </div>
  );
}
