"use client";

import { useCreateBlockNote, useEditorChange } from "@blocknote/react";
import { use } from "react";
import { EditorFrame } from "../frame";
import { sectionInputRule } from "../section-block";
import { useBlockDocument } from "../use-document";
import type { VariantProps } from "../variants";
import { lyricsAnalysis } from "./analysis";
import { LyricsContext } from "./context";
import { splitSoftBreaks } from "./normalise";
import { lyricsSchema } from "./schema";
import { LyricsSuggestionMenus } from "./suggestions";

/**
 * Lyrics: one line per block, with the syllable gutter and rhyme colouring
 * from the analysis plugin and the dictionary menus behind the prefix keys.
 *
 * The dictionary is read once, when the editor is created — an editor's
 * schema and extensions are fixed for its lifetime, so a provider that swaps
 * dictionaries would have to remount the editor for the change to land.
 */
export default function LyricsEditor({
  value,
  onChange,
  editable,
  placeholder,
  theme,
}: VariantProps) {
  const dictionary = use(LyricsContext)?.dictionary ?? null;
  const { initialContent, onDocumentChange } = useBlockDocument(
    value,
    onChange,
    splitSoftBreaks
  );

  const editor = useCreateBlockNote({
    schema: lyricsSchema,
    initialContent,
    extensions: [sectionInputRule, lyricsAnalysis(dictionary)],
    // One string under both keys: BlockNote prints `default` on whichever
    // empty line has the caret and `emptyDocument` on a lone empty block, and
    // the stylesheet keeps only the second, so the two must read alike for the
    // line that is both.
    placeholders: placeholder
      ? { default: placeholder, emptyDocument: placeholder }
      : undefined,
  });

  useEditorChange(onDocumentChange, editor);

  return (
    <EditorFrame
      editor={editor}
      editable={editable}
      theme={theme}
      slashMenu={false}
    >
      <LyricsSuggestionMenus editor={editor} />
    </EditorFrame>
  );
}
