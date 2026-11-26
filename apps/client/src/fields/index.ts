import { checkbox } from "@/fields/checkbox";
import { date } from "@/fields/date";
import { number } from "@/fields/number";
import { list } from "@/fields/list";
import { priority } from "@/fields/priority";
import { select } from "@/fields/select";
import { status } from "@/fields/status";
import { suggest } from "@/fields/suggest";
import { text } from "@/fields/text";
import type {
  FieldConfig,
  FieldKind,
  FieldKindName,
  FieldValue,
} from "@/fields/types";
import { url } from "@/fields/url";
import type { Formatters } from "@workspace/ui/lib/formatters";

/**
 * The client's field-kind registry, keyed by the `EditableCellConfig["type"]`
 * strings. Every kind is one module that says how its values are parsed,
 * formatted and entered; a consumer looks a kind up here instead of switching on
 * its name. Adding a kind is a file and a line in this object.
 *
 * Everything reachable from this file is safe to import from a client component.
 */
export const FIELD_KINDS = {
  text,
  number,
  date,
  select,
  status,
  checkbox,
  priority,
  list,
  suggest,
  url,
} as const satisfies Record<FieldKindName, FieldKind>;

const REGISTRY: Partial<Record<FieldKindName, FieldKind>> = FIELD_KINDS;

/** The module for `name`; throws on a name the record has no module for. */
export function fieldKind(name: FieldKindName): FieldKind {
  const kind = REGISTRY[name];
  if (!kind) throw new Error(`No field kind is registered for "${name}"`);
  return kind;
}

/**
 * A value in words, for text that names it (an activity line, a palette row):
 * a box's state as Yes or No, anything else as its kind describes it in the
 * viewer's formats.
 */
export function describeValue(
  config: { type: FieldKindName } & FieldConfig,
  value: FieldValue,
  formatters: Formatters
): string {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  const kind = fieldKind(config.type);
  return kind.describe
    ? kind.describe(value, config, formatters)
    : kind.format(value, config);
}
