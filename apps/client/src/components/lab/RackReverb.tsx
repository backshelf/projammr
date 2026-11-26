"use client";

import { RackModule } from "@/components/lab/RackModule";
import { RackSliderRow } from "@/components/lab/RackSliderRow";
import {
  useLabSettings,
  usePlayerActions,
} from "@/components/music-player/player-hooks";
import { paramRange, type ReverbPreset } from "@/lib/dsp/lab-settings";
import { Param } from "@workspace/dsp/params";
import { SegmentedPill } from "@workspace/ui/components/segmented-pill";

export const PRESETS: { value: ReverbPreset; label: string }[] = [
  { value: "booth", label: "Booth" },
  { value: "room", label: "Room" },
  { value: "hall", label: "Hall" },
  { value: "club", label: "Club" },
];

/** The Lab's reverb: a room preset, and how much of it and how far behind. */
export function RackReverb() {
  const { rack } = useLabSettings();
  const { setReverb } = usePlayerActions();
  const { on, preset, wet, preDelayMs } = rack.reverb;
  const wetRange = paramRange(Param.ReverbWet);
  const preDelayRange = paramRange(Param.ReverbPreDelayMs);

  return (
    <RackModule
      label="Verb"
      on={on}
      onChange={(next) => setReverb({ on: next })}
      aside={
        <SegmentedPill
          aria-label="Reverb preset"
          options={PRESETS}
          value={preset}
          onValueChange={(value) => setReverb({ preset: value })}
        />
      }
    >
      <RackSliderRow
        label="Wet"
        aria-label="Reverb amount"
        value={[wet]}
        onValueChange={([value]) =>
          value !== undefined && setReverb({ wet: value })
        }
        min={wetRange.min}
        max={wetRange.max}
        step={0.01}
        display={`${Math.round(wet * 100)}%`}
      />
      <RackSliderRow
        label="Pre-delay"
        aria-label="Reverb pre-delay"
        value={[preDelayMs]}
        onValueChange={([value]) =>
          value !== undefined && setReverb({ preDelayMs: value })
        }
        min={preDelayRange.min}
        max={preDelayRange.max}
        step={1}
        display={`${Math.round(preDelayMs)} ms`}
      />
    </RackModule>
  );
}
