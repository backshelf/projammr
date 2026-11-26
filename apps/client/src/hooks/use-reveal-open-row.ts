"use client";

import { useReducedMotion } from "@workspace/ui/lib/motion";
import { useEffect, useRef } from "react";

/**
 * Brings a list's open row (the one marked `aria-current="true"` inside the
 * returned ref) into view whenever `open` names a new row and that row sits
 * outside the window: a row opened from elsewhere on the page, such as the
 * inventory web's "Show row", or from a link straight to it. A row opened by
 * clicking it is already in view, and nothing moves.
 */
export function useRevealOpenRow<T extends HTMLElement>(
  open: string | undefined
) {
  const ref = useRef<T>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (open === undefined) return;
    const row = ref.current?.querySelector<HTMLElement>(
      '[aria-current="true"]'
    );
    if (!row) return;
    const { top, bottom } = row.getBoundingClientRect();
    if (top >= 0 && bottom <= window.innerHeight) return;
    row.scrollIntoView({
      block: "center",
      behavior: reducedMotion ? "instant" : "smooth",
    });
  }, [open, reducedMotion]);

  return ref;
}
