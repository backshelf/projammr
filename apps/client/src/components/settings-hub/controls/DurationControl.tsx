"use client";

import { DURATION_UNITS } from "../format";
import { emptyMeaning, NumericInput } from "./NumericInput";
import type { ControlOf, SettingControlProps } from "./types";

/**
 * A length of time, counted in the unit the setting declares, whose plural
 * reads beside the field, and empty for `null` where the setting takes it.
 */
export function DurationControl({
  definition,
  value,
  onChange,
  disabled,
  id,
  invalid,
}: SettingControlProps<number | null, ControlOf<"duration">>) {
  return (
    <NumericInput
      id={id}
      invalid={invalid}
      value={value}
      onChange={onChange}
      disabled={disabled}
      unit={`${DURATION_UNITS[definition.control.unit]}s`}
      empty={emptyMeaning(definition)}
    />
  );
}
