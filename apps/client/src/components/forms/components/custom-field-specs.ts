import type { FieldSpec } from "@/components/forms/components/EntityForm";
import {
  customFieldKey,
  type CustomFieldKey,
  kindForField,
} from "@/fields/custom-field";
import type { CustomField } from "@workspace/api/api";
import type { FieldValues, Path } from "react-hook-form";

/** A create form's raw values for the custom fields it offers, keyed `cf_<id>`. */
export type CustomFieldDrafts = { [key: CustomFieldKey]: string };

/**
 * One optional row per custom field, in the fields' order, entered and parsed
 * with the kind its type takes. A create form appends these after its own.
 */
export function customFieldSpecs<T extends FieldValues>(
  fields: readonly CustomField[]
): FieldSpec<T>[] {
  return fields.map((field) => {
    const config = kindForField(field);
    return {
      kind: "field-kind",
      name: customFieldKey(field) as Path<T>,
      field: config.type,
      config,
      label: field.name,
    };
  });
}

/** Every custom field blank, for a create form's defaults. */
export function customFieldDefaults(
  fields: readonly CustomField[]
): CustomFieldDrafts {
  return Object.fromEntries(fields.map((field) => [customFieldKey(field), ""]));
}
