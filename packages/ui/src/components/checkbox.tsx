import { cn } from "@workspace/ui/lib/utils";
import * as React from "react";

/** A native checkbox tinted with the page's artwork colour. */
function Checkbox({
  className,
  ...props
}: Omit<React.ComponentProps<"input">, "type">) {
  return (
    <input
      type="checkbox"
      data-slot="checkbox"
      className={cn(
        "block flex-none cursor-pointer accent-[var(--art)] motion-ink focus-visible:ring-2 focus-visible:ring-art/40 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
}

export { Checkbox };
