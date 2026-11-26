import { fieldKind } from "@/fields";
import {
  customFieldKey,
  customFieldValue,
  type CustomFieldValues,
  kindForField,
} from "@/fields/custom-field";
import type { FieldConfig, FieldKindName, FieldValue } from "@/fields/types";
import type { RowData } from "@tanstack/react-table";
import type { CustomField } from "@workspace/api/api";

import type { createAppColumnHelper } from "./data-table-hook";

/*
 * A project's custom fields as table columns. Kept apart from `columns.tsx`,
 * which a server component reads a constant from: these draw through the
 * field kinds, and `src/fields/index.ts` is only ever imported by client code.
 */

type Helper<T extends RowData> = ReturnType<typeof createAppColumnHelper<T>>;

/** The column menu's heading for a project's custom fields. */
export const CUSTOM_FIELDS_GROUP = "Fields";

/** A value as its field kind shows it, or a dash when the row holds none. */
function FieldValueDisplay({
  value,
  config,
}: {
  value: FieldValue;
  config: FieldConfig & { type: FieldKindName };
}) {
  if (value === null || value === "") {
    return <span className="text-ink-soft">—</span>;
  }
  const kind = fieldKind(config.type);
  const Display = kind.Display;
  return Display ? (
    <Display value={value} config={config} />
  ) : (
    <span className="block truncate">{kind.format(value, config)}</span>
  );
}

/**
 * One column per custom field, keyed `cf_<id>` and read from the row's
 * `fields` bag: sortable, listed under "Fields" in the column menu, and drawn
 * as the field's kind shows a value. A table hides them until asked for by
 * listing the keys in its `initiallyHiddenColumns`.
 */
export function customFieldColumns<T extends { fields?: CustomFieldValues }>(
  helper: Helper<T>,
  fields: readonly CustomField[]
) {
  return fields.map((field) => {
    const key = customFieldKey(field);
    const config = kindForField(field);
    return helper.accessor((row) => customFieldValue(row.fields, key), {
      id: key,
      header: field.name,
      meta: { group: CUSTOM_FIELDS_GROUP },
      cell: (info) => (
        <FieldValueDisplay value={info.getValue()} config={config} />
      ),
    });
  });
}
