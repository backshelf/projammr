import { cn } from "@workspace/ui/lib/utils";
import type { ComponentPropsWithoutRef, ElementType } from "react";

/** Props of whatever element `as` names, plus `as` itself. */
type PolymorphicProps<T extends ElementType> = { as?: T } & Omit<
  ComponentPropsWithoutRef<T>,
  "as"
>;

/**
 * A list of hairline-divided rows — links, statuses, and anywhere a table's
 * columns would be more structure than the content earns.
 */
export function Rows<T extends ElementType = "div">({
  as,
  className,
  ...props
}: PolymorphicProps<T>) {
  const Comp = (as ?? "div") as ElementType;
  return <Comp className={cn("flex flex-col", className)} {...props} />;
}

/** One row. `as` lets it be an anchor or a list item without losing the shape.
 *  Its vertical padding is scaled by `--density`, as a table cell's is. */
export function Row<T extends ElementType = "div">({
  as,
  className,
  ...props
}: PolymorphicProps<T>) {
  const Comp = (as ?? "div") as ElementType;
  return (
    <Comp
      className={cn(
        "group/row flex items-center gap-3.5 border-t border-rule px-2 py-[calc(var(--spacing)*2.5*var(--density))]",
        "motion-ink",
        "hover:bg-[color-mix(in_oklab,var(--ink)_4%,transparent)]",
        className
      )}
      {...props}
    />
  );
}

/* Spans inside an anchor collapse to inline unless forced to block, which
   silently breaks ellipsis truncation and the flex layout around them. */
export function RowMain({
  className,
  ...props
}: ComponentPropsWithoutRef<"span">) {
  return <span className={cn("min-w-0 flex-1", className)} {...props} />;
}

export function RowTitle({
  className,
  ...props
}: ComponentPropsWithoutRef<"span">) {
  return (
    <span
      className={cn("block min-w-0 truncate text-body text-ink", className)}
      {...props}
    />
  );
}

export function RowMeta({
  className,
  ...props
}: ComponentPropsWithoutRef<"span">) {
  return (
    <span
      className={cn(
        "block min-w-0 truncate text-micro text-ink-soft",
        className
      )}
      {...props}
    />
  );
}

export function RowNum({
  className,
  ...props
}: ComponentPropsWithoutRef<"span">) {
  return (
    <span
      className={cn(
        "w-6 shrink-0 text-right text-micro text-ink-soft tabular-nums",
        className
      )}
      {...props}
    />
  );
}
