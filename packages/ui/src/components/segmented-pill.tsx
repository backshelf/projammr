"use client";

import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import { cn } from "@workspace/ui/lib/utils";
import * as React from "react";

export type SegmentedPillOption<Value extends string> = {
  value: Value;
  label: React.ReactNode;
  "aria-label"?: string;
};

/**
 * A row of pills where exactly one is on at a time — the A·B compare control
 * generalised. Wraps Base UI's `ToggleGroup` (single-select) so the roving
 * keyboard focus and arrow-key navigation come from an audited primitive
 * rather than a hand-rolled `radiogroup`; each option is a `Toggle`, so it
 * shares `TogglePill`'s `data-pressed` styling for the active one.
 *
 * Always controlled: clicking the pill already on reports an empty
 * selection, which is ignored here, so the group can never end up with
 * nothing chosen.
 */
export function SegmentedPill<Value extends string>({
  options,
  value,
  onValueChange,
  "aria-label": ariaLabel,
  className,
  disabled,
}: {
  options: SegmentedPillOption<Value>[];
  value: Value;
  onValueChange: (value: Value) => void;
  "aria-label": string;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <ToggleGroup
      aria-label={ariaLabel}
      disabled={disabled}
      value={[value]}
      onValueChange={(next) => {
        const [chosen] = next as Value[];
        if (chosen !== undefined) onValueChange(chosen);
      }}
      className={cn(
        "inline-flex items-center overflow-hidden rounded-full border border-rule-strong data-disabled:opacity-50",
        className
      )}
    >
      {options.map((option, index) => (
        <Toggle
          key={option.value}
          value={option.value}
          aria-label={option["aria-label"]}
          className={cn(
            "cursor-pointer border-none bg-transparent px-2.5 py-1 font-mono text-micro/none text-ink-soft motion-ink coarse:min-h-11",
            "hover:text-ink disabled:pointer-events-none",
            "data-pressed:bg-art data-pressed:text-paper",
            index > 0 && "border-l border-rule-strong"
          )}
        >
          {option.label}
        </Toggle>
      ))}
    </ToggleGroup>
  );
}
