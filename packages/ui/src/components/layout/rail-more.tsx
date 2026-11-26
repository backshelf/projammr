"use client";

import { LABEL } from "@workspace/ui/lib/shell";
import { cn } from "@workspace/ui/lib/utils";
import React from "react";

/**
 * Keeps the tail of the rail folded away on a phone. Below the layout
 * breakpoint the rail sits between the title and the content, so the blocks
 * every page leads with — status and priority — are worth the space and the
 * long tail of property editors is not; the toggle hands that tail back on
 * demand. From `md:` up the rail is the sticky column again, where there is
 * room for everything: the button is hidden and the group dissolves into the
 * grid with `contents`. The toggle sits after the group rather than before
 * it, so the group is the last shown block's next sibling and the seam rule
 * in `RailBlock` can find its first block.
 *
 * The fold is the `hidden` utility rather than the `hidden` attribute —
 * preflight styles `[hidden]` with `display: none !important`, which no
 * utility can override, so `md:contents` would lose at every width.
 */
export const RailMore = ({
  children,
  more,
}: {
  /** The leading blocks, always shown. */
  children: React.ReactNode;
  /** The tail that folds away on a phone. */
  more: React.ReactNode;
}) => {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      {children}
      <div
        className={cn(
          "col-span-full grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))]",
          "items-start gap-x-6 gap-y-5",
          !open && "hidden",
          "md:contents"
        )}
      >
        {more}
      </div>
      <button
        type={"button"}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        aria-expanded={open}
        className={cn(
          LABEL,
          "col-span-full justify-self-start py-2 text-ink-soft md:hidden"
        )}
      >
        {open ? "Fewer details" : "More details"}
      </button>
    </>
  );
};
