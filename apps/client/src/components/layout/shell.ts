/**
 * The parts of the page frame that only an entity page can carry: the scroll
 * container that holds the rail, the content column inside it, and the split
 * row that puts notes beside artwork. The measure and the label shapes they
 * build on live in `@workspace/ui/lib/shell`.
 */

import { CAPPED_CHILDREN } from "@workspace/ui/lib/shell";

/**
 * The scroll container and the row that frames content beside the rail. It
 * also clips the masthead's blur so it never bleeds sideways into the app
 * chrome.
 *
 * Grid, not flex, and deliberately so: this element scrolls, so its own box is
 * one viewport tall while its content is much longer. Flex stretches children
 * to the container box, which leaves the rail column one viewport tall and
 * scrolling away with the content. Grid rows size to the content, so the rail
 * column spans the whole scroll length and its sticky child can travel it.
 *
 * Scrolling past either end stops here rather than chaining to the document,
 * which on a phone is the difference between hitting the end of a page and
 * dragging the whole app off its address bar.
 */
export const CANVAS = [
  "relative isolate grid min-w-0 items-stretch overflow-x-clip overscroll-y-contain pb-(--dock) scroll-pb-(--dock)",
  // `max-content`, not `auto`: this element's own height is definite (one
  // viewport), so once the body outgrows it there is no free space left and an
  // `auto` row stops at the masthead's `min-height`, letting a tall masthead
  // (a track's audio strips) spill over the first section.
  "grid-cols-[minmax(0,1fr)_var(--rail)] grid-rows-[max-content_1fr]",
  "[grid-template-areas:'head_rail'_'body_rail']",
  // Below the layout breakpoint the rail leaves its column and sits between
  // the title and the content, where the status and the property editors are
  // in reach instead of buried under the tables and the comments.
  "stack:grid-cols-[minmax(0,1fr)] stack:grid-rows-none",
  "stack:[grid-template-areas:'head'_'rail'_'body']",
].join(" ");

/** The masthead's cell in {@link CANVAS}. */
export const MASTHEAD_AREA = "[grid-area:head] relative z-0 min-w-0";

/** The content column inside {@link CANVAS}. It closes on the same space that
 *  separates its sections, so the last one (often the add line) never sits on
 *  the bottom edge; the canvas adds `--dock` beneath that. */
export const BODY = [
  "[grid-area:body] relative z-1 flex min-w-0 flex-col gap-11 px-(--gutter) pb-11",
  "phone:gap-8 phone:pb-8",
  // Below the layout breakpoint the metadata band sits directly above on its
  // own sunk surface, so the column opens clear of that edge rather than
  // letting its first section head sit against it.
  "stack:mt-8",
  CAPPED_CHILDREN,
].join(" ");

/** Split section: notes and artwork share a row. The note column takes the
 *  space it needs and the cover sits beside it rather than being pushed below,
 *  until the viewport is too narrow to hold both.
 *
 *  A column whose section has folded into the add line holds only that
 *  section's hidden anchor, so it gives up its cell: the cover keeps its own
 *  width at the start of the row when the notes fold, and the row leaves the
 *  page's rhythm entirely when both do. */
export const SPLIT = [
  "grid grid-cols-[minmax(0,1fr)_14rem] items-start gap-8",
  "stack:grid-cols-[minmax(0,1fr)]",
  "[&>*:has(>[data-slot=folded-section]:only-child)]:hidden",
  "has-[>:first-child>[data-slot=folded-section]:only-child]:grid-cols-[14rem]",
  "not-has-[>*>:not([data-slot=folded-section])]:hidden",
].join(" ");
