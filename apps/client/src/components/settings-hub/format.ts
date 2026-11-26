import {
  isSettingKey,
  SETTINGS,
  type SettingControl,
  type SettingDefinition,
} from "@workspace/settings";
import { pluralizeCount } from "@workspace/session-diff/format";
import type { ControlOf, SettingControlKind } from "./controls/types";

/** How the absence of a value reads: a key cleared at a scope, or never set there. */
export const NOT_SET = "(not set)";

/** The most characters a value runs to on one line of a list before it is summarised. */
const VALUE_SUMMARY_LENGTH = 40;

/** Each duration unit's noun; the count makes it plural. */
export const DURATION_UNITS: Readonly<
  Record<ControlOf<"duration">["unit"], string>
> = {
  s: "second",
  min: "minute",
  h: "hour",
  d: "day",
};

/**
 * One kind's reading of a value, or `undefined` for a value that is not that
 * kind's (one stored before its setting changed shape), which then reads raw.
 */
type Formatter<K extends SettingControlKind> = (
  control: ControlOf<K>,
  value: unknown
) => string | undefined;

const isStrings = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((each) => typeof each === "string");

const listed = (items: readonly string[]) =>
  items.length === 0 ? "(none)" : items.join(", ");

const optionLabel = (
  options: ControlOf<"select">["options"],
  value: string
): string => options.find((option) => option.value === value)?.label ?? value;

const measured = (value: unknown, unit?: string) =>
  typeof value !== "number"
    ? undefined
    : unit === undefined
      ? String(value)
      : `${value} ${unit}`;

/** Text on one line, trimmed, in quotes so an empty or a one-symbol value still shows. */
const quoted = (text: string) => `“${text.trim().replace(/\s+/g, " ")}”`;

/** How each kind of control's value reads on one line, one entry each, alphabetical. */
const FORMATTERS: { readonly [K in SettingControlKind]: Formatter<K> } = {
  colour: (_, value) => (typeof value === "string" ? value : undefined),
  custom: () => undefined,
  duration: ({ unit }, value) =>
    typeof value === "number"
      ? pluralizeCount(value, DURATION_UNITS[unit])
      : undefined,
  list: (_, value) => (isStrings(value) ? listed(value) : undefined),
  multiselect: ({ options }, value) =>
    isStrings(value)
      ? listed(value.map((each) => optionLabel(options, each)))
      : undefined,
  number: ({ unit }, value) => measured(value, unit),
  select: ({ options }, value) =>
    typeof value === "string" ? optionLabel(options, value) : undefined,
  slider: ({ unit }, value) => measured(value, unit),
  text: (_, value) => (typeof value === "string" ? quoted(value) : undefined),
  toggle: (_, value) =>
    typeof value === "boolean" ? (value ? "On" : "Off") : undefined,
};

const raw = (value: unknown): string =>
  typeof value === "string" ? value : (JSON.stringify(value) ?? String(value));

/**
 * The registry's setting for `key`, or `undefined` for a key it does not know
 * (a setting since removed, or one from another instance).
 */
export const settingOf = (key: string): SettingDefinition | undefined =>
  isSettingKey(key) ? SETTINGS[key] : undefined;

/** How a key reads: its setting's label, or the key itself once the registry no longer knows it. */
export const settingLabel = (key: string): string =>
  settingOf(key)?.label ?? key;

/**
 * A setting's value as one line, read the way its control shows it: a
 * toggle On or Off, a select's option by its label, a list's entries joined,
 * a number with its unit, a colour as its hex, text in quotes. No value reads
 * "(not set)". A value its control cannot read, and any value of a setting
 * the registry does not know (`definition` absent), prints raw.
 */
export function formatSettingValue(
  definition: SettingDefinition | undefined,
  value: unknown
): string {
  if (value === null || value === undefined) return NOT_SET;
  if (!definition) return raw(value);
  const format = FORMATTERS[definition.control.kind] as (
    control: SettingControl,
    value: unknown
  ) => string | undefined;
  return format(definition.control, value) ?? raw(value);
}

/** A value short enough for one line of a list, and the whole of it where that cut it short. */
export type ValueSummary = { text: string; whole?: string };

/**
 * `formatSettingValue`, kept to one line of a list: a value longer than
 * `VALUE_SUMMARY_LENGTH` characters reads as its count of items when it is a
 * list, else as its first `VALUE_SUMMARY_LENGTH` characters.
 */
export function summariseSettingValue(
  definition: SettingDefinition | undefined,
  value: unknown
): ValueSummary {
  const text = formatSettingValue(definition, value);
  const characters = [...text];
  if (characters.length <= VALUE_SUMMARY_LENGTH) return { text };
  if (Array.isArray(value)) {
    return { text: pluralizeCount(value.length, "item"), whole: text };
  }
  return {
    text: `${characters.slice(0, VALUE_SUMMARY_LENGTH).join("")}…`,
    whole: text,
  };
}

/** Whether two setting values are the same value. Values are JSON, so the same structure is the same value. */
export function sameSettingValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (
    typeof a !== "object" ||
    typeof b !== "object" ||
    a === null ||
    b === null ||
    Array.isArray(a) !== Array.isArray(b)
  ) {
    return false;
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every(
      (key) =>
        Object.hasOwn(right, key) && sameSettingValue(left[key], right[key])
    )
  );
}
