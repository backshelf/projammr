"use client";

import { useMusicPlayerStore } from "@/components/music-player/player-hooks";
import { useLatestRef } from "@workspace/ui/hooks/use-latest-ref";
import { useEffect } from "react";

/**
 * Runs `draw` once per display frame with the compressor's latest gain
 * reduction, in dB (0 at rest, positive while it works), for a reader that
 * paints the DOM directly instead of re-rendering at 60 fps — the rack's
 * {@link GrMeter}. Only the Lab's `"player"`-role processor ever posts a `gr`
 * frame, so this simply has nothing to draw while `active` is false; the loop
 * still keeps running until `draw` reports the needle has settled, the same
 * shape as {@link useSideFrames}.
 */
export function useGrFrames(
  active: boolean,
  draw: (db: number, dtMs: number, active: boolean) => boolean | void
): void {
  const subscribe = useMusicPlayerStore().subscribeGr;
  const drawRef = useLatestRef(draw);

  useEffect(() => {
    let latest = 0;
    const unsubscribe = active
      ? subscribe((db) => {
          latest = db;
        })
      : () => {};

    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(100, now - last);
      last = now;
      const keepGoing = drawRef.current(active ? latest : 0, dt, active);
      if (active || keepGoing !== false) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      unsubscribe();
      cancelAnimationFrame(frame);
    };
  }, [active, subscribe, drawRef]);
}
