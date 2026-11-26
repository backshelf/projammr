import type { PartialBlock } from "@blocknote/core";
import { parseInitialValue } from "@workspace/ui/lib/block-document";
import { useLatestRef } from "@workspace/ui/hooks/use-latest-ref";
import { useCallback, useState } from "react";

/**
 * The document half of an editor variant: the blocks it starts from and the
 * change handler that serializes it back out.
 *
 * The blocks are parsed once — a mounted editor owns its document and never
 * re-reads `initialContent`, so re-parsing the incoming string on every
 * keystroke is pure waste. `onDocumentChange` keeps one identity for the life
 * of the editor and reads the caller's callback through a ref, so
 * `useEditorChange` subscribes once instead of on every render.
 *
 * `normalise` reshapes the parsed blocks into what the variant's schema
 * expects — it runs in the same one-off pass as the parse.
 */
export function useBlockDocument(
  value?: string,
  onChange?: (json: string) => void,
  normalise?: (blocks: PartialBlock[]) => PartialBlock[]
) {
  const [initialContent] = useState(() => {
    const blocks = parseInitialValue(value);
    return normalise ? normalise(blocks) : blocks;
  });
  const onChangeRef = useLatestRef(onChange);

  const onDocumentChange = useCallback(
    (editor: { document: unknown }) => {
      onChangeRef.current?.(JSON.stringify(editor.document));
    },
    [onChangeRef]
  );

  return { initialContent, onDocumentChange };
}
