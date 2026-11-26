"use client";

import { describeValue } from "@/fields";
import { kindForField } from "@/fields/custom-field";
import type { CustomField } from "@workspace/api/api";
import { useFormat } from "@workspace/ui/components/format-provider";

/**
 * A custom field's change in the activity feed: the field's name over its
 * `cf_<id>` key, and each value as the field's kind reads it (a select's
 * option by its label, a box as Yes or No). A field deleted since keeps its
 * key, and its values print raw. A client component because the field kinds
 * that read the values are client-only (`src/fields/index.ts`).
 */
export function CustomFieldChange({
  fieldKey,
  field,
  from,
  to,
}: {
  fieldKey: string;
  field: CustomField | undefined;
  from: unknown;
  to: unknown;
}) {
  const format = useFormat();
  const config = field && kindForField(field);
  const show = (value: unknown) => {
    if (value === null || value === undefined || value === "") return "—";
    if (
      config &&
      (typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean")
    ) {
      return describeValue(config, value, format);
    }
    return String(value);
  };
  return (
    <span className="mt-[0.1875rem] block text-ink-soft">
      {field?.name ?? fieldKey}:{" "}
      <span className="text-ink-soft">{show(from)}</span> →{" "}
      <span className="text-ink">{show(to)}</span>
    </span>
  );
}
