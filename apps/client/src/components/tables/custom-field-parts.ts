import {
  customFieldKey,
  type CustomFieldKey,
  customFieldValue,
  type CustomFieldValues,
  kindForField,
} from "@/fields/custom-field";
import type { CustomField, CustomFieldType } from "@workspace/api/api";

import type {
  EditableCellConfig,
  FilterColumnConfig,
} from "./generic-table-types";

type FilterControlOf = DistributiveOmit<
  FilterColumnConfig,
  "id" | "label" | "param"
>;
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

/**
 * What a field's type decides about its table parts. `filter` is its control,
 * in the server's encoding for that type. `groupValue`, on a type the server
 * groups by, reads one of its group keys back as a value of the field, which is
 * what a draft opened under that group's header is seeded with.
 */
type CustomFieldTableType = {
  filter: (field: CustomField) => FilterControlOf;
  groupValue?: (key: string) => string | boolean;
};

const UNSET = { value: "unset", label: "Not set" };

const TABLE_TYPES: Record<CustomFieldType, CustomFieldTableType> = {
  text: { filter: () => ({ control: "text" }) },
  number: { filter: () => ({ control: "range", input: "number" }) },
  date: { filter: () => ({ control: "range", input: "date" }) },
  // Membership with counts, as a status filter has them.
  select: {
    filter: (field) => ({
      options: field.options.map(({ id, label }) => ({ value: id, label })),
      multiple: true,
    }),
    groupValue: (key) => key,
  },
  checkbox: {
    filter: () => ({
      options: [
        { value: "true", label: "Yes" },
        { value: "false", label: "No" },
        UNSET,
      ],
      counted: false,
    }),
    groupValue: (key) => key === "true",
  },
  url: {
    filter: () => ({
      options: [{ value: "set", label: "Set" }, UNSET],
      counted: false,
    }),
  },
};

/*
 * A project's custom fields as the parts of an entity table: beside the
 * columns `customFieldColumns` builds, their editors, their filters, their
 * groupings and their draft seeds. Every part is keyed `cf_<id>`, the key the
 * server reads in a sort, a filter, a grouping and a patch.
 */

/** The fields' keys, in their order: their column ids, and their draft inputs. */
export function customFieldKeys(
  fields: readonly CustomField[]
): CustomFieldKey[] {
  return fields.map(customFieldKey);
}

/** Each field's cell editor: the kind its type is entered with. */
export function customFieldCells(
  fields: readonly CustomField[]
): Record<CustomFieldKey, EditableCellConfig> {
  return Object.fromEntries(
    fields.map((field) => [customFieldKey(field), kindForField(field)])
  );
}

/**
 * A grouping per field whose type the server groups by (a select, a checkbox),
 * narrowed to one group by the field's own filter.
 */
export function customFieldGroupings(
  fields: readonly CustomField[]
): { id: string; label: string; filterParam: string }[] {
  return fields
    .filter((field) => TABLE_TYPES[field.type].groupValue)
    .map((field) => {
      const key = customFieldKey(field);
      return { id: key, label: field.name, filterParam: key };
    });
}

/**
 * A row's group under a custom field's grouping, keyed as the server keys it
 * (a select's option id, a checkbox's `"true"` / `"false"`), or null for the
 * "Not set" bucket.
 */
export function customFieldGroupKey(
  row: { fields?: CustomFieldValues },
  key: CustomFieldKey
): string | null {
  const value = customFieldValue(row.fields, key);
  return value === null ? null : String(value);
}

/**
 * What a draft opened under one group's header of a custom field's grouping is
 * seeded with: the field, and the group's key read back as its value. Null
 * when `groupParam` names no field the table has, or one it cannot group by.
 */
export function customFieldSeed(
  fields: readonly CustomField[],
  groupParam: string,
  groupKey: string
): { field: CustomFieldKey; value: string | boolean } | null {
  const field = fields.find((f) => customFieldKey(f) === groupParam);
  const groupValue = field && TABLE_TYPES[field.type].groupValue;
  return field && groupValue
    ? { field: customFieldKey(field), value: groupValue(groupKey) }
    : null;
}

/**
 * Each field's filter, by its type: a range for a number or a date, a
 * membership with counts for a select, Yes / No / Not set for a checkbox, Set /
 * Not set for a url, and contains for text.
 */
export function customFieldFilterColumns(
  fields: readonly CustomField[]
): FilterColumnConfig[] {
  return fields.map((field) => {
    const key = customFieldKey(field);
    return {
      id: key,
      label: field.name,
      param: key,
      ...TABLE_TYPES[field.type].filter(field),
    } as FilterColumnConfig;
  });
}
