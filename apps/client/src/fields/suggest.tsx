import { inputDraft, inputEditor } from "@/fields/input";
import { formatScalar, parseTrimmed } from "@/fields/scalar";
import type { FieldKind } from "@/fields/types";

// Suggestions only complete the text: whatever is typed is a valid value.
const parse = parseTrimmed((trimmed) => ({ ok: true, value: trimmed }));

export const suggest = {
  entry: "editor",
  parse,
  format: formatScalar,
  Editor: inputEditor({ parse, format: formatScalar }, { suggest: true }),
  DraftInput: inputDraft({ suggest: true }),
  paste: true,
} satisfies FieldKind;
