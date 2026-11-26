"use client";

import { Button } from "@workspace/ui/components/button";
import {
  isRackDefault,
  RACK_DEFAULT,
  type RackDefault,
} from "@workspace/settings/groups/lab";
import { Slider } from "@workspace/ui/components/slider";
import { describedByOf, labelIdOf } from "../types";

export type LabRange = { min: number; max: number } | RackDefault;

/**
 * `lab-speed-range` and `lab-pitch-range`'s shared shape: a two-thumb slider
 * within the Lab's own bounds, the rack default shown as the full range, and
 * a Reset back to the rack default once the range narrows from it. Its callers already read
 * `value` off the custom control's `unknown`, so this takes the narrowed
 * `LabRange` directly rather than a whole `SettingControlProps`.
 */
export function LabRangeControl({
  value,
  onChange,
  disabled,
  id,
  bounds,
  step,
  format,
  thumbLabel,
}: {
  value: LabRange;
  onChange: (value: LabRange) => void;
  disabled: boolean;
  id: string;
  bounds: { min: number; max: number };
  step: number;
  /** A bound as a person reads it, e.g. "0.50×" or "−12 st". */
  format: (value: number) => string;
  /** What the thumbs are ranging over, e.g. "speed" or "pitch". */
  thumbLabel: string;
}) {
  const current = isRackDefault(value) ? bounds : value;

  return (
    <div
      id={id}
      role="group"
      aria-labelledby={labelIdOf(id)}
      aria-describedby={describedByOf(id)}
      className="flex w-72 flex-col gap-1.5"
    >
      <div className="flex items-center gap-3">
        <Slider
          aria-label={[`Minimum ${thumbLabel}`, `Maximum ${thumbLabel}`]}
          value={[current.min, current.max]}
          min={bounds.min}
          max={bounds.max}
          step={step}
          disabled={disabled}
          onValueChange={([nextMin, nextMax]) => {
            if (nextMin === undefined || nextMax === undefined) return;
            onChange({ min: nextMin, max: nextMax });
          }}
        />
        {!isRackDefault(value) && (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={disabled}
            onClick={() => onChange(RACK_DEFAULT)}
          >
            Reset
          </Button>
        )}
      </div>
      <p className="text-micro text-ink-soft tabular-nums">
        {format(current.min)} – {format(current.max)}
      </p>
    </div>
  );
}
