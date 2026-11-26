"use client";

import { useRouted } from "@/components/music-player/player-hooks";
import type { PlayerSide } from "@/lib/dsp/processor-protocol";
import { useLatestRef } from "@workspace/ui/hooks/use-latest-ref";
import { useEffect } from "react";

/** The newest frame per side: each source before any chain, and the Lab's output. */
export type Sides<T> = Record<PlayerSide, T | null>;

export type SideSubscribe<T> = (
  listener: (side: PlayerSide, frame: T) => void
) => () => void;

/**
 * Whether a side-frame subscription should be running: the caller wants
 * frames (`active`) and the engine is actually routed to produce any
 * (`routed`, gone from `analyser !== null` to its own snapshot field so a
 * reader never has to know what backs it).
 */
export function isLive(active: boolean, routed: boolean): boolean {
  return active && routed;
}

/**
 * Runs `draw` once per display frame with the newest frame from each source,
 * for readers that paint the DOM directly instead of re-rendering at 60 fps.
 * While `active` is false the loop keeps going with empty sides until `draw`
 * returns `false`, so a needle can settle rather than freeze; it then stops
 * and costs nothing until `active` turns true again. The loop also stops
 * while the tab is hidden, which is when rAF stops anyway.
 *
 * A caller is only ever live while the player is measuring, which it does only
 * for a surface that asked (see `useAnalysis`). With nothing measuring there
 * are no frames to wait for, so the reader settles and stops rather than
 * spinning a frame loop on levels that will never arrive.
 */
export function useSideFrames<T>(
  subscribe: SideSubscribe<T>,
  active: boolean,
  draw: (sides: Sides<T>, dtMs: number, active: boolean) => boolean | void
): void {
  const routed = useRouted();
  const live = isLive(active, routed);
  const drawRef = useLatestRef(draw);

  useEffect(() => {
    const sides: Sides<T> = { a: null, b: null, mix: null };
    const unsubscribe = live
      ? subscribe((side, frame) => {
          sides[side] = frame;
        })
      : () => {};

    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(100, now - last); // a backgrounded tab resumes without a jump
      last = now;
      const keepGoing = drawRef.current(sides, dt, live);
      if (live || keepGoing !== false) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      unsubscribe();
      cancelAnimationFrame(frame);
    };
  }, [live, subscribe, drawRef]);
}
