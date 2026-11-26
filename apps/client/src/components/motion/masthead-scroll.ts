import { useArrivalSettled } from "@workspace/ui/components/motion/arrival";
import { useIsMobile } from "@workspace/ui/hooks/use-mobile";
import {
  useMotionValue,
  useReducedMotion,
  useTransform,
  type MotionStyle,
} from "@workspace/ui/lib/motion";

import { useCanvasScroll } from "@/components/motion/canvas-scroll";

/** A pair a part travels between: its resting value first, its receded value
 *  second. */
export type Recession = readonly [rest: number, receded: number];

/** One masthead part's recession: how far the canvas scrolls before the part
 *  has fully receded, and the values it travels over that distance. Only
 *  light and transform recede — the art's blur is never scrolled. */
export type MastheadRecession = {
  end: number;
  opacity: Recession;
  scale?: Recession;
  y?: Recession;
};

/** How far the canvas scrolls, in px, before each masthead part has fully
 *  receded. The art travels the longest; the crumbs are gone first. */
export const MASTHEAD_SCROLL = {
  art: { end: 560, opacity: [1, 0.35], scale: [1.15, 1.08], y: [0, -48] },
  scrim: { end: 560, opacity: [1, 0.6] },
  crumbs: { end: 160, opacity: [1, 0], y: [0, -8] },
  head: { end: 320, opacity: [1, 0], y: [0, -24] },
} as const satisfies Record<string, MastheadRecession>;

/** A part of the masthead that recedes as the canvas scrolls. */
export type MastheadPart = keyof typeof MASTHEAD_SCROLL;

/** The same ranges on a phone, where the masthead is shorter. */
export const MASTHEAD_SCROLL_PHONE = {
  art: { end: 320, opacity: [1, 0.35], scale: [1.15, 1.08], y: [0, -32] },
  scrim: { end: 320, opacity: [1, 0.6] },
  crumbs: { end: 96, opacity: [1, 0], y: [0, -6] },
  head: { end: 200, opacity: [1, 0], y: [0, -16] },
} as const satisfies Record<MastheadPart, MastheadRecession>;

/** The table the masthead recedes by at this width. */
export function mastheadScroll(
  phone: boolean
): Record<MastheadPart, MastheadRecession> {
  return phone ? MASTHEAD_SCROLL_PHONE : MASTHEAD_SCROLL;
}

/** Linear interpolation clamped to the range; what `useTransform` does, kept
 *  here so the mapping can be asserted without a DOM. */
export function scrolled(
  offset: number,
  end: number,
  [rest, receded]: Recession
): number {
  const travelled = Math.min(1, Math.max(0, offset / end));
  return rest + (receded - rest) * travelled;
}

/** A range as `useTransform` wants it. A part that does not travel a given
 *  way, and one whose travel reduced motion drops, holds its resting value
 *  for the whole range instead. */
function range(recession: Recession | undefined, held: boolean): number[] {
  if (!recession) return [0, 0];
  return held ? [recession[0], recession[0]] : [recession[0], recession[1]];
}

/**
 * Whether a part's scroll-linked style may take over the properties the
 * page's entrance animates. The entrance owns them until it settles, except
 * on a page restored to an offset it was left at: there the masthead is
 * already receded on the first frame, and waiting for the entrance would
 * paint it at rest and snap it back.
 */
export function bindsScroll(settled: boolean, offset: number): boolean {
  return settled || offset !== 0;
}

/**
 * The scroll-linked style for one masthead part: motion values that push it
 * back into the wall as the canvas scrolls, or `undefined` while the page's
 * entrance still owns the same properties. A scroll writes nothing but
 * `opacity` and `transform`, and never re-renders React.
 *
 * At a resting scroll offset every value is the part's rest, so binding these
 * the moment the entrance settles is invisible. Under reduced motion only the
 * light recedes; the scale and the travel hold still.
 */
export function useMastheadScroll(part: MastheadPart): MotionStyle | undefined {
  const scrollY = useCanvasScroll();
  const unscrolled = useMotionValue(0);
  const settled = useArrivalSettled();
  const reduced = useReducedMotion() ?? false;
  const recession = mastheadScroll(useIsMobile())[part];

  const offset = scrollY ?? unscrolled;
  const span = [0, recession.end];
  const opacity = useTransform(offset, span, range(recession.opacity, false));
  const scale = useTransform(offset, span, range(recession.scale, reduced));
  const y = useTransform(offset, span, range(recession.y, reduced));

  if (!bindsScroll(settled, offset.get())) return undefined;

  return {
    opacity,
    ...(recession.scale && { scale }),
    ...(recession.y && { y }),
  };
}
