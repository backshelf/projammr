import { StatusCell } from "@/components/status/StatusCell";
import { parseTrimmed } from "@/fields/scalar";
import type { FieldDraftProps, FieldKind } from "@/fields/types";

const parse = parseTrimmed((trimmed, config) => {
  const id = Number(trimmed);
  return (config.statuses ?? []).some((s) => s.id === id)
    ? { ok: true, value: id }
    : { ok: false, error: "Not a status" };
});

function StatusDraftInput({
  raw,
  config,
  onChange,
  onBlur,
  ref,
  invalid,
  id,
  "aria-labelledby": labelledBy,
  "aria-describedby": describedBy,
}: FieldDraftProps) {
  const parsed = raw === "" ? null : Number(raw);
  return (
    <StatusCell
      id={id}
      invalid={invalid}
      statuses={config.statuses ?? []}
      value={parsed !== null && Number.isNaN(parsed) ? null : parsed}
      onSave={(id) => onChange(id === null ? "" : String(id))}
      onBlur={onBlur}
      ref={ref}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
    />
  );
}

export const status = {
  entry: "self",
  parse,
  format: (value, config) =>
    (config.statuses ?? []).find((s) => s.id === value)?.name ?? "",
  DraftInput: StatusDraftInput,
  optimisticPatch: (value, config) => {
    // `== null`, not `=== null`, to match the grid branch this replaces: it
    // treats an absent value the same as a cleared one.
    const statusId = value == null ? null : Number(value);
    return {
      statusId,
      status:
        statusId === null
          ? null
          : ((config.statuses ?? []).find((s) => s.id === statusId) ?? null),
    };
  },
  saveAs: "statusId",
  paste: false,
} satisfies FieldKind;
