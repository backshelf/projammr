/*
 * A project's custom fields, as the client addresses them. A field's values
 * travel in a row's `fields` bag and in the query string under one key,
 * `cf_<id>`, which is also the field's column id, its filter param, its sort
 * key and its grouping key. Everything here is plain data, safe to import from
 * a server action or a server component.
 */

import type { FieldConfig, FieldKindName, FieldValue } from "@/fields/types";
import type { CustomField } from "@workspace/api/api";

/** The key a custom field goes by everywhere: `cf_<id>`. */
export type CustomFieldKey = `cf_${number}`;

/** A custom field's filter values by key, as the query string carries them. */
export type CustomFieldParams = { [key: CustomFieldKey]: string };

const CUSTOM_FIELD_KEY = /^cf_\d+$/;

/** The key of the field whose id is `id`. */
export function customFieldKey({ id }: { id: number }): CustomFieldKey {
  return `cf_${id}`;
}

/** Whether `key` names a custom field (`cf_` then the field's id). */
export function isCustomFieldKey(key: string): key is CustomFieldKey {
  return CUSTOM_FIELD_KEY.test(key);
}

/** The field id a custom field key names. */
export function customFieldIdOf(key: CustomFieldKey): number {
  return Number(key.slice(3));
}

/**
 * The field kind a custom field is entered, parsed and shown with, and that
 * kind's config: each type is the kind of the same name, and a select's options
 * are the field's own, valued by option id. The same shape as a table's
 * `EditableCellConfig`, so it serves a cell, a draft row, a form row and the
 * bulk bar alike.
 */
export function kindForField(
  field: Pick<CustomField, "name" | "type" | "options">
): { type: FieldKindName } & FieldConfig {
  const config = { type: field.type, label: field.name };
  return field.options.length > 0
    ? {
        ...config,
        options: field.options.map(({ id, label, colour }) => ({
          value: id,
          label,
          ...(colour ? { colour } : {}),
        })),
      }
    : config;
}

/** A row's custom values, keyed `cf_<id>`, as the server sends them. */
export type CustomFieldValues = Record<string, string | number | boolean>;

/** The value a row's `fields` bag holds under `key`, or null when it holds none. */
export function customFieldValue(
  bag: CustomFieldValues | undefined,
  key: string
): FieldValue {
  return bag?.[key] ?? null;
}

/** `bag` with `key` set to `value`, or without it when `value` clears it. */
export function withCustomFieldValue(
  bag: CustomFieldValues | undefined,
  key: string,
  value: FieldValue
): CustomFieldValues {
  const next = { ...bag };
  delete next[key];
  if (value !== null && !Array.isArray(value)) next[key] = value;
  return next;
}

/**
 * The patch body that writes `value` to `field` of a row: a custom field's
 * value travels in the `fields` bag, any other field under its own name.
 */
export function fieldWriteBody(
  field: string,
  value: unknown
): Record<string, unknown> {
  return isCustomFieldKey(field)
    ? { fields: { [field]: value } }
    : { [field]: value };
}

/**
 * A parsed create form with its custom values moved into the `fields` bag a
 * create body takes, the rest as they were: a create body names no `cf_` key
 * of its own.
 */
export function bagCustomFields<T extends Record<string, unknown>>(
  draft: T
): Omit<T, CustomFieldKey> & { fields?: CustomFieldValues } {
  const columns = Object.fromEntries(
    Object.entries(draft).filter(([key]) => !isCustomFieldKey(key))
  ) as Omit<T, CustomFieldKey>;
  const fields = customFieldWrites(draft);
  return fields ? { ...columns, fields } : columns;
}

/**
 * The custom values among a parsed draft (a table's draft row, a create form),
 * as a create body's `fields` bag: every custom field the draft filled. A blank
 * one is left out, since a new row has nothing to clear.
 */
export function customFieldWrites(
  draft: Record<string, unknown>
): CustomFieldValues | undefined {
  const bag: CustomFieldValues = {};
  for (const [key, value] of Object.entries(draft)) {
    if (!isCustomFieldKey(key)) continue;
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      bag[key] = value;
    }
  }
  return Object.keys(bag).length > 0 ? bag : undefined;
}
