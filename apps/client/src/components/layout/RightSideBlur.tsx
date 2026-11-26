"use client";

import { RailMorph } from "@/components/motion/ArtMorph";
import { RailMore } from "@workspace/ui/components/layout/rail-more";
import { useArrival } from "@workspace/ui/components/motion/arrival";
import { m } from "@workspace/ui/lib/motion";
import { cn } from "@workspace/ui/lib/utils";
import type { PropsWithChildren, ReactNode } from "react";

/**
 * The grid track the rail lives in. It spans the whole page height because the
 * canvas grid sizes its rows to content, which is what gives {@link Rail} a
 * column long enough to travel while sticky.
 *
 * Kept separate from {@link Rail}: carrying the glass and the sticky
 * positioning on one element makes the panel stop wherever its content happens
 * to end, which cuts the content off at the top and stops the blur short of
 * the page height. The z-index scopes the rail above the masthead artwork
 * blurring behind its edge.
 */
function RailColumn({ children }: PropsWithChildren) {
  return (
    <div id={"rightside"} className={"relative z-3 [grid-area:rail]"}>
      {children}
    </div>
  );
}

/**
 * The sticky glass panel inside {@link RailColumn}. It clears the app chrome
 * above the canvas (`--menubar`) so the identity block at its head is never
 * clipped, and scrolls internally when it outgrows the viewport.
 */
function Rail({ children, more }: RailProps) {
  return (
    <RailMorph>
      <m.div
        {...useArrival("rail")}
        className={cn(
          // `rail` is the hook globals.css keys the status pie fill on, which
          // runs only inside it. The blocks space themselves with the hairline
          // rule that divides them, so the column itself adds no gap.
          "rail sticky top-0 flex h-[calc(100dvh-var(--menubar,0px))] flex-col gap-0 overflow-y-auto",
          "border-l border-glass-edge bg-glass p-5 pb-12 backdrop-blur-[20px] backdrop-saturate-[1.2]",
          // Below the layout breakpoint it unsticks into a metadata grid under
          // the content, and the glass drops for a flat surface.
          "stack:static stack:h-auto stack:max-h-none stack:overflow-visible",
          "stack:grid stack:grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] stack:items-start",
          "stack:gap-x-6 stack:gap-y-5 stack:px-(--gutter) stack:py-5",
          "stack:border-t stack:border-l-0 stack:border-rule",
          "stack:bg-paper-sunk stack:backdrop-filter-none"
        )}
      >
        {more == null ? children : <RailMore more={more}>{children}</RailMore>}
      </m.div>
    </RailMorph>
  );
}

type RailProps = {
  children: ReactNode;
  /** Blocks folded behind a "More details" toggle on a phone, where the rail
   *  sits between the title and the content. They follow `children`. */
  more?: ReactNode;
};

/**
 * The page rail: a glass column with sticky content inside it. Callers pass the
 * rail's blocks as children.
 */
export default function RightSideBlur({ children, more }: RailProps) {
  return (
    <RailColumn>
      <Rail more={more}>{children}</Rail>
    </RailColumn>
  );
}
