import { BlockNoteSchema } from "@blocknote/core";
import { createLyricParagraphSpec } from "./paragraph-block";
import { textBlockSpecs } from "../text-blocks";

/**
 * The lyrics block set: the shared text-only blocks with the lyrics
 * paragraph, which frees Shift+Enter so one visual line is one block.
 */
export const lyricsSchema = BlockNoteSchema.create({
  blockSpecs: textBlockSpecs(createLyricParagraphSpec()),
});

export type LyricsEditor = typeof lyricsSchema.BlockNoteEditor;
