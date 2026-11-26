"use client";

import { useMusicPlayerStore } from "@/components/music-player/player-hooks";
import {
  type Sides,
  useSideFrames,
} from "@/components/music-player/use-side-frames";

export type LiveSpectrumSides = Sides<Float32Array>;

/** `useSideFrames` over the store's spectrum frames. See that hook for the loop's behaviour. */
export function useSpectrumFrames(
  active: boolean,
  draw: (
    sides: LiveSpectrumSides,
    dtMs: number,
    active: boolean
  ) => boolean | void
) {
  useSideFrames(useMusicPlayerStore().subscribeSpectrum, active, draw);
}
