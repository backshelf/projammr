"use client";

import { cn } from "@workspace/ui/lib/utils";
import * as React from "react";

function Table({
  className,
  containerClassName,
  variant = "default",
  ...props
}: React.ComponentProps<"table"> & {
  containerClassName?: string;
  /** `entity` opts into the shared entity-table treatment (`.tablewrap`). */
  variant?: "default" | "entity";
}) {
  const entity = variant === "entity";
  return (
    <div
      data-slot="table-container"
      className={cn(
        entity
          ? cn(entityTable, "relative w-full")
          : "relative w-full overflow-x-auto",
        containerClassName
      )}
    >
      <table
        data-slot="table"
        className={cn(!entity && "w-full caption-bottom text-xs", className)}
        {...props}
      />
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b", className)}
      {...props}
    />
  );
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  );
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  );
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "group/row border-b motion-ink hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted",
        className
      )}
      {...props}
    />
  );
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  );
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-xs text-muted-foreground", className)}
      {...props}
    />
  );
}

/* ---------------------------------------------------------------------------
   Entity-table primitives — the one table treatment shared by tracks,
   collections and sessions. A real table at every width: below the layout
   breakpoint it scrolls horizontally inside the wrapper with the identity
   column pinned, rather than dropping or reflowing columns.
   ------------------------------------------------------------------------- */

/** The cell rules the wrapper imposes on the table inside it. Head cells are
 *  sticky so they survive the vertical scroll, and the hover tint is a flat 4%
 *  ink-over-paper mix — deliberately not artwork-tinted, since a coloured wash
 *  on every hovered row reads as noise. A cell's vertical padding is scaled by
 *  `--density` (`data-density` on `<html>`), so the whole table tightens or
 *  opens up as one. */
const entityTable = cn(
  "overflow-x-auto overscroll-x-contain border-y border-rule",
  "[&_table]:w-full [&_table]:border-collapse [&_table]:text-small [&_table]:whitespace-nowrap",
  "[&_th]:sticky [&_th]:top-0 [&_th]:z-2 [&_th]:border-b [&_th]:border-rule [&_th]:bg-paper",
  "[&_th]:px-3 [&_th]:py-[calc(var(--spacing)*2*var(--density))] [&_th]:text-left [&_th]:font-sub [&_th]:text-micro [&_th]:font-normal",
  "[&_th]:tracking-[0.08em] [&_th]:text-ink-soft [&_th]:uppercase",
  // A head cell that sorts puts its label inside a button, and a button does
  // not keep the head's type: the UA sheet sets `text-transform: none` on form
  // controls, and the button recipe brings its own size and weight. Restating
  // just those three from a descendant selector outranks the button's own
  // utilities whatever order they land in, so a sortable column reads exactly
  // like a plain one. Colour, family and tracking already inherit.
  "[&_th_button]:text-micro [&_th_button]:font-normal [&_th_button]:uppercase",
  "[&_td]:border-b [&_td]:border-rule [&_td]:px-3 [&_td]:py-[calc(var(--spacing)*2*var(--density))] [&_td]:text-ink-soft",
  "[&_tbody_tr:last-child_td]:border-b-0",
  "[&_tbody_tr:hover_td]:bg-[color-mix(in_oklab,var(--ink)_4%,var(--paper))]",
  "[&_tbody_tr:hover_[data-slot=pinned]]:bg-[color-mix(in_oklab,var(--ink)_4%,var(--paper))]",
  "[&_.num]:text-right [&_.num]:tabular-nums"
);

/** Horizontal-scroll wrapper. The table keeps its real columns at every width
 *  and scrolls inside this rather than dropping or reflowing them. */
function TableScroll({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="table-scroll"
      className={cn(entityTable, className)}
      {...props}
    />
  );
}

/** Pinned identity column. It needs an opaque background purely because it
 *  slides under the other cells while the table scrolls sideways. */
const pinned = "sticky left-0 z-1 bg-paper text-ink";

/** For call sites that pin a cell they render themselves. */
const PINNED_CELL = pinned;

function PinnedCell({ className, ...props }: React.ComponentProps<"td">) {
  return <td data-slot="pinned" className={cn(pinned, className)} {...props} />;
}

function PinnedHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="pinned"
      className={cn(pinned, "z-3", className)}
      {...props}
    />
  );
}

/** Artwork thumb + title, for the identity column. Pass the thumbnail URL as
 *  `image`; omit for the neutral placeholder. `wrapThumb` lets an app wrap
 *  the thumb alone — the client names it for the cover-to-masthead view
 *  transition, which the other surfaces that render this table have no component for. */
function TrackCell({
  className,
  image,
  size = "sm",
  wrapThumb,
  children,
  ...props
}: Omit<React.ComponentProps<"div">, "children"> & {
  image?: string | null;
  size?: "sm" | "lg" | "xl";
  wrapThumb?: (thumb: React.ReactElement) => React.ReactNode;
  children: React.ReactNode;
}) {
  const thumb = (
    <span
      aria-hidden
      className={cn(
        "shrink-0 bg-paper-sunk bg-[image:var(--thumb,none)] bg-cover bg-center",
        size === "xl" && "size-11 rounded-sm",
        size === "lg" && "size-8 rounded-sm",
        size === "sm" && "size-7 rounded-[3px]"
      )}
      style={
        image
          ? ({ "--thumb": `url(${image})` } as React.CSSProperties)
          : undefined
      }
    />
  );

  return (
    <div
      data-slot="track-cell"
      className={cn("flex min-w-0 items-center gap-2.5", className)}
      {...props}
    >
      {wrapThumb ? wrapThumb(thumb) : thumb}
      {children}
    </div>
  );
}

/** Hidden until the row is hovered or focused, so a table of twenty tracks is
 *  not twenty icons. Gated to `fine` pointers: a touchscreen has no hover to
 *  reveal the control with, so it stays visible there instead of becoming an
 *  unreachable tap target. Applied to whatever control sits in the row. */
const rowPlay = cn(
  "fine:opacity-0 fine:motion-reveal",
  "data-active:opacity-100 fine:group-focus-within/row:opacity-100 fine:group-hover/row:opacity-100"
);

/** `rowPlay`, but visible at rest instead of hidden until the row is hovered
 *  or focused: `tables.hoverPlay` set to `always`. */
const rowPlayAlways = "opacity-100";

/** Row-level play control. */
function RowPlay({ className, ...props }: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      data-slot="row-play"
      className={cn(rowPlay, className)}
      {...props}
    />
  );
}

/** Inline progress cell: a meter plus a percentage readout. */
function MeterCell({
  value,
  showValue = true,
  className,
  ...props
}: Omit<React.ComponentProps<"div">, "children"> & {
  value: number;
  showValue?: boolean;
}) {
  return (
    <Meter
      data-slot="meter-cell"
      value={value}
      showValue={showValue}
      className={cn("min-w-28", className)}
      {...props}
    />
  );
}

/**
 * Bare progress bar. `value` is 0–100; `fill` overrides the artwork accent
 * the bar is drawn in. `showValue` prints the rounded percentage beside it,
 * so a table cell and a tray row read the figure off the same primitive.
 */
function Meter({
  value,
  fill,
  showValue = false,
  className,
  barClassName,
  ...props
}: Omit<React.ComponentProps<"div">, "children"> & {
  value: number;
  fill?: string;
  showValue?: boolean;
  barClassName?: string;
}) {
  const pct = Math.max(0, Math.min(100, value));
  const bar = (
    <div
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn(
        "h-1 flex-1 overflow-hidden rounded-full",
        "bg-[color-mix(in_oklab,var(--ink)_12%,transparent)]",
        !showValue && className
      )}
      {...props}
    >
      <i
        className={cn(
          "block h-full w-[var(--v,0%)] rounded-[inherit] bg-[var(--meter-fill,var(--art))] motion-settle",
          barClassName
        )}
        style={
          {
            "--v": `${pct}%`,
            ...(fill ? { "--meter-fill": fill } : {}),
          } as React.CSSProperties
        }
      />
    </div>
  );

  if (!showValue) return bar;

  return (
    <div className={cn("flex min-w-0 items-center gap-2", className)}>
      {bar}
      <span className="shrink-0 text-micro text-ink-soft tabular-nums">
        {Math.round(pct)}%
      </span>
    </div>
  );
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
  TableScroll,
  PinnedCell,
  PinnedHead,
  PINNED_CELL,
  TrackCell,
  RowPlay,
  rowPlay,
  rowPlayAlways,
  MeterCell,
  Meter,
};
