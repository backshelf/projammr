import type { PatchableEntity } from "@/actions/patch-field";
import InlinePropertyEditor from "@/components/editing/InlinePropertyEditor";
import {
  customFieldKey,
  type CustomFieldValues,
  kindForField,
} from "@/fields/custom-field";
import type { CustomField } from "@workspace/api/api";
import { RailBlock } from "@workspace/ui/components/layout/rail";
import type { Formatters } from "@workspace/ui/lib/formatters";

/**
 * The rail's block of an entity's custom fields: each field paired off beside
 * the next under its own name, as the rail pairs short values, and edited in
 * place with the editor its type takes. An unset field offers to be added; any
 * field may be cleared by saving it empty. Nothing renders for a project with
 * no fields of the entity's kind. `format` is the viewer's formatter set, from
 * the server render's `cachedFormatters()`.
 */
export function CustomFieldsBlock({
  fields,
  values,
  entityType,
  entityId,
  format,
}: {
  fields: readonly CustomField[];
  /** The entity's `fields` bag, keyed `cf_<id>`. */
  values: CustomFieldValues | undefined;
  entityType: PatchableEntity;
  entityId: number;
  format: Formatters;
}) {
  if (fields.length === 0) return null;
  return (
    <RailBlock grid>
      {fields.map((field) => {
        const key = customFieldKey(field);
        const value = values?.[key];
        return (
          <InlinePropertyEditor
            key={key}
            label={field.name}
            value={value}
            type={field.type}
            entityType={entityType}
            entityId={entityId}
            fieldName={key}
            options={kindForField(field).options}
            clearable
            displayValue={
              field.type === "date" && typeof value === "string"
                ? format.date(value)
                : field.type === "number" && typeof value === "number"
                  ? format.number(value)
                  : undefined
            }
          />
        );
      })}
    </RailBlock>
  );
}
