"use client";

import {
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
} from "@tabler/icons-react";
import { Spinner } from "@workspace/ui/components/spinner";
import {
  AnimatePresence,
  FADE,
  LEAVE,
  m,
  SPRING,
} from "@workspace/ui/lib/motion";
import { cn } from "@workspace/ui/lib/utils";
import type { ComponentProps } from "react";

/**
 * One slot holding whichever mark names the control's state now. The outgoing
 * mark leaves while the incoming one presses in from 80 %, so the change reads
 * as one control changing state rather than one icon replaced by another. Both
 * marks share a grid cell, so the slot never resizes and nothing beside it
 * moves.
 */
export function GlyphSwap({
  slot,
  className,
  children,
  ...props
}: ComponentProps<"span"> & { slot: string }) {
  return (
    <span
      className={cn(
        "relative inline-grid place-items-center [&>*]:[grid-area:1/1]",
        className
      )}
      {...props}
    >
      <AnimatePresence initial={false}>
        <m.span
          key={slot}
          className={"inline-grid place-items-center"}
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{
            opacity: 1,
            scale: 1,
            transition: { opacity: FADE.quick, scale: SPRING.press },
          }}
          exit={{ opacity: 0, scale: 0.8, transition: LEAVE.quick }}
        >
          {children}
        </m.span>
      </AnimatePresence>
    </span>
  );
}

/**
 * The play/pause mark, wherever playback is offered. `loading` shows the
 * spinner in the same slot, because resolving what to play is the same control
 * still answering. The accessible name stays on the button around it.
 */
export function PlayGlyph({
  playing,
  loading = false,
  className,
}: {
  playing: boolean;
  /** Resolving what to play — the press landed, the audio has not yet. */
  loading?: boolean;
  className?: string;
}) {
  const state = loading ? "loading" : playing ? "pause" : "play";

  return (
    <GlyphSwap slot={state} className={className} aria-hidden>
      {state === "loading" ? (
        <Spinner />
      ) : state === "pause" ? (
        <IconPlayerPauseFilled />
      ) : (
        <IconPlayerPlayFilled />
      )}
    </GlyphSwap>
  );
}
