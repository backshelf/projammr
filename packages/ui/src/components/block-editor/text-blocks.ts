import { createParagraphBlockSpec, defaultBlockSpecs } from "@blocknote/core";
import { createSectionBlockSpec } from "./section-block";

/** What `createParagraphBlockSpec()` returns — the stock paragraph, and the
 * shape `createLyricParagraphSpec()` redeclares to swap in. `BlockSpec` bare
 * does not fit either: its `render` implementation is contravariant on `this`
 * over the exact prop schema, so a specific paragraph spec is not assignable
 * to the widened generic type. */
type ParagraphSpec = ReturnType<typeof createParagraphBlockSpec>;

/**
 * The blocks a note may hold, in either mode: prose without media, tables or
 * code. Named by what stays so a block BlockNote adds later stays out until
 * chosen. Always a fresh object — `BlockNoteSchema.create().extend()` would
 * write into the module-level defaults shared by every editor on the page.
 */
export const textBlockSpecs = (
  paragraph: ParagraphSpec = createParagraphBlockSpec()
) => ({
  paragraph,
  heading: defaultBlockSpecs.heading,
  bulletListItem: defaultBlockSpecs.bulletListItem,
  numberedListItem: defaultBlockSpecs.numberedListItem,
  checkListItem: defaultBlockSpecs.checkListItem,
  quote: defaultBlockSpecs.quote,
  section: createSectionBlockSpec(),
});
