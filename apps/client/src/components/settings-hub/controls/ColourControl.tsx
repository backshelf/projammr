"use client";

import { ColourInput } from "@/components/settings/ColourInput";
import {
  describedByOf,
  labelIdOf,
  type ControlOf,
  type SettingControlProps,
} from "./types";

/**
 * A hex colour, typed or picked. `ColourInput` takes neither a `disabled` nor
 * a description of its own, and names its two fields itself, so a fieldset
 * carries all three: it disables both fields at once, and gives the pair the
 * setting's label and description.
 */
export function ColourControl({
  value,
  onChange,
  disabled,
  id,
}: SettingControlProps<string, ControlOf<"colour">>) {
  return (
    <fieldset
      disabled={disabled}
      aria-labelledby={labelIdOf(id)}
      aria-describedby={describedByOf(id)}
      className="min-w-0"
    >
      <ColourInput id={id} value={value} onChange={onChange} />
    </fieldset>
  );
}
