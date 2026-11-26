"use client";

import { useCanvasRoot } from "@workspace/ui/components/layout/scroll-root";
import {
  animate,
  FADE,
  inView,
  m,
  SPRING,
  useMotionValue,
  useReducedMotion,
} from "@workspace/ui/lib/motion";
import { useEffect, useRef, type ReactNode } from "react";

/** How far a section that is waiting sits below where it comes to rest. */
const RISE = 12;

/** How much of the section has to be in the canvas before it arrives, and how
 *  far short of the bottom edge that counts: it arrives as the reader reaches
 *  it, not the moment its first pixel clears the fold. */
const REACHED = { amount: 0.15, margin: "0px 0px -10% 0px" } as const;

/**
 * A section that arrives as the reader reaches it. A section inside the
 * page's scroll container when it mounts is left at rest — the page's own
 * entrance covers that moment — and only one below the fold goes quiet and
 * waits for the eye, carrying `data-arrival` while it does.
 *
 * The measurement runs once, as the section mounts. A section it finds below
 * the fold is off-screen, so it can go quiet with nobody watching it happen;
 * one the reader can already see is never touched at all.
 */
export function SectionArrival({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const root = useCanvasRoot();
  const opacity = useMotionValue(1);
  const y = useMotionValue(0);
  /** Reduced motion arrives on light alone: the section holds its place. */
  const rise = useReducedMotion() ? 0 : RISE;

  useEffect(() => {
    const section = ref.current;
    const canvas = root?.current;
    if (!section || !canvas) return;
    if (
      section.getBoundingClientRect().top <=
      canvas.getBoundingClientRect().bottom
    ) {
      return;
    }

    opacity.set(0);
    y.set(rise);
    section.dataset.arrival = "waiting";

    // The observer stops watching a section it has reported, so the arrival
    // runs once: a section the reader scrolls back past stays as it is.
    return inView(
      section,
      () => {
        delete section.dataset.arrival;
        animate(opacity, 1, FADE.move);
        animate(y, 0, SPRING.surface);
      },
      { root: canvas, ...REACHED }
    );
  }, [root, opacity, y, rise]);

  return (
    <m.section ref={ref} className={className} style={{ opacity, y }}>
      {children}
    </m.section>
  );
}
