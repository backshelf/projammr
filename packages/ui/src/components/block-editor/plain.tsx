"use client";

import { BlockNoteSchema } from "@blocknote/core";
import { useCreateBlockNote, useEditorChange } from "@blocknote/react";
import { EditorFrame } from "./frame";
import { textBlockSpecs } from "./text-blocks";
import { useBlockDocument } from "./use-document";
import { editorDomAttributes, type VariantProps } from "./variants";

export const plainSchema = BlockNoteSchema.create({
  blockSpecs: textBlockSpecs(),
});

/**
 * Plain notes: the same text-only block set the lyrics editor uses, minus
 * anything lyrics-specific — the stock paragraph, no section input rule, no
 * suggestion menus, no analysis plugin. BlockNote's default slash menu only
 * ever lists the blocks present in the schema, so it needs no manual hiding.
 */
export default function PlainEditor({
  value,
  onChange,
  editable,
  placeholder,
  ariaLabel,
  theme,
}: VariantProps) {
  const { initialContent, onDocumentChange } = useBlockDocument(
    value,
    onChange
  );

  const editor = useCreateBlockNote({
    schema: plainSchema,
    initialContent,
    domAttributes: editorDomAttributes(ariaLabel),
    // Both keys, as the lyrics editor sets them: `default` shows only on the
    // line holding the caret, so without `emptyDocument` a blank note reads
    // as nothing at all until it is clicked into.
    placeholders: placeholder
      ? { default: placeholder, emptyDocument: placeholder }
      : undefined,
  });

  useEditorChange(onDocumentChange, editor);

  return <EditorFrame editor={editor} editable={editable} theme={theme} />;
}
