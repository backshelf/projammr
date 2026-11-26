"use client";

import { useArrivalKind } from "@workspace/ui/components/motion/arrival";
import { animate, FADE, m, useMotionValue } from "@workspace/ui/lib/motion";
import { useEffect, type ReactNode } from "react";

/**
 * Content that may arrive after the page around it: streamed behind a
 * skeleton, refetched, or a lazy chunk landing. Mounted after hydration it
 * fades up in the place its skeleton held; part of the first paint it renders
 * exactly as it was served, with no inline state of its own.
 *
 * The fade runs on a motion value rather than `initial`/`animate` because an
 * `AnimatePresence initial={false}` above — every collapsible section and
 * revealed section has one — makes Motion render a descendant's `animate`
 * state instead of its `initial`, so a prop-driven fade would never play
 * there. A motion value is not subject to presence.
 *
 * The skeleton it replaces needs no exit: React swaps the fallback out in the
 * commit the content mounts in, and this fade covers the swap.
 */
export function Arrive({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  // The page's arrival kind is the same fact under another name: "nav" is a
  // mount whose first render came after hydration, which is exactly the
  // content that was not part of the paint it is arriving over.
  const late = useArrivalKind() === "nav";
  const opacity = useMotionValue(late ? 0 : 1);

  useEffect(() => {
    if (!late) return;
    const fade = animate(opacity, 1, FADE.move);
    return () => fade.stop();
  }, [late, opacity]);

  return (
    <m.div className={className} style={late ? { opacity } : undefined}>
      {children}
    </m.div>
  );
}
