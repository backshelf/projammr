"use client";

import {
  useProgressFrames,
  writeAttribute,
} from "@/components/music-player/player-hooks";
import { keyboardSeek } from "@/components/music-player/scrub-math";
import {
  useTimelineScrub,
  type TimelineHover,
} from "@/components/track-audio/use-timeline-scrub";
import { seekStep } from "@/lib/policies/playback";
import { usePlaybackPolicy } from "@/lib/policies/provider";
import { formatSeconds } from "@workspace/ui/lib/format";
import { LABEL } from "@workspace/ui/lib/shell";
import { cn } from "@workspace/ui/lib/utils";
import {
  createContext,
  use,
  useEffect,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from "react";

export type PlayheadTarget = {
  playhead: HTMLElement;
  slider: HTMLElement | null;
};

type PlayheadRegistry = (target: PlayheadTarget) => () => void;

export const PlayheadRegistryContext = createContext<PlayheadRegistry | null>(
  null
);

function hoverPillAlignClass(ratio: number): string {
  if (ratio < 0.15) return "translate-x-0";
  if (ratio > 0.85) return "-translate-x-full";
  return "-translate-x-1/2";
}

function StandalonePlayhead({
  playheadRef,
  sliderRef,
  durationSeconds,
  live,
}: {
  playheadRef: React.RefObject<HTMLElement | null>;
  sliderRef: React.RefObject<HTMLDivElement | null>;
  durationSeconds: number;
  live: boolean;
}) {
  useProgressFrames((seconds) => {
    const playhead = playheadRef.current;
    if (playhead) {
      const fraction =
        live && durationSeconds > 0
          ? Math.max(0, Math.min(1, seconds / durationSeconds))
          : 0;
      const transform = `translateX(${(fraction * 100).toFixed(4)}%)`;
      if (playhead.style.transform !== transform) {
        playhead.style.transform = transform;
      }
      const opacity = live ? "1" : "0";
      if (playhead.style.opacity !== opacity) {
        playhead.style.opacity = opacity;
      }
    }
    writeAttribute(
      sliderRef.current,
      "aria-valuenow",
      String(Math.round(seconds))
    );
  });
  return null;
}

/**
 * One captioned strip row under the waveform: a 16px eyebrow row above the
 * strip canvas (`label` on the left, optional metadata/controls on the right),
 * then a `px-2`-aligned interactive seek surface matching `.wave`'s padding.
 */
export function StripRow({
  label,
  durationSeconds,
  getSeconds,
  onSeek,
  eyebrow,
  footer,
  renderHoverReadout,
  renderOverlay,
  live = false,
  className,
  children,
}: {
  label: string;
  durationSeconds: number;
  /** The position a keyboard step starts from; read at the moment of the
   *  key press rather than a reactive prop, so a strip never re-renders on
   *  every playback frame. */
  getSeconds: () => number;
  onSeek: (seconds: number) => void;
  eyebrow?: ReactNode;
  footer?: ReactNode;
  renderHoverReadout?: (hover: TimelineHover) => ReactNode;
  renderOverlay?: (hover: TimelineHover | null) => ReactNode;
  /** Used when rendered standalone outside `MeasureStack` (e.g. `CompareChangeStrip`). */
  live?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const playback = usePlaybackPolicy();
  const registerPlayhead = use(PlayheadRegistryContext);
  const sliderRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLElement>(null);

  const { hover, surfaceProps } = useTimelineScrub({
    durationSeconds,
    onSeek,
  });

  useEffect(() => {
    if (!registerPlayhead || !playheadRef.current) return;
    return registerPlayhead({
      playhead: playheadRef.current,
      slider: sliderRef.current,
    });
  }, [registerPlayhead]);

  const seekFromKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = keyboardSeek(
      event.key,
      getSeconds(),
      durationSeconds,
      seekStep(playback, event.shiftKey)
    );
    if (target === null) return;
    event.preventDefault();
    onSeek(target);
  };

  return (
    <div className="border-t border-rule py-1.5 first:border-t-0">
      <div className="mb-1 flex h-4 items-center justify-between gap-2 px-2">
        <span className={cn(LABEL, "min-w-0 truncate text-ink-soft")}>
          {label}
        </span>
        {eyebrow}
      </div>
      <div className="px-2">
        <div
          ref={sliderRef}
          role="slider"
          tabIndex={0}
          aria-label={`Seek to a position in ${label.toLowerCase()}`}
          aria-valuemin={0}
          aria-valuemax={Math.round(durationSeconds)}
          aria-valuenow={Math.round(getSeconds())}
          className={cn(
            "relative h-6 min-w-0 cursor-pointer touch-pan-y select-none",
            className
          )}
          {...surfaceProps}
          onKeyDown={seekFromKey}
        >
          {children}
          {renderOverlay?.(hover)}
          {hover && (
            <>
              <span
                aria-hidden
                className="pointer-events-none absolute inset-y-0 hidden w-px bg-ink-faint/60 fine:block"
                style={{ left: `${hover.ratio * 100}%` }}
              />
              <span
                aria-hidden
                className={cn(
                  "pointer-events-none absolute top-1 z-10 hidden rounded-sm border border-rule bg-paper/95 px-1.5 py-0.5 text-micro/none whitespace-nowrap text-ink tabular-nums shadow-menu fine:block",
                  hoverPillAlignClass(hover.ratio)
                )}
                style={{ left: `${hover.ratio * 100}%` }}
              >
                {renderHoverReadout
                  ? renderHoverReadout(hover)
                  : formatSeconds(hover.seconds)}
              </span>
            </>
          )}
          <i
            ref={playheadRef}
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-0 motion-reveal"
            style={{ transform: "translateX(0%)" }}
          >
            <span className="absolute inset-y-0 left-0 w-px bg-ink" />
          </i>
          {!registerPlayhead && (
            <StandalonePlayhead
              playheadRef={playheadRef}
              sliderRef={sliderRef}
              durationSeconds={durationSeconds}
              live={live}
            />
          )}
        </div>
      </div>
      {footer && <div className="mt-1 px-2">{footer}</div>}
    </div>
  );
}
