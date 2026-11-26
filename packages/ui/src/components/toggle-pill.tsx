"use client";

import { Toggle } from "@base-ui/react/toggle";
import { cn } from "@workspace/ui/lib/utils";
import * as React from "react";

/**
 * A single on/off pill: a hairline outline that fills with the artwork
 * accent when pressed, 44px on a coarse pointer. Wraps Base UI's `Toggle` for
 * its native `aria-pressed` and keyboard behaviour rather than hand-rolling
 * either. The compare pills, and the Lab's audition and device rows, share
 * this one shape.
 */
const TOGGLE_PILL = cn(
  "inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-rule-strong",
  "bg-transparent px-2.5 py-1 text-micro text-ink-soft motion-ink coarse:min-h-11",
  "hover:border-ink-faint hover:text-ink",
  "data-pressed:border-art data-pressed:bg-art data-pressed:text-paper",
  "disabled:pointer-events-none disabled:opacity-50",
  "[&_svg]:size-[0.8125rem]"
);

export type TogglePillProps<Value extends string = string> =
  React.ComponentProps<typeof Toggle<Value>>;

export function TogglePill<Value extends string = string>({
  className,
  ...props
}: TogglePillProps<Value>) {
  return (
    <Toggle
      data-slot={"toggle-pill"}
      className={cn(TOGGLE_PILL, className)}
      {...props}
    />
  );
}

export { TOGGLE_PILL };
