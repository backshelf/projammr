"use client";

import { speedFigure } from "@/components/lab/lab-view-model";
import { SPEED_MAX, SPEED_MIN, SPEED_STEP } from "@/lib/dsp/lab-settings";
import { LabRangeControl, type LabRange } from "./lab-range-control";
import type { ControlOf, SettingControlProps } from "../types";

const BOUNDS = { min: SPEED_MIN, max: SPEED_MAX };

/** Where the Lab's speed slider stops either way: a range within its own
 *  bounds, or the rack default for the whole range. A custom control takes `value` as
 *  `unknown`; `lab.speedRange`'s schema is what pairs it with `LabRange`. */
export function LabSpeedRangeControl({
  value,
  onChange,
  disabled,
  id,
}: SettingControlProps<unknown, ControlOf<"custom">>) {
  return (
    <LabRangeControl
      value={value as LabRange}
      onChange={onChange}
      disabled={disabled}
      id={id}
      bounds={BOUNDS}
      step={SPEED_STEP}
      format={speedFigure}
      thumbLabel="speed"
    />
  );
}
