"use client";

import { Slider } from "@workspace/ui/components/slider";
import {
  describedByOf,
  type ControlOf,
  type SettingControlProps,
} from "./types";

/**
 * A number along a range, its figure beside it. Every step the thumb passes
 * is a change; the row saves once the thumb comes to rest.
 */
export function SliderControl({
  definition,
  value,
  onChange,
  disabled,
  id,
}: SettingControlProps<number, ControlOf<"slider">>) {
  const { min, max, step, unit } = definition.control;

  return (
    <span className="flex w-60 items-center gap-3">
      <Slider
        id={id}
        value={[value]}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        aria-label={definition.label}
        aria-describedby={describedByOf(id)}
        onValueChange={([next]) => {
          if (next !== undefined) onChange(next);
        }}
      />
      <output
        htmlFor={id}
        className="w-14 shrink-0 text-right text-small text-ink tabular-nums"
      >
        {value}
        {unit && <span className="text-ink-soft"> {unit}</span>}
      </output>
    </span>
  );
}
