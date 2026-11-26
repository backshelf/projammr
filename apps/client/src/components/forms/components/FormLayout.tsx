import { cn } from "@workspace/ui/lib/utils";
import type { ComponentProps, ElementType } from "react";

/**
 * A form is a sequence of decisions, so it is set as a list of rows with a
 * hairline between them rather than a stack of bordered cards: the rule marks
 * where one decision ends, and nothing competes with the control itself.
 */
export function FormLayout({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex flex-col", className)} {...props} />;
}

/**
 * One decision. The rule sits between rows, never above the first or below the
 * last, so a form never opens or closes on a line. `pair` puts two short scalar
 * fields on one row, matching the rail's two-up grid.
 */
export function FormRow<T extends ElementType = "div">({
  as,
  pair = false,
  className,
  ...props
}: { as?: T; pair?: boolean } & ComponentProps<"div">) {
  const Comp = (as ?? "div") as ElementType;
  return (
    <Comp
      className={cn(
        "py-5 [&+&]:border-t [&+&]:border-rule",
        pair
          ? "grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] items-start gap-x-6 gap-y-4"
          : "flex flex-col gap-2",
        className
      )}
      {...props}
    />
  );
}

/** Two short scalar fields sharing a row, outside a form row's own flow. */
export function FormPair({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] items-start gap-x-6 gap-y-4",
        className
      )}
      {...props}
    />
  );
}

/** The actions sit on a rule that reads as the form's own floor. */
export function FormFoot({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "mt-2 flex justify-end gap-2 border-t border-rule-strong pt-5",
        "phone:flex-col-reverse phone:[&>*]:w-full",
        className
      )}
      {...props}
    />
  );
}
