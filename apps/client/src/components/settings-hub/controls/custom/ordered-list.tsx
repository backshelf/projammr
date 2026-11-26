"use client";

import { IconChevronDown, IconChevronUp } from "@tabler/icons-react";
import { IconButton } from "@workspace/ui/components/icon-button";
import { completeArrangedList } from "@workspace/settings/options";
import { Switch } from "@workspace/ui/components/switch";
import {
  describedByOf,
  labelIdOf,
  type ControlOf,
  type SettingControlProps,
} from "../types";

/**
 * One row of an ordered list: the app's own id, whether it shows, and
 * anything else the setting keeps beside them (a section's `collapsed`, say).
 */
type Row = { id: string; shown: boolean } & Record<string, unknown>;

/**
 * The rows to show: every stored row whose id the app still knows, in stored
 * order, then every default row the store has never heard of, appended shown.
 */
const rowsFor = (value: unknown, defaults: unknown): Row[] =>
  completeArrangedList(
    Array.isArray(value) ? (value as Row[]) : [],
    Array.isArray(defaults) ? (defaults as Row[]) : []
  );

const labelFor = (
  options: readonly { value: string; label: string }[],
  id: string
) => options.find((option) => option.value === id)?.label ?? id;

/**
 * A list the viewer arranges: every option the app knows, in the order they
 * choose, each shown or hidden. A write always sends the full list,
 * normalised to the app's current options, each row spread so fields the
 * setting keeps beside `id` and `shown` survive the move or the toggle.
 */
export function OrderedListControl({
  definition,
  value,
  onChange,
  disabled,
  id,
}: SettingControlProps<unknown, ControlOf<"custom">>) {
  const options = definition.control.options ?? [];
  const rows = rowsFor(value, definition.default);

  const move = (index: number, by: -1 | 1) => {
    const at = index + by;
    if (at < 0 || at >= rows.length) return;
    const next = [...rows];
    [next[index], next[at]] = [next[at]!, next[index]!];
    onChange(next);
  };

  const setShown = (index: number, shown: boolean) =>
    onChange(rows.map((row, at) => (at === index ? { ...row, shown } : row)));

  return (
    <div
      id={id}
      role="group"
      aria-labelledby={labelIdOf(id)}
      aria-describedby={describedByOf(id)}
      className="flex w-72 flex-col gap-1.5"
    >
      {rows.map((row, index) => {
        const label = labelFor(options, row.id);
        return (
          <span key={row.id} className="flex items-center gap-1.5">
            <span className="flex flex-col">
              <IconButton
                disabled={disabled || index === 0}
                aria-label={`Move ${label} up`}
                onClick={() => move(index, -1)}
              >
                <IconChevronUp aria-hidden />
              </IconButton>
              <IconButton
                disabled={disabled || index === rows.length - 1}
                aria-label={`Move ${label} down`}
                onClick={() => move(index, 1)}
              >
                <IconChevronDown aria-hidden />
              </IconButton>
            </span>
            <span className="flex-1 text-small">{label}</span>
            <Switch
              checked={row.shown}
              disabled={disabled}
              aria-label={`Show ${label}`}
              onCheckedChange={(shown) => setShown(index, shown)}
            />
          </span>
        );
      })}
    </div>
  );
}
