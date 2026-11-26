import { inputDraft, inputEditor } from "@/fields/input";
import { formatScalar, parseTrimmed } from "@/fields/scalar";
import type { FieldKind } from "@/fields/types";

const parse = parseTrimmed((trimmed) => ({ ok: true, value: trimmed }));

export const text = {
  entry: "editor",
  parse,
  format: formatScalar,
  Editor: inputEditor({ parse, format: formatScalar }),
  DraftInput: inputDraft(),
  paste: true,
} satisfies FieldKind;
