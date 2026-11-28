"use client";

import { cn } from "@workspace/ui/lib/utils";
import { Switch as SwitchPrimitive } from "radix-ui";
import * as React from "react";

/** An on/off control drawn on the spine: ink when on, a hairline track when off. */
function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "relative inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full border-2 border-rule bg-ink/8",
        "motion-ink",
        "data-[state=checked]:border-ink data-[state=checked]:bg-ink",
        "focus-visible:ring-2 focus-visible:ring-art focus-visible:ring-offset-2 focus-visible:outline-hidden",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "coarse:after:absolute coarse:after:-inset-2",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block size-4 translate-x-0.5 rounded-full bg-paper",
          "motion-move",
          "data-[state=checked]:translate-x-4"
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
