"use client";

import { Switch } from "@workspace/ui/components/switch";
import {
  describedByOf,
  labelIdOf,
  type ControlOf,
  type SettingControlProps,
} from "../types";

/** A partial record, kind → whether it asks; a kind missing is on (asks). */
type Confirms = Record<string, boolean>;

/**
 * One switch per kind of delete, on unless the record turns it off. A toggle
 * writes the full record, one boolean for every kind the setting's options
 * list, so the stored value always names every kind the app currently knows.
 */
export function DeleteConfirmsControl({
  definition,
  value,
  onChange,
  disabled,
  id,
}: SettingControlProps<unknown, ControlOf<"custom">>) {
  const options = definition.control.options ?? [];
  const stored = (value ?? {}) as Confirms;

  const set = (kind: string, asks: boolean) =>
    onChange(
      Object.fromEntries(
        options.map((option) => [
          option.value,
          option.value === kind ? asks : (stored[option.value] ?? true),
        ])
      )
    );

  return (
    <div
      id={id}
      role="group"
      aria-labelledby={labelIdOf(id)}
      aria-describedby={describedByOf(id)}
      className="flex w-72 flex-col gap-1.5"
    >
      {options.map((option) => {
        const asks = stored[option.value] ?? true;
        return (
          <span key={option.value} className="flex items-center gap-2">
            <Switch
              checked={asks}
              disabled={disabled}
              aria-label={option.label}
              onCheckedChange={(next) => set(option.value, next)}
            />
            <span className="text-small">{option.label}</span>
          </span>
        );
      })}
    </div>
  );
}
