"use client";

import { pitchFigure } from "@/components/lab/lab-view-model";
import { PITCH_MAX, PITCH_MIN } from "@/lib/dsp/lab-settings";
import { LabRangeControl, type LabRange } from "./lab-range-control";
import type { ControlOf, SettingControlProps } from "../types";

const BOUNDS = { min: PITCH_MIN, max: PITCH_MAX };
// No PITCH_STEP is exported: SpeedPitch.tsx's own pitch slider steps by 1.
const PITCH_STEP = 1;

/** Where the Lab's pitch slider stops either way, in semitones: a range
 *  within its own bounds, or the rack default for the whole range. A custom control
 *  takes `value` as `unknown`; `lab.pitchRange`'s schema is what pairs it
 *  with `LabRange`. */
export function LabPitchRangeControl({
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
      step={PITCH_STEP}
      format={pitchFigure}
      thumbLabel="pitch"
    />
  );
}
