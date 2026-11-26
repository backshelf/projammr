"use client";

import { TogglePill } from "@workspace/ui/components/toggle-pill";
import type { ComponentProps } from "react";
import {
  describedByOf,
  labelIdOf,
  type ControlOf,
  type SettingControlProps,
} from "./types";

/** Any of a list: one pill per option, pressed when chosen. The value keeps the options' order. */
export function MultiselectControl({
  definition,
  value,
  onChange,
  disabled,
  id,
}: SettingControlProps<readonly string[], ControlOf<"multiselect">>) {
  return (
    <MultiselectPills
      options={definition.control.options}
      value={value}
      onChange={onChange}
      disabled={disabled}
      id={id}
      aria-labelledby={labelIdOf(id)}
      aria-describedby={describedByOf(id)}
    />
  );
}

/**
 * The multiselect's pills on their own, for a control that edits several such
 * lists at once: a group of `options`, each pressed when `value` holds it. A
 * change hands up the pressed options in the options' order.
 */
export function MultiselectPills({
  options,
  value,
  onChange,
  disabled,
  ...group
}: {
  options: ControlOf<"multiselect">["options"];
  value: readonly string[];
  onChange: (value: string[]) => void;
  disabled: boolean;
} & Pick<
  ComponentProps<"div">,
  "id" | "aria-label" | "aria-labelledby" | "aria-describedby"
>) {
  const chosen = new Set(value);

  return (
    <div {...group} role="group" className="flex max-w-72 flex-wrap gap-1.5">
      {options.map((option) => (
        <TogglePill
          key={option.value}
          pressed={chosen.has(option.value)}
          disabled={disabled}
          onPressedChange={(pressed) =>
            onChange(
              options
                .filter((each) =>
                  each.value === option.value ? pressed : chosen.has(each.value)
                )
                .map((each) => each.value)
            )
          }
        >
          {option.label}
        </TogglePill>
      ))}
    </div>
  );
}
