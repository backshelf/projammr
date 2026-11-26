"use client";

import { emptyMeaning, NumericInput } from "./NumericInput";
import type { ControlOf, SettingControlProps } from "./types";

/**
 * A number, with its unit when the setting names one, and empty for `null`
 * where the setting takes it. Its bounds are the schema's to enforce.
 */
export function NumberControl({
  definition,
  value,
  onChange,
  disabled,
  id,
  invalid,
}: SettingControlProps<number | null, ControlOf<"number">>) {
  return (
    <NumericInput
      id={id}
      invalid={invalid}
      value={value}
      onChange={onChange}
      disabled={disabled}
      unit={definition.control.unit}
      empty={emptyMeaning(definition)}
    />
  );
}
