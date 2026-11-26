"use client";

import { TableRow } from "@workspace/ui/components/table";
import { m, type MotionProps } from "@workspace/ui/lib/motion";

/**
 * A row's props under Motion: the table row's own, minus the DOM events Motion
 * gives a different meaning to and the table has no use for.
 */
export type MotionTableRowProps = Omit<
  React.ComponentProps<"tr">,
  "onAnimationStart" | "onAnimationEnd" | "onDrag" | "onDragStart" | "onDragEnd"
> &
  Pick<MotionProps, "layout" | "initial" | "animate" | "exit" | "transition">;

const Row = m.create(TableRow);

/**
 * The table's row under Motion's control, so a draft row and the rows it
 * displaces are the same component with the same treatment. A row only takes
 * `layout` while a draft is open beside it: Motion measures a layout-enabled
 * element on every render, and a table nobody is adding to has nothing to
 * settle around.
 */
export function MotionTableRow(props: MotionTableRowProps) {
  return <Row {...props} />;
}
