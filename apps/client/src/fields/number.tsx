import { inputDraft, inputEditor } from "@/fields/input";
import { formatScalar, parseTrimmed } from "@/fields/scalar";
import type { FieldKind } from "@/fields/types";
import { useFormat } from "@workspace/ui/components/format-provider";

const parse = parseTrimmed((trimmed) => {
  const value = Number(trimmed);
  return Number.isFinite(value)
    ? { ok: true, value }
    : { ok: false, error: "Must be a number" };
});

const describe: NonNullable<FieldKind["describe"]> = (
  value,
  _config,
  formatters
) => (typeof value === "number" ? formatters.number(value) : "");

// A text input rather than `type="number"`: the browser reads text it cannot
// parse as an empty value, which would save as a cleared cell instead of
// reaching `parse`.
export const number = {
  entry: "editor",
  parse,
  format: formatScalar,
  Editor: inputEditor(
    { parse, format: formatScalar },
    { inputMode: "decimal" }
  ),
  describe,
  DraftInput: inputDraft({ inputMode: "decimal" }),
  // Figures line up down a column, as every count column's do.
  Display: function NumberDisplay({ value, config }) {
    return (
      <span className="block w-full truncate text-right tabular-nums">
        {describe(value, config, useFormat())}
      </span>
    );
  },
  paste: true,
} satisfies FieldKind;
