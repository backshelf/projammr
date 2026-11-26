"use client";

import { GrMeter } from "@/components/lab/GrMeter";
import { RackModule } from "@/components/lab/RackModule";
import { RackSliderRow } from "@/components/lab/RackSliderRow";
import {
  useLabSettings,
  usePlayerActions,
} from "@/components/music-player/player-hooks";
import { paramRange } from "@/lib/dsp/lab-settings";
import { Param } from "@workspace/dsp/params";

export const ROWS: {
  key: "thresholdDb" | "ratio" | "attackMs" | "releaseMs" | "makeupDb";
  label: string;
  param: (typeof Param)[keyof typeof Param];
  step: number;
  unit: string;
}[] = [
  {
    key: "thresholdDb",
    label: "Threshold",
    param: Param.CompThresholdDb,
    step: 0.5,
    unit: " dB",
  },
  {
    key: "ratio",
    label: "Ratio",
    param: Param.CompRatio,
    step: 0.1,
    unit: ":1",
  },
  {
    key: "attackMs",
    label: "Attack",
    param: Param.CompAttackMs,
    step: 0.1,
    unit: " ms",
  },
  {
    key: "releaseMs",
    label: "Release",
    param: Param.CompReleaseMs,
    step: 1,
    unit: " ms",
  },
  {
    key: "makeupDb",
    label: "Makeup",
    param: Param.CompMakeupDb,
    step: 0.5,
    unit: " dB",
  },
];

/** The Lab's compressor: its gain reduction on a ruler, then five parameters
 *  in one column, lined up with every other rack row. */
export function RackComp() {
  const { rack } = useLabSettings();
  const { setComp } = usePlayerActions();
  const { on, ...values } = rack.comp;

  return (
    <RackModule label="Comp" on={on} onChange={(next) => setComp({ on: next })}>
      <GrMeter active={on} />
      {ROWS.map((row) => {
        const { min, max } = paramRange(row.param);
        return (
          <RackSliderRow
            key={row.key}
            label={row.label}
            aria-label={row.label}
            value={[values[row.key]]}
            onValueChange={([value]) =>
              value !== undefined && setComp({ [row.key]: value })
            }
            min={min}
            max={max}
            step={row.step}
            display={`${values[row.key].toFixed(row.step < 1 ? 1 : 0)}${row.unit}`}
          />
        );
      })}
    </RackModule>
  );
}
