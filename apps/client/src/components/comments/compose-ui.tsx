import { cn } from "@workspace/ui/lib/utils";
import type { ComponentProps } from "react";

/**
 * The compose box shared by the comment composer and the inline reply box: a
 * bordered field that answers focus on its border, with a footer holding a
 * hint or a timecode toggle on one side and the submit on the other.
 */
export function Compose({ className, ...props }: ComponentProps<"div">) {
  return (
    <div className={cn("mt-4 flex items-start gap-3", className)} {...props} />
  );
}

export function ComposeField({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "min-w-0 flex-1 rounded-md border border-rule-strong bg-paper px-2.5 py-2",
        "focus-within:border-[color-mix(in_oklab,var(--art)_55%,var(--rule-strong))]",
        className
      )}
      {...props}
    />
  );
}

export function ComposeInput({
  className,
  ...props
}: ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "min-h-9 w-full resize-none border-none bg-transparent",
        // Lead is the 16px step: below it iOS zooms a focused field.
        "text-lead text-ink placeholder:text-ink-faint focus:outline-none md:text-small/[1.6]",
        className
      )}
      {...props}
    />
  );
}

export function ComposeFoot({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "mt-1.5 flex items-center justify-between gap-3",
        className
      )}
      {...props}
    />
  );
}

export function ComposeHint({ className, ...props }: ComponentProps<"span">) {
  return (
    <span className={cn("text-micro text-ink-soft", className)} {...props} />
  );
}

/** The shape of a chip on a comment row: the timecode stamp and the resolved stamp share it. */
export const STAMP_SHAPE = cn(
  "inline-flex items-center gap-[0.3125rem] rounded-full border-none",
  "px-[0.4375rem] py-[0.0625rem] text-micro tabular-nums",
  "[&_svg]:size-3"
);

/** Timecode chip on an audio comment — the link to a point in the waveform. */
export function Stamp({ className, ...props }: ComponentProps<"button">) {
  return (
    <button
      type="button"
      className={cn(
        STAMP_SHAPE,
        "cursor-pointer text-art",
        "bg-[color-mix(in_oklab,var(--art)_14%,transparent)]",
        "hover:bg-[color-mix(in_oklab,var(--art)_24%,transparent)]",
        className
      )}
      {...props}
    />
  );
}
