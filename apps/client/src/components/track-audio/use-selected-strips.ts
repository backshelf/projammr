"use client";

import {
  toggleStrip,
  type StripId,
} from "@/components/track-audio/strip-legend";
import { useVisualsPolicy } from "@/lib/policies/provider";
import { useUserSettingsWrite } from "@/lib/settings/provider";
import { toastRefusedWrite } from "@/lib/settings/refusal";
import { useCallback } from "react";

/**
 * The strips shown under the track page's waveform, read by
 * `TrackAudioSection` and handed down to `MeasureStack`'s legend: the visuals
 * policy's `strips`, whose unknown ids the policy has already dropped. A pill
 * toggled on the legend writes the viewer's strips setting, which every track
 * page follows at once.
 */
export function useSelectedStrips(): [
  readonly StripId[],
  (id: StripId) => void,
] {
  const { strips } = useVisualsPolicy();
  const write = useUserSettingsWrite();

  const toggle = useCallback(
    (id: StripId) => {
      write({ "visuals.strips": toggleStrip(strips, id) }).catch(
        toastRefusedWrite
      );
    },
    [strips, write]
  );

  return [strips, toggle];
}
