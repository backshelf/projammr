"use client";

import {
  clampPosition,
  keyboardSeek,
} from "@/components/music-player/scrub-math";
import { seekStep } from "@/lib/policies/playback";
import { usePlaybackPolicy } from "@/lib/policies/provider";
import { LABEL } from "@workspace/ui/lib/shell";
import { cn } from "@workspace/ui/lib/utils";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";

const PLAYHEAD_TRACK = {
  transform: "translateX(calc(var(--playhead, 0) * 100%))",
};

/**
 * One captioned row under the waveform: a label at the left, a 24px seek
 * surface filling the rest. Every strip renders through this, so the
 * click-to-seek gesture and its keyboard equivalent exist in one place
 * rather than once per strip.
 *
 * `grid-cols-subgrid` inherits its two column tracks from `MeasureStack`'s
 * own subgrid, which in turn inherits them from the grid `TrackAudioSection`
 * wraps the play affordance and the waveform in — the same two tracks up
 * the whole chain, so a strip's seek surface starts and ends at exactly the
 * waveform's own bars regardless of the play affordance's width.
 */
export function StripRow({
  label,
  durationSeconds,
  getSeconds,
  onSeek,
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
  className?: string;
  children: ReactNode;
}) {
  const playback = usePlaybackPolicy();

  const seekFromClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!durationSeconds) return;
    const rect = event.currentTarget.getBoundingClientRect();
    onSeek(
      clampPosition((event.clientX - rect.left) / rect.width, durationSeconds)
    );
  };

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
    <div className="col-span-2 grid grid-cols-subgrid items-stretch border-t border-rule py-1 first:border-t-0">
      <span
        className={cn(
          LABEL,
          "max-w-28 min-w-0 self-center truncate text-ink-soft"
        )}
      >
        {label}
      </span>
      <div
        role="slider"
        tabIndex={0}
        aria-label={`Seek to a position in ${label.toLowerCase()}`}
        aria-valuemin={0}
        aria-valuemax={Math.round(durationSeconds)}
        aria-valuenow={Math.round(getSeconds())}
        className={cn("relative h-6 min-w-0 cursor-pointer", className)}
        onClick={seekFromClick}
        onKeyDown={seekFromKey}
      >
        {children}
        {/* The stack's playhead, on a full-width track translated by the
            fraction `MeasureStack` writes, so it never reflows. */}
        <i
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-0 motion-reveal group-data-live/strips:opacity-100"
          style={PLAYHEAD_TRACK}
        >
          <span className="absolute inset-y-0 left-0 w-px bg-ink" />
        </i>
      </div>
    </div>
  );
}
