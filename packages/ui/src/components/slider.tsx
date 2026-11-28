"use client";

import { useHaptics } from "@workspace/ui/components/haptics";
import { cn } from "@workspace/ui/lib/utils";
import { Slider as SliderPrimitive } from "radix-ui";
import * as React from "react";

type SliderProps = Omit<
  React.ComponentProps<typeof SliderPrimitive.Root>,
  "aria-label"
> & {
  /** A single name for the whole slider, or one per thumb (two-thumb range). */
  "aria-label"?: string | readonly string[];
};

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  onValueChange,
  "aria-label": ariaLabel,
  ...props
}: SliderProps) {
  const haptic = useHaptics();
  const _values = React.useMemo(
    () =>
      Array.isArray(value)
        ? value
        : Array.isArray(defaultValue)
          ? defaultValue
          : [min, max],
    [value, defaultValue, min, max]
  );

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      className={cn(
        "relative flex w-full touch-none items-center select-none data-disabled:opacity-50 data-vertical:h-full data-vertical:min-h-40 data-vertical:w-auto data-vertical:flex-col",
        className
      )}
      // A thumb dragged across the track ticks once per step it settles on,
      // which is what makes a slider feel detented rather than continuous.
      onValueChange={(next) => {
        haptic();
        onValueChange?.(next);
      }}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className="relative grow overflow-hidden rounded-md bg-muted data-horizontal:h-1 data-horizontal:w-full data-vertical:h-full data-vertical:w-1"
      >
        <SliderPrimitive.Range
          data-slot="slider-range"
          className="absolute bg-primary select-none data-horizontal:h-full data-vertical:w-full"
        />
      </SliderPrimitive.Track>
      {Array.from({ length: _values.length }, (_, index) => (
        <SliderPrimitive.Thumb
          data-slot="slider-thumb"
          key={index}
          aria-label={Array.isArray(ariaLabel) ? ariaLabel[index] : ariaLabel}
          className="relative block size-3 shrink-0 rounded-md border border-ring bg-paper ring-ring/30 motion-ink select-none after:absolute after:-inset-2 hover:ring-2 focus-visible:ring-2 focus-visible:outline-hidden active:ring-2 disabled:pointer-events-none disabled:opacity-50 coarse:after:-inset-4"
        />
      ))}
    </SliderPrimitive.Root>
  );
}

export { Slider };
