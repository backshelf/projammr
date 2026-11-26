"use client";

import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { AnimatePresence, m, POP } from "@workspace/ui/lib/motion";
import {
  composeRender,
  OVERLAY_SURFACE,
  OVERLAY_TITLE,
} from "@workspace/ui/lib/overlay";
import {
  OverlayPresenceContext,
  PRESENT,
  useOverlayOpen,
  useOverlayPresence,
} from "@workspace/ui/lib/overlay-presence";
import { cn } from "@workspace/ui/lib/utils";
import * as React from "react";

type AsChild = { asChild?: boolean };

function Popover({
  children,
  open,
  defaultOpen,
  onOpenChange,
  onOpenChangeComplete,
  ...props
}: Omit<PopoverPrimitive.Root.Props, "children" | "actionsRef"> & {
  children?: React.ReactNode;
}) {
  const { rootProps, presence } = useOverlayOpen<
    PopoverPrimitive.Root.ChangeEventDetails,
    PopoverPrimitive.Root.Actions
  >({ open, defaultOpen, onOpenChange, onOpenChangeComplete });
  return (
    <PopoverPrimitive.Root {...props} {...rootProps}>
      <OverlayPresenceContext value={presence}>
        {children}
      </OverlayPresenceContext>
    </PopoverPrimitive.Root>
  );
}

function PopoverTrigger(props: PopoverPrimitive.Trigger.Props & AsChild) {
  return (
    <PopoverPrimitive.Trigger
      data-slot="popover-trigger"
      {...composeRender(props)}
    />
  );
}

/**
 * Base UI positions a popover off an element handed to `PopoverContent`'s
 * `anchor` prop rather than a dedicated anchor part. This is a plain element a
 * caller can attach a ref to and pass along when the popover should open away
 * from its trigger, instead of the trigger itself.
 */
function PopoverAnchor({ ...props }: React.ComponentProps<"div">) {
  return <div data-slot="popover-anchor" {...props} />;
}

function PopoverContent({
  className,
  align = "center",
  side,
  sideOffset = 4,
  alignOffset,
  collisionPadding,
  anchor,
  ...props
}: Omit<PopoverPrimitive.Popup.Props, "className" | "render"> &
  Pick<
    PopoverPrimitive.Positioner.Props,
    | "side"
    | "align"
    | "sideOffset"
    | "alignOffset"
    | "collisionPadding"
    | "anchor"
  > & { className?: string }) {
  const { open, onExitComplete } = useOverlayPresence("PopoverContent");
  return (
    <AnimatePresence onExitComplete={onExitComplete}>
      {open && (
        <PopoverPrimitive.Portal key="popover-portal" keepMounted>
          <PopoverPrimitive.Positioner
            side={side}
            align={align}
            sideOffset={sideOffset}
            alignOffset={alignOffset}
            collisionPadding={collisionPadding}
            anchor={anchor}
            className="isolate z-50"
          >
            <PopoverPrimitive.Popup
              data-slot="popover-content"
              render={
                <m.div
                  {...PRESENT}
                  variants={POP}
                  initial="hidden"
                  animate="shown"
                  exit="leaving"
                  style={{ transformOrigin: "var(--transform-origin)" }}
                />
              }
              className={cn(
                OVERLAY_SURFACE,
                "flex w-72 flex-col gap-4 p-3 text-xs text-popover-foreground outline-hidden",
                className
              )}
              {...props}
            />
          </PopoverPrimitive.Positioner>
        </PopoverPrimitive.Portal>
      )}
    </AnimatePresence>
  );
}

function PopoverHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="popover-header"
      className={cn("flex flex-col gap-1 text-xs", className)}
      {...props}
    />
  );
}

function PopoverTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return (
    <div
      data-slot="popover-title"
      className={cn(OVERLAY_TITLE, className)}
      {...props}
    />
  );
}

function PopoverDescription({
  className,
  ...props
}: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="popover-description"
      className={cn("text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
};
