import { inputDraft, inputEditor } from "@/fields/input";
import type { FieldKind, FieldValue } from "@/fields/types";

const parse: FieldKind["parse"] = (raw, config) => {
  const entries = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return entries.length === 0 && config.required
    ? { ok: false, error: "Required" }
    : { ok: true, value: entries };
};

const format = (value: FieldValue) =>
  Array.isArray(value) ? value.join(", ") : "";

export const list = {
  entry: "editor",
  parse,
  format,
  Editor: inputEditor({ parse, format }),
  DraftInput: inputDraft(),
  paste: true,
} satisfies FieldKind;
