/**
 * The page frame every app shares: a centred, capped content column and the
 * tracked-caps label shapes that recur across mastheads, sections, forms and
 * the rail.
 *
 * These are class strings rather than components because the elements that
 * carry them are otherwise unrelated — a header, a grid child, a label — and
 * only the measure and the type treatment are shared.
 */

/** Content column: centred and capped, so wide screens frame the page with
 *  margin rather than anchoring everything to the left edge. */
export const COLUMN = "mx-auto w-full max-w-(--column)";

/** The tracked-caps label shape every small label in the app is built from:
 *  the label face at the smallest step, tracked and set in caps. Callers add
 *  their own spacing and layout. */
export const LABEL = "font-sub text-micro tracking-[0.1em] uppercase";

/** The label above a value or a section. */
export const EYEBROW = `mb-2 ${LABEL} text-ink-soft`;

/** The sidebar's own eyebrow — the project switcher and the account row are
 *  its two anchors, and this says which one you are looking at. */
export const SIDEBAR_EYEBROW = `${LABEL} text-ink-soft`;

/** The same label at section scale, a touch wider-tracked. Section heads and
 *  the collapsible sections that stand in for them share it. */
export const SECTION_TITLE =
  "font-sub text-small/[1.15] tracking-[0.12em] uppercase text-ink-soft";

/** The section title a page leads with — what the page exists for (listening
 *  and feedback) rather than its paperwork: a step up the scale, in full ink. */
export const SECTION_TITLE_PRIMARY =
  "font-sub text-body/[1.15] tracking-[0.12em] uppercase text-ink";

/**
 * The row a section's title sits on, and the section rhythm: the space above
 * every head is the page's flex gap, and the space below is this margin — a
 * good deal less, so each head binds to the content it names rather than
 * floating between two sections.
 */
export const SECTION_HEAD = "mb-3.5 flex items-baseline justify-between gap-4";

/** Every direct child of a content column is itself centred and capped, so a
 *  section spans the measure rather than the full width of the viewport. */
export const CAPPED_CHILDREN =
  "[&>*]:mx-auto [&>*]:w-full [&>*]:max-w-(--column)";

/** A plain page — settings, list pages, profile. No entity behind it, so no
 *  artwork and no rail; the column is the whole page. The bottom pad is the
 *  height of whatever chrome is docked to the bottom edge (`--dock`, zero
 *  above the phone tier), so the last row of a page always clears it. */
export const PAGE = [
  "relative flex min-w-0 flex-col gap-11 px-(--gutter) pb-(--dock)",
  CAPPED_CHILDREN,
].join(" ");

/** Wide tools — the list pages' tables, the settings panes — need the room
 *  their columns ask for, so they opt out of the reading measure. */
export const PAGE_WIDE = [
  "relative flex min-w-0 flex-col gap-11 px-(--gutter) pb-(--dock)",
  "[&>*]:mx-auto [&>*]:w-full [&>*]:max-w-none",
].join(" ");

/** The scroll contract for a page wrapper that owns its own scroll container
 *  (as opposed to scrolling the document): fills its flex parent, scrolls
 *  vertically, and contains overscroll so a rubber-banding page doesn't drag
 *  the surface behind it along too. `scroll-pb-(--dock)` keeps the browser's
 *  own caret reveal and Next's `#id` `scrollIntoView` clear of the dock,
 *  rather than landing a focused field underneath it. */
export const SCROLL =
  "h-full overflow-y-auto overscroll-y-contain scroll-pb-(--dock)";

/** A hover-revealed affordance, gated to pointers that can actually hover:
 *  on a touchscreen the control stays visible instead of hiding behind an
 *  interaction the device has no way to trigger. Callers still need their
 *  own `group`/`group-focus-within` wiring; this only supplies the
 *  opacity/transition classes. */
export const REVEAL_ON_HOVER =
  "fine:opacity-0 fine:motion-reveal fine:group-hover:opacity-100 fine:group-focus-within:opacity-100";
