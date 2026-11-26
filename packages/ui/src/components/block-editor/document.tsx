"use client";

import { useCreateBlockNote, useEditorChange } from "@blocknote/react";
import { EditorFrame } from "./frame";
import { useBlockDocument } from "./use-document";
import type { VariantProps } from "./variants";

/** Prose: BlockNote's default schema, no extensions. */
export default function DocumentEditor({
  value,
  onChange,
  editable,
  placeholder,
  theme,
}: VariantProps) {
  const { initialContent, onDocumentChange } = useBlockDocument(
    value,
    onChange
  );

  // ponytail: BlockNote's placeholder API uses key "default", not "none".
  const editor = useCreateBlockNote({
    initialContent,
    placeholders: placeholder ? { default: placeholder } : undefined,
  });

  useEditorChange(onDocumentChange, editor);

  return <EditorFrame editor={editor} editable={editable} theme={theme} />;
}
