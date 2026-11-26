"use client";

import { SegmentedPill } from "@workspace/ui/components/segmented-pill";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import {
  describedByOf,
  labelIdOf,
  type ControlOf,
  type SettingControlProps,
} from "./types";

/** Up to this many options sit side by side as pills; more open a menu. */
const PILL_OPTIONS = 3;

/** One of a list: side-by-side pills for a short list, a menu for a longer one. */
export function SelectControl({
  definition,
  value,
  onChange,
  disabled,
  id,
  invalid,
}: SettingControlProps<string, ControlOf<"select">>) {
  const { options } = definition.control;

  if (options.length <= PILL_OPTIONS) {
    return (
      // The pills take no `disabled` of their own; a disabled fieldset
      // disables every button inside it.
      <fieldset
        id={id}
        disabled={disabled}
        aria-labelledby={labelIdOf(id)}
        aria-describedby={describedByOf(id)}
        className="min-w-0 disabled:opacity-50"
      >
        <SegmentedPill
          aria-label={definition.label}
          options={[...options]}
          value={value}
          onValueChange={onChange}
        />
      </fieldset>
    );
  }

  return (
    <Select
      value={value}
      onValueChange={onChange}
      disabled={disabled}
      items={options}
    >
      <SelectTrigger
        id={id}
        className="w-48"
        aria-invalid={invalid || undefined}
        aria-describedby={describedByOf(id)}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
