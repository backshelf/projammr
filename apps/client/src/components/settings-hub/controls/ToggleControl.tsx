"use client";

import { Switch } from "@workspace/ui/components/switch";
import {
  describedByOf,
  type ControlOf,
  type SettingControlProps,
} from "./types";

/** On or off: the app's switch. */
export function ToggleControl({
  value,
  onChange,
  disabled,
  id,
}: SettingControlProps<boolean, ControlOf<"toggle">>) {
  return (
    <Switch
      id={id}
      checked={value}
      onCheckedChange={onChange}
      disabled={disabled}
      aria-describedby={describedByOf(id)}
    />
  );
}
