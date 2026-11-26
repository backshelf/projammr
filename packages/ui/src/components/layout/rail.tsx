import { LABEL } from "@workspace/ui/lib/shell";
import { cn } from "@workspace/ui/lib/utils";
import React from "react";

/**
 * The identity block at the rail's head: the page's artwork sharp and small
 * beside the entity's name and a one-line subtitle. Keeps the subject present
 * once the masthead has scrolled out of view. The thumb reads `--art-image`
 * from the surrounding ArtProvider, so no src is passed here.
 */
export const RailIdentity = ({
  title,
  subtitle,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
}) => (
  <div className={"flex min-h-18 items-center gap-3 pt-2 pb-4.5 stack:hidden"}>
    <div
      className={
        "size-12 shrink-0 rounded-md bg-paper-sunk bg-[image:var(--art-image)] bg-cover bg-center"
      }
      aria-hidden={"true"}
    />

    <span className={"min-w-0"}>
      <span
        className={
          "block truncate font-sub text-small/[1.35] tracking-[0.08em] uppercase"
        }
      >
        {title}
      </span>
      {subtitle != null && (
        <span className={"block truncate text-micro text-ink-soft"}>
          {subtitle}
        </span>
      )}
    </span>
  </div>
);

/**
 * One rail field. Consecutive blocks are divided by a single hairline rather
 * than a stack of Separators, so the rule reads as a seam between groups
 * instead of a slice through equal parts. `rail-seam:` (globals.css) picks
 * out every block that follows another, including across the wrapper
 * RailMore folds the tail into. In the unstuck metadata grid below the layout
 * breakpoint the blocks are cells rather than a stack, so the seam is
 * dropped — it would otherwise draw across the grid.
 */
export const RailBlock = ({
  className,
  grid = false,
  rows = false,
  ...props
}: React.ComponentProps<"div"> & {
  /** Two-up grid for short scalar fields (key/BPM), so they pair off instead
   *  of each taking a full row. */
  grid?: boolean;
  /** A vertical pair of full-width fields — for values too long to share a
   *  column at rail width (created/updated timestamps) but that still read
   *  as one paired block rather than two separate `RailBlock`s. */
  rows?: boolean;
}) => (
  <div
    data-slot="rail-block"
    className={cn(
      // Below the layout breakpoint every block is its own auto-fit column
      // in the unstuck rail grid (`Rail` in RightSideBlur.tsx). A paired
      // block still needs both halves, so it claims the full row there
      // instead of being squeezed into one auto-fit column and splitting
      // that in two again.
      grid && "grid grid-cols-2 gap-x-4 gap-y-3.5 stack:col-span-full",
      rows && "flex flex-col gap-3.5",
      "rail-seam:mt-[1.125rem] rail-seam:border-t rail-seam:border-rule rail-seam:pt-[1.125rem]",
      "stack:rail-seam:mt-0 stack:rail-seam:border-t-0 stack:rail-seam:pt-0",
      className
    )}
    {...props}
  />
);

/** The tracked-caps label above a rail value, with an optional action slot. */
export const RailLabel = ({
  children,
  action,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
}) => (
  <div
    className={cn(
      LABEL,
      "mb-1.5 flex items-center justify-between gap-2 text-ink-soft"
    )}
  >
    <span>{children}</span>
    {action}
  </div>
);
