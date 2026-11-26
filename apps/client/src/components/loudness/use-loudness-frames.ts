"use client";

import { useMusicPlayerStore } from "@/components/music-player/player-hooks";
import {
  type Sides,
  useSideFrames,
} from "@/components/music-player/use-side-frames";
import type { LoudnessHop } from "@workspace/dsp/analysis";

export type LiveSides = Sides<LoudnessHop>;

/** `useSideFrames` over the store's loudness frames. See that hook for the loop's behaviour. */
export function useLoudnessFrames(
  active: boolean,
  draw: (sides: LiveSides, dtMs: number, active: boolean) => boolean | void
) {
  useSideFrames(useMusicPlayerStore().subscribeLoudness, active, draw);
}
