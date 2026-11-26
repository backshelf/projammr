"use client";

import { FADE, m, useReducedMotion } from "@workspace/ui/lib/motion";
import { cn } from "@workspace/ui/lib/utils";

/**
 * Tabler's check, drawn as a path so its stroke runs as it arrives: the mark
 * of something the server has just confirmed. Whole at once under reduced
 * motion. Decorative; the words beside it say what happened.
 */
export function DrawnCheck({ className }: { className?: string }) {
  const reduced = useReducedMotion();

  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className={cn("size-3", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <m.path
        d="M5 12l5 5l10 -10"
        initial={{ pathLength: reduced ? 1 : 0 }}
        animate={{ pathLength: 1, transition: FADE.move }}
      />
    </svg>
  );
}
