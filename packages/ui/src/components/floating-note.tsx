"use client";

import { FADE, LEAVE, m } from "@workspace/ui/lib/motion";
import { cn } from "@workspace/ui/lib/utils";
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

const GAP = 8;

export type FloatingNotePlacement = "beside" | "above";

export type FloatingNoteProps = {
  /** The element the note is placed against. Renders nothing without one. */
  anchor: HTMLElement | null;
  /** `"beside"` prefers the anchor's right, falling back to its left.
   *  `"above"` centres over the anchor, falling below when there is no room. */
  placement: FloatingNotePlacement;
  children: ReactNode;
  className?: string;
};

/**
 * The portalled glass note: a small surface placed in viewport coordinates
 * beside or above whatever anchor is passed to it, used for a status
 * description and for a comment pin's author and excerpt. Portalled to the
 * body rather than living inside its trigger, since the trigger is often a
 * clipping, transformed container (a scrollable menu, a positioned wave) that
 * would both clip the note and become its containing block.
 */
export function FloatingNote({
  anchor,
  placement,
  children,
  className,
}: FloatingNoteProps) {
  const ref = useRef<HTMLDivElement>(null);

  // The measured position is written straight onto the element before paint
  // rather than through state: it depends only on the DOM, so a second render
  // to carry it would redraw the same markup.
  useLayoutEffect(() => {
    const note = ref.current;
    if (!note || !anchor) return;

    const rect = anchor.getBoundingClientRect();
    const { offsetWidth: width, offsetHeight: height } = note;

    const { left, top } =
      placement === "above"
        ? placeAbove(rect, width, height)
        : placeBeside(rect, width, height);

    note.style.left = `${left}px`;
    note.style.top = `${top}px`;
    note.style.visibility = "visible";
  }, [anchor, placement, children]);

  if (!anchor) return null;

  return createPortal(
    <m.div
      ref={ref}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: FADE.quick }}
      exit={{ opacity: 0, transition: LEAVE.quick }}
      className={cn(
        // Placed by measuring the anchor's rect, which only works where a
        // pointer can hover to trigger it in the first place; a touchscreen
        // has no hover, so the note never mounts there. `fixed` because the
        // measured `left`/`top` are viewport coordinates.
        "pointer-events-none fixed z-60 rounded-md border border-glass-edge bg-glass coarse:hidden",
        "shadow-menu backdrop-blur-[20px] backdrop-saturate-[1.2]",
        className
      )}
      // Hidden until the layout effect has measured and placed it, so it
      // never flashes at the top-left corner on the first frame.
      style={{ visibility: "hidden" }}
      role="presentation"
    >
      {children}
    </m.div>,
    document.body
  );
}

/** Beside the anchor, taking whichever side has room; a menu is usually
 *  pinned to the right-hand rail, so the right side is tried first. */
function placeBeside(rect: DOMRect, width: number, height: number) {
  const fitsRight = rect.right + GAP + width <= window.innerWidth;
  const fitsLeft = rect.left - GAP - width >= 0;
  const onRight = fitsRight || !fitsLeft;

  const left = onRight ? rect.right + GAP : rect.left - GAP - width;
  // Aligned to the anchor's top, then pulled back up if that would run the
  // note past the bottom of the window.
  const top = Math.max(
    GAP,
    Math.min(rect.top, window.innerHeight - height - GAP)
  );
  return { left, top };
}

/** Centred over the anchor, clamped inside the viewport; falls below the
 *  anchor when there is no room above (a pin near the top of a phone page). */
function placeAbove(rect: DOMRect, width: number, height: number) {
  const left = Math.max(
    GAP,
    Math.min(
      rect.left + rect.width / 2 - width / 2,
      window.innerWidth - width - GAP
    )
  );
  const above = rect.top - GAP - height;
  const top = above >= GAP ? above : rect.bottom + GAP;
  return { left, top };
}
