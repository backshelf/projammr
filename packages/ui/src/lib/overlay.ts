import {
  FADE,
  LEAVE,
  SPRING,
  SURFACE,
  type Variants,
} from "@workspace/ui/lib/motion";
import { cn } from "@workspace/ui/lib/utils";
import type { ReactElement, ReactNode } from "react";

/**
 * The shared treatment for anything lifted off the page — dialogs, dropdowns,
 * popovers. An overlay carries the paper colour at full strength (never glass,
 * which would let the artwork wash confuse its edge) and a single hairline,
 * with the lift coming from the scrim behind it rather than a shadow.
 */
export const OVERLAY_SURFACE = cn(
  "rounded-(--radius) border border-rule-strong bg-paper shadow-overlay"
);

/**
 * Overlay heads use the same tracked-caps subhead as a section: at this size
 * the display face's halftone reads as noise, and a dialog title is doing a
 * label's job — naming what the surface is for.
 */
export const OVERLAY_TITLE =
  "font-sub text-small tracking-[0.12em] uppercase text-ink";

export const OVERLAY_DESC = "max-w-[52ch] text-small text-ink-soft";

/** A menu's own group heading. Quieter than an overlay title, because it
 *  divides a list rather than naming the surface. */
export const MENU_LABEL =
  "font-sub text-micro tracking-[0.1em] uppercase text-ink-faint";

/**
 * The modal scrim. Unselectable so a long press on it cannot start a
 * selection in the page behind. The blur is static: animating a full-screen
 * blur costs a repaint per frame, so only the scrim's opacity moves.
 */
export const BACKDROP =
  "fixed inset-0 isolate z-50 bg-[oklch(0.09_0_0/55%)] select-none [-webkit-touch-callout:none] supports-backdrop-filter:backdrop-blur-sm dark:bg-[oklch(0_0_0/70%)]";

/**
 * A centred modal panel. The centring is the CSS `translate` property, which
 * composes with the `transform` Motion writes for an entrance's `scale` or
 * `y`, so the two never overwrite each other.
 *
 * The surface is a single column that content cannot widen: an auto grid track
 * takes its minimum from what sits in it, so one row of nowrap text — a
 * truncated title in a picker — would push the whole dialog out past its own
 * box. `minmax(0, 1fr)` drops that minimum, leaving the row to truncate.
 */
export const POPUP =
  "fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 grid-cols-[minmax(0,1fr)] gap-4 p-5 text-sm text-popover-foreground outline-none sm:max-w-md";

/**
 * How a modal panel arrives. `pop` comes into focus where it rests; `sheet`
 * rises from below, for a panel that covers a phone screen and has no centre
 * to grow from.
 */
export const ENTRANCE: Record<"pop" | "sheet", Variants> = {
  pop: SURFACE,
  sheet: {
    hidden: { opacity: 0, y: 24 },
    shown: {
      opacity: 1,
      y: 0,
      transition: { opacity: FADE.move, y: SPRING.surface },
    },
    leaving: { opacity: 0, y: 12, transition: LEAVE.move },
  },
};

export type Entrance = keyof typeof ENTRANCE;

/**
 * Base UI composes through `render`; the components here also accept
 * `asChild`, which hands the single child element to `render` and drops the
 * wrapper's own element. A caller passing both gets `render`.
 */
export function composeRender<
  P extends { render?: unknown; children?: ReactNode },
>(props: P & { asChild?: boolean }): Omit<P, "asChild"> {
  const { asChild, ...rest } = props;
  if (!asChild || rest.render !== undefined) return rest;
  return {
    ...rest,
    children: undefined,
    render: rest.children as ReactElement,
  };
}
