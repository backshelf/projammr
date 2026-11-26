"use client";

import { useCanvasRoot } from "@workspace/ui/components/layout/scroll-root";
import { useScroll, type MotionValue } from "@workspace/ui/lib/motion";
import { createContext, use, type ReactNode } from "react";

const CanvasScrollContext = createContext<MotionValue<number> | null>(null);

/**
 * Publishes the canvas's scroll offset to the page inside it. The window
 * never scrolls — the entity page's canvas is the scroll container — so
 * anything scroll-linked reads this rather than the viewport. The canvas is
 * whatever the enclosing `CanvasRootProvider` names, so the page hands its
 * ref over once.
 *
 * The offset is a motion value, so a scroll updates the elements bound to it
 * without a React render.
 */
export function CanvasScrollProvider({ children }: { children: ReactNode }) {
  const { scrollY } = useScroll({ container: useCanvasRoot() });

  return <CanvasScrollContext value={scrollY}>{children}</CanvasScrollContext>;
}

/** The canvas's scroll offset in px, or null outside a canvas — a page whose
 *  content scrolls with the window. */
export const useCanvasScroll = (): MotionValue<number> | null =>
  use(CanvasScrollContext);
