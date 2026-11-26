import type { FieldDraftProps, FieldKind, FieldValue } from "@/fields/types";
import { Checkbox } from "@workspace/ui/components/checkbox";

// Blank is `false` and `required` does not apply: an unticked box is a value.
const parse: FieldKind["parse"] = (raw) => {
  switch (raw.trim().toLowerCase()) {
    case "":
    case "false":
      return { ok: true, value: false };
    case "true":
      return { ok: true, value: true };
    default:
      return { ok: false, error: "Must be true or false" };
  }
};

const format: FieldKind["format"] = (value) =>
  value === true ? "true" : "false";

function CheckboxDraft({
  raw,
  onChange,
  onBlur,
  ref,
  invalid,
  id,
  "aria-describedby": describedBy,
}: FieldDraftProps) {
  return (
    <Checkbox
      id={id}
      checked={raw === "true"}
      onChange={(e) => onChange(format(e.target.checked, {}))}
      onBlur={onBlur}
      ref={ref}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
    />
  );
}

/**
 * The box a checkbox value is read from, never written through: the grid owns
 * the flip for an editor, and a viewer has no flip at all. `label` names it for
 * a caller that renders it outside the grid's own labelled control.
 */
export function CheckboxDisplay({
  value,
  label,
}: {
  value: FieldValue;
  label?: string;
}) {
  return (
    <Checkbox
      aria-label={label}
      checked={value === true}
      readOnly
      tabIndex={-1}
      className="pointer-events-none"
    />
  );
}

export const checkbox = {
  entry: "toggle",
  parse,
  format,
  DraftInput: CheckboxDraft,
  Display: ({ value, config }) => (
    <CheckboxDisplay value={value} label={config.label} />
  ),
  paste: true,
} satisfies FieldKind;
