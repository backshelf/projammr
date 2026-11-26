import type { PartialBlock } from "@blocknote/core";

/**
 * Parse a stored value into PartialBlock[] for initialContent. Falls back to
 * a plain text paragraph for legacy plain-text data.
 *
 * Some jsonb rows were written before notes/lyrics moved off `JSON.stringify`d
 * strings (a prior version of the editor's save path double-encoded them), so
 * the value can come back as a string that itself parses to another string
 * rather than a block array — one extra parse unwraps that layer.
 */
export function parseInitialValue(raw?: unknown): PartialBlock[] {
  let value: unknown = raw;

  for (let i = 0; i < 2 && typeof value === "string"; i++) {
    if (!value) return [{ type: "paragraph" }];
    try {
      value = JSON.parse(value);
    } catch {
      // Legacy plain text — wrap in a paragraph block.
      return [
        { type: "paragraph", content: [{ type: "text", text: value }] },
      ] as PartialBlock[];
    }
  }

  if (!value || !Array.isArray(value)) {
    return [{ type: "paragraph" }];
  }

  return value as PartialBlock[];
}

/**
 * Whether a document has nothing written in it — the empty paragraph an
 * editor opens with, and nothing else. Such a document never creates a note.
 */
export const isBlankDocument = (blocks: readonly object[]): boolean =>
  blocks.every((block) => {
    const { content, children } = block as {
      content?: unknown;
      children?: unknown;
    };
    return (
      !(Array.isArray(children) && children.length > 0) &&
      !(Array.isArray(content) && content.length > 0)
    );
  });

/**
 * Whether a stored rich-text value (a block array, its JSON, legacy plain
 * text, or nothing) would open as a blank editor.
 */
export const isBlankStoredDocument = (raw: unknown): boolean =>
  isBlankDocument(parseInitialValue(raw));
