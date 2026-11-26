"use client";

import { useScrollRestoration } from "@workspace/ui/hooks/use-scroll-restoration";
import { SCROLL } from "@workspace/ui/lib/shell";
import { cn } from "@workspace/ui/lib/utils";
import {
  createContext,
  use,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";

const CanvasRootContext = createContext<
  RefObject<HTMLElement | null> | undefined
>(undefined);

/**
 * Publishes the element a page scrolls in to everything below it, so content
 * can watch itself travel through the page without knowing what shape that
 * page is: an entity page scrolls its canvas, a list page its own column.
 */
export function CanvasRootProvider({
  containerRef,
  children,
}: {
  containerRef: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  return <CanvasRootContext value={containerRef}>{children}</CanvasRootContext>;
}

/** The scroll container the content sits in, or `undefined` where the page
 *  scrolls the document itself and the viewport is the root. */
export const useCanvasRoot = () => use(CanvasRootContext);

/**
 * A page that owns its scroll container rather than scrolling the document:
 * the column's classes on the element that scrolls, and that element as the
 * {@link useCanvasRoot} of everything inside it. An entity page has its own —
 * the canvas its artwork and its arrival hang off — so this is the plain
 * version, for the pages with no entity behind them.
 *
 * The offset travels with the history entry ({@link useScrollRestoration}),
 * since a container the document does not own gets none of the browser's own
 * restoration; `pane` tells the columns apart on a page that shows two.
 */
export function ScrollRoot({
  pane,
  className,
  children,
}: {
  pane?: string;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useScrollRestoration(ref, pane);

  return (
    <CanvasRootProvider containerRef={ref}>
      <div ref={ref} className={cn(SCROLL, className)}>
        {children}
      </div>
    </CanvasRootProvider>
  );
}
