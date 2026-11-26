import { cn } from "@workspace/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

/**
 * A key, in Departure Mono and ink. `cap` draws it as a key cap with a hairline
 * edge, for a key read on its own (a shortcut list, a capture control); `bare`
 * is the glyph alone, for a line of hints where edges would crowd the labels.
 */
const kbdVariants = cva("font-sub text-micro text-ink", {
  variants: {
    variant: {
      cap: "rounded-sm border border-rule px-1",
      bare: "",
    },
  },
  defaultVariants: { variant: "cap" },
});

function Kbd({
  className,
  variant,
  ...props
}: React.ComponentProps<"kbd"> & VariantProps<typeof kbdVariants>) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(kbdVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Kbd };
