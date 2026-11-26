/**
 * The paragraph the lyrics editor uses: BlockNote's own paragraph with
 * Shift+Enter freed up. `createParagraphBlockSpec` takes no options, so the
 * only way to set `hardBreakShortcut` is to redeclare the spec; the `<p>`
 * render, parse and external-HTML functions below are copied from it verbatim
 * so a paragraph still round-trips exactly as it does everywhere else.
 *
 * Adapted from BlockNote (TypeCell, MPL-2.0),
 * `@blocknote/core/src/blocks/Paragraph/block.ts`:
 * https://github.com/TypeCellOS/BlockNote/blob/main/packages/core/src/blocks/Paragraph/block.ts
 */
import {
  addDefaultPropsExternalHTML,
  createBlockSpec,
  createParagraphBlockConfig,
  parseDefaultProps,
} from "@blocknote/core";

export const createLyricParagraphSpec = createBlockSpec(
  createParagraphBlockConfig,
  {
    meta: {
      isolating: false,
      /**
       * With no hard break to insert, Shift+Enter falls through to a plain
       * block split, so one visual line is always one block — the unit the
       * syllable and rhyme analysis counts.
       */
      hardBreakShortcut: "none",
    },
    parse: (e) => {
      if (e.tagName !== "P") {
        return undefined;
      }

      // Edge case for things like images directly inside paragraph.
      if (!e.textContent?.trim()) {
        return undefined;
      }

      return parseDefaultProps(e);
    },
    render: () => {
      const dom = document.createElement("p");
      return {
        dom,
        contentDOM: dom,
      };
    },
    toExternalHTML: (block) => {
      const dom = document.createElement("p");
      addDefaultPropsExternalHTML(block.props, dom);
      return {
        dom,
        contentDOM: dom,
      };
    },
    runsBefore: ["default", "heading"],
  }
);
