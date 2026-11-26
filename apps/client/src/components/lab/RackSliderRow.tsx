"use client";

import {
  RACK_LABEL_WIDTH,
  RACK_VALUE_WIDTH,
} from "@/components/lab/rack-columns";
import { Slider } from "@workspace/ui/components/slider";
import { LABEL } from "@workspace/ui/lib/shell";
import { cn } from "@workspace/ui/lib/utils";
import type { ComponentProps } from "react";

/**
 * One rack parameter: a label, a slider, and its live value — the row shape
 * RackComp and RackReverb both need. Built once here instead of once per
 * module, so every rack module's rows share the same pair of column widths
 * rather than each picking its own.
 */
export function RackSliderRow({
  label,
  display,
  ...sliderProps
}: {
  label: string;
  /** The figure beside the slider, already formatted ("−3.5 dB", "42%"). */
  display: string;
} & Omit<ComponentProps<typeof Slider>, "className">) {
  return (
    <div className="flex items-center gap-3">
      <span className={cn(LABEL, RACK_LABEL_WIDTH, "shrink-0 text-ink-soft")}>
        {label}
      </span>
      <Slider {...sliderProps} />
      <span
        className={cn(
          RACK_VALUE_WIDTH,
          "shrink-0 text-right text-small text-ink tabular-nums"
        )}
      >
        {display.replace(/^-/, "−")}
      </span>
    </div>
  );
}
