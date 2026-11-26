import { cn } from "@workspace/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

/* ---------------------------------------------------------------------------
   Shared status shapes. Status is one of the few places a user picks a colour
   outright, so it is shown at full strength where there is a single one of it
   (rail, masthead) and as a quieter tinted chip in tables, where a column of
   them would otherwise shout.

   The dot on every variant is a conic-gradient pie filled to `percentage`.
   These components own the colour plumbing; the shapes are the variants
   below.
   ------------------------------------------------------------------------- */

/** The pie dot every variant carries, drawn as a ::before conic gradient.
 *  --pct is registered with @property, so the sweep interpolates rather than
 *  jumping between two positions. Exported for a state dot drawn in the same
 *  shape outside a chip (a device's status). */
export const STATUS_PIE =
  "before:content-[''] before:shrink-0 before:rounded-full " +
  "before:bg-[conic-gradient(currentColor_0_calc(var(--pct)*1%),color-mix(in_oklab,currentColor_28%,transparent)_calc(var(--pct)*1%)_100%)] " +
  "before:motion-settle";

/* Changing a status re-renders the element in place rather than replacing it,
   so the move between two states is a transition: the fill travels to the new
   colour while the pie travels to the new position. */
const statusTransition = "motion-settle";

const statusVariants = cva(
  cn(
    "inline-flex max-w-full min-w-0 items-center gap-2 overflow-hidden rounded-full text-small/none whitespace-nowrap",
    "bg-[var(--status,var(--ink-soft))] text-[var(--status-ink,var(--paper))]",
    "py-1.5 pr-3.5 pl-1.75",
    STATUS_PIE,
    "before:size-3.5",
    statusTransition
  ),
  {
    variants: {
      /* Full-width rail variant: the colour reads as a state the entity is in,
         not a tag hung off it. */
      block: {
        true: "flex w-full justify-start rounded-md border-0 px-3.5 py-2.5 text-left text-body",
        false: "",
      },
      /* Marks a flag rather than a pipeline position, so it carries no pie. */
      flag: { true: "pl-3.5 before:hidden", false: "" },
    },
    defaultVariants: { block: false, flag: false },
  }
);

/* The chip's pie is drawn from the status colour rather than currentColor,
   since the chip's text stays ink-coloured against its tint. Naming that
   colour on the pseudo-element lets the gradient interpolate along with the
   chip's own fill — a raw var(--status) is an unregistered property and would
   snap. */
const chipVariants = cva(
  cn(
    "inline-flex max-w-full min-w-0 items-center gap-1.5 overflow-hidden rounded-full text-micro whitespace-nowrap",
    "border px-2 py-1 text-[var(--chip-ink,var(--ink))]",
    "bg-[color-mix(in_oklab,var(--status,var(--ink-soft))_18%,transparent)]",
    "border-[color-mix(in_oklab,var(--status,var(--ink-soft))_35%,transparent)]",
    STATUS_PIE,
    "before:size-2.5 before:text-[var(--status,var(--ink-soft))]",
    "motion-settle"
  ),
  {
    variants: {
      /* No container — just the pie and label, for dense cells. */
      bare: { true: "border-transparent bg-transparent pl-0", false: "" },
      /* Marks a flag rather than a pipeline position, so it carries no pie. */
      flag: { true: "before:hidden", false: "" },
      /* Full-strength fill with contrast-guarded ink, at chip size — for a
         colour that is the chip's whole meaning (a priority) rather than a
         tint over the row. */
      solid: {
        /* The pie draws in the chip's ink rather than the status colour: that
           colour is the fill behind it, which would leave the pie invisible. */
        true: cn(
          "border-transparent bg-[var(--status,var(--ink-soft))] font-medium",
          "before:text-current"
        ),
        false: "",
      },
    },
    defaultVariants: { bare: false, flag: false, solid: false },
  }
);

/**
 * Wraps bare text in a box that can ellipsise. Text sitting directly inside a
 * flex container becomes an anonymous flex item, and `text-overflow` needs an
 * element it can carry `overflow: hidden` on — without one a chip narrower
 * than its label is simply cut off mid-word. A label is text only (`{n} more`
 * is two text nodes, wrapped together); children with any element are left
 * alone: a chip built from a link and a remove button lays those out itself
 * and truncates whichever part should give.
 */
function truncatable(children: React.ReactNode) {
  const isText = (node: React.ReactNode) =>
    typeof node === "string" || typeof node === "number";
  // An array may also hold the `null`/`false` a conditional part leaves behind.
  const text = Array.isArray(children)
    ? children.some(isText) &&
      children.every(
        (node) => isText(node) || node == null || typeof node === "boolean"
      )
    : isText(children);
  return text ? <span className="min-w-0 truncate">{children}</span> : children;
}

type StatusVars = {
  /** The user-picked status colour, any CSS colour. */
  colour: string;
  /** Pipeline position, 0–100. Drives the pie fill. */
  percentage?: number;
};

function statusStyle(
  { colour, percentage }: StatusVars,
  ink?: string
): React.CSSProperties {
  return {
    "--status": colour,
    "--pct": String(Math.max(0, Math.min(100, Math.round(percentage ?? 0)))),
    ...(ink ? { "--status-ink": ink } : {}),
  } as React.CSSProperties;
}

export type StatusChipProps = React.ComponentProps<"span"> &
  StatusVars &
  Omit<VariantProps<typeof chipVariants>, "solid"> &
  (
    | {
        solid: true;
        /** Contrast-guarded text over the full-strength fill; defaults to
         *  the ambient ink. */
        ink?: string;
      }
    | {
        /** A tinted chip's text stays in the ambient ink: ink chosen for the
         *  full-strength colour is unreadable over an 18% tint. */
        solid?: false;
        ink?: never;
      }
  );

/** Tinted status chip (18% fill, 35% border) for use inside tables. */
export function StatusChip({
  colour,
  percentage,
  bare = false,
  flag = false,
  solid = false,
  ink,
  className,
  style,
  children,
  ...props
}: StatusChipProps) {
  return (
    <span
      data-slot="status-chip"
      className={cn(chipVariants({ bare, flag, solid }), className)}
      style={{
        ...statusStyle({ colour, percentage }),
        ...(solid && ink ? { "--chip-ink": ink } : {}),
        ...style,
      }}
      {...props}
    >
      {truncatable(children)}
    </span>
  );
}

export type StatusPillProps = React.ComponentProps<"span"> &
  StatusVars &
  VariantProps<typeof statusVariants> & {
    /** Contrast-guarded readable colour for the label against `colour`. */
    ink?: string;
  };

/** Solid-fill status pill (full user colour) for rails and mastheads. */
export function StatusPill({
  colour,
  percentage,
  ink,
  block = false,
  flag = false,
  className,
  style,
  children,
  ...props
}: StatusPillProps) {
  return (
    <span
      data-slot="status-pill"
      className={cn(statusVariants({ block, flag }), className)}
      style={{ ...statusStyle({ colour, percentage }, ink), ...style }}
      {...props}
    >
      {truncatable(children)}
    </span>
  );
}

export { statusVariants, chipVariants };
