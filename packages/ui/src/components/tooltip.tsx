"use client";

import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import { AnimatePresence, m, POP } from "@workspace/ui/lib/motion";
import { composeRender } from "@workspace/ui/lib/overlay";
import {
  OverlayPresenceContext,
  PRESENT,
  useOverlayOpen,
  useOverlayPresence,
} from "@workspace/ui/lib/overlay-presence";
import { cn } from "@workspace/ui/lib/utils";
import * as React from "react";

type AsChild = { asChild?: boolean };

function TooltipProvider({
  delayDuration = 0,
  ...props
}: Omit<TooltipPrimitive.Provider.Props, "delay"> & {
  delayDuration?: number;
}) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delay={delayDuration}
      {...props}
    />
  );
}

function Tooltip({
  children,
  open,
  defaultOpen,
  onOpenChange,
  onOpenChangeComplete,
  ...props
}: Omit<TooltipPrimitive.Root.Props, "children" | "actionsRef"> & {
  children?: React.ReactNode;
}) {
  const { rootProps, presence } = useOverlayOpen<
    TooltipPrimitive.Root.ChangeEventDetails,
    TooltipPrimitive.Root.Actions
  >({ open, defaultOpen, onOpenChange, onOpenChangeComplete });
  return (
    <TooltipPrimitive.Root {...props} {...rootProps}>
      <OverlayPresenceContext value={presence}>
        {children}
      </OverlayPresenceContext>
    </TooltipPrimitive.Root>
  );
}

function TooltipTrigger(props: TooltipPrimitive.Trigger.Props & AsChild) {
  return (
    <TooltipPrimitive.Trigger
      data-slot="tooltip-trigger"
      {...composeRender(props)}
    />
  );
}

/**
 * The panel. `Tooltip.Popup`'s `render` reads `state.instant`, which Base UI
 * sets while a tooltip re-opens inside the provider's group-close window —
 * that reopen renders at rest instead of playing the pop-in again.
 */
function TooltipContent({
  className,
  side,
  align,
  sideOffset = 0,
  alignOffset,
  collisionPadding,
  children,
  ...props
}: Omit<TooltipPrimitive.Popup.Props, "className" | "render"> &
  Pick<
    TooltipPrimitive.Positioner.Props,
    "side" | "align" | "sideOffset" | "alignOffset" | "collisionPadding"
  > & { className?: string }) {
  const { open, onExitComplete } = useOverlayPresence("TooltipContent");
  return (
    <AnimatePresence onExitComplete={onExitComplete}>
      {open && (
        <TooltipPrimitive.Portal key="tooltip-portal" keepMounted>
          <TooltipPrimitive.Positioner
            side={side}
            align={align}
            sideOffset={sideOffset}
            alignOffset={alignOffset}
            collisionPadding={collisionPadding}
            className="z-50"
          >
            <TooltipPrimitive.Popup
              data-slot="tooltip-content"
              className={cn(
                "z-50 inline-flex w-fit max-w-xs items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs text-background has-data-[slot=kbd]:pr-1.5 **:data-[slot=kbd]:relative **:data-[slot=kbd]:isolate **:data-[slot=kbd]:z-50 **:data-[slot=kbd]:rounded-sm",
                className
              )}
              render={(popupProps, state) => (
                <m.div
                  {...(popupProps as React.ComponentPropsWithRef<typeof m.div>)}
                  {...PRESENT}
                  variants={POP}
                  initial={state.instant ? false : "hidden"}
                  animate="shown"
                  exit="leaving"
                  style={{
                    ...popupProps.style,
                    transformOrigin: "var(--transform-origin)",
                  }}
                />
              )}
              {...props}
            >
              {children}
              <TooltipPrimitive.Arrow
                data-slot="tooltip-arrow"
                className="z-50 size-2.5 rotate-45 rounded-[2px] bg-foreground data-[side=bottom]:-top-1 data-[side=left]:-right-1 data-[side=right]:-left-1 data-[side=top]:-bottom-1"
              />
            </TooltipPrimitive.Popup>
          </TooltipPrimitive.Positioner>
        </TooltipPrimitive.Portal>
      )}
    </AnimatePresence>
  );
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
