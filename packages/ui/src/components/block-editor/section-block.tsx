"use client";

import { createExtension } from "@blocknote/core";
import { createReactBlockSpec } from "@blocknote/react";

/**
 * A section header — "Verse 1", "Chorus", "Bridge" in a lyrics document, any
 * heading-like break in a plain note. Its label is inline content, so it is
 * ordinary editable text and is saved with the rest of the document; the
 * block carries no props, and none may be named `text` because that name is
 * taken by the indexed `$.**.text` path.
 */
export const createSectionBlockSpec = createReactBlockSpec(
  {
    type: "section",
    propSchema: {},
    content: "inline",
  },
  {
    render: (props) => <div ref={props.contentRef} />,
  }
);

/**
 * Typing `[Chorus]` on its own line turns the block into that section. The
 * extension manager deletes the matched text and retypes the block from what
 * `replace` returns.
 *
 * It then parks the cursor at the start of the rewritten block, which puts it
 * to the left of the label that was just typed. The block keeps its id through
 * the rewrite, so the cursor can be sent to the end of it once the rule's
 * transaction has been dispatched.
 */
export const sectionInputRule = createExtension({
  key: "lyrics-section-input-rule",
  inputRules: [
    {
      find: /^\[([^\]]+)\]$/,
      replace: ({ match, editor }) => {
        const label = match[1];
        if (!label) {
          return undefined;
        }
        const { block } = editor.getTextCursorPosition();
        queueMicrotask(() => editor.setTextCursorPosition(block.id, "end"));
        return { type: "section", content: label };
      },
    },
  ],
});
