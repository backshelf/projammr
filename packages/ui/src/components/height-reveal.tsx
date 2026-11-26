"use client";

import { useReducedMotion } from "@workspace/ui/lib/motion";
import { cn } from "@workspace/ui/lib/utils";
import { type ReactNode, type TransitionEvent, useState } from "react";

/**
 * A panel that opens in height instead of appearing: a one-row grid whose
 * track eases between `0fr` and `1fr` on `motion-settle`, so whatever sits
 * below glides down rather than jumping. Closed, the panel is `inert`, so
 * nothing inside it takes focus or a pointer.
 *
 * Children mount when the panel opens and unmount once it has finished
 * closing, so a closed panel holding a live meter costs nothing. Under
 * reduced motion the track has no transition to wait for, so they unmount
 * straight away.
 */
export function HeightReveal({
  open,
  className,
  children,
}: {
  open: boolean;
  className?: string;
  children: ReactNode;
}) {
  const reduced = useReducedMotion();
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);
  if (!open && mounted && reduced) setMounted(false);

  // The track and the fade share one duration, so whichever of the panel's
  // own transitions ends first marks it closed; one ending on a child does not.
  const settle = (event: TransitionEvent<HTMLDivElement>) => {
    if (!open && event.target === event.currentTarget) setMounted(false);
  };

  return (
    <div
      data-slot="height-reveal"
      data-open={open ? "" : undefined}
      inert={!open}
      onTransitionEnd={settle}
      className={cn(
        "grid grid-rows-[0fr] opacity-0 motion-settle",
        "data-open:grid-rows-[1fr] data-open:opacity-100",
        className
      )}
    >
      <div className="min-h-0 overflow-hidden">{mounted && children}</div>
    </div>
  );
}
