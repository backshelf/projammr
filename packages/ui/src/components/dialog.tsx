"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { IconX } from "@tabler/icons-react";
import { Button } from "@workspace/ui/components/button";
import { useModalScope } from "@workspace/ui/lib/modal-scope";
import { AnimatePresence, m, OPTICAL } from "@workspace/ui/lib/motion";
import {
  BACKDROP,
  composeRender,
  ENTRANCE,
  type Entrance,
  OVERLAY_DESC,
  OVERLAY_SURFACE,
  OVERLAY_TITLE,
  POPUP,
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

function Dialog({
  children,
  open,
  defaultOpen,
  onOpenChange,
  onOpenChangeComplete,
  ...props
}: Omit<DialogPrimitive.Root.Props, "children" | "actionsRef"> & {
  children?: React.ReactNode;
}) {
  const { rootProps, presence } = useOverlayOpen<
    DialogPrimitive.Root.ChangeEventDetails,
    DialogPrimitive.Root.Actions
  >({
    open,
    defaultOpen,
    onOpenChange,
    onOpenChangeComplete,
  });
  return (
    <DialogPrimitive.Root {...props} {...rootProps}>
      <OverlayPresenceContext value={presence}>
        {children}
      </OverlayPresenceContext>
    </DialogPrimitive.Root>
  );
}

function DialogTrigger(props: DialogPrimitive.Trigger.Props & AsChild) {
  return (
    <DialogPrimitive.Trigger
      data-slot="dialog-trigger"
      {...composeRender(props)}
    />
  );
}

function DialogPortal(props: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose(props: DialogPrimitive.Close.Props & AsChild) {
  return (
    <DialogPrimitive.Close data-slot="dialog-close" {...composeRender(props)} />
  );
}

/**
 * The scrim. `DialogContent` is left selectable: it hosts the command palette
 * and every form dialog, and `user-select: none` inherits into their inputs,
 * where dragging across text is something a user does on purpose.
 */
function DialogOverlay({
  className,
  ...props
}: Omit<DialogPrimitive.Backdrop.Props, "className" | "render"> & {
  className?: string;
}) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      render={
        <m.div
          {...PRESENT}
          variants={OPTICAL}
          initial="hidden"
          animate="shown"
          exit="leaving"
        />
      }
      className={cn(BACKDROP, className)}
      {...props}
    />
  );
}

/**
 * The panel. It mounts through `AnimatePresence` so its exit plays before
 * Base UI lets it go; `entrance` picks how it arrives (`sheet` for a panel
 * that fills a phone screen).
 */
function DialogContent({
  className,
  children,
  showCloseButton = true,
  entrance = "pop",
  modalScope = true,
  ...props
}: Omit<DialogPrimitive.Popup.Props, "className" | "render"> & {
  className?: string;
  showCloseButton?: boolean;
  entrance?: Entrance;
  /**
   * Set false to skip pushing the modal command scope. The palette's own
   * `Dialog` (`CommandDialog`) opts out: it is not confirming one thing, and
   * silencing the global scope beneath it would take `mod+k` with it, the
   * key that closes the palette.
   */
  modalScope?: boolean;
}) {
  const { open, onExitComplete } = useOverlayPresence("DialogContent");
  const popupRef = React.useRef<HTMLDivElement>(null);
  useModalScope(modalScope && open, {
    confirm: () =>
      popupRef.current?.querySelector<HTMLFormElement>("form")?.requestSubmit(),
  });
  return (
    <AnimatePresence onExitComplete={onExitComplete}>
      {open && (
        <DialogPortal key="dialog-portal" keepMounted>
          <DialogOverlay />
          <DialogPrimitive.Popup
            ref={popupRef}
            data-slot="dialog-content"
            render={
              <m.div
                {...PRESENT}
                variants={ENTRANCE[entrance]}
                initial="hidden"
                animate="shown"
                exit="leaving"
              />
            }
            className={cn(OVERLAY_SURFACE, POPUP, className)}
            {...props}
          >
            {children}
            {showCloseButton && (
              <DialogPrimitive.Close
                data-slot="dialog-close"
                render={
                  <Button
                    variant="ghost"
                    className="absolute top-2 right-2"
                    size="icon-sm"
                  />
                }
              >
                <IconX />
                <span className="sr-only">Close</span>
              </DialogPrimitive.Close>
            )}
          </DialogPrimitive.Popup>
        </DialogPortal>
      )}
    </AnimatePresence>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  );
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean;
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>
          Close
        </DialogPrimitive.Close>
      )}
    </div>
  );
}

function DialogTitle({
  className,
  ...props
}: Omit<DialogPrimitive.Title.Props, "className"> & { className?: string }) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(OVERLAY_TITLE, className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: Omit<DialogPrimitive.Description.Props, "className"> & {
  className?: string;
}) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        OVERLAY_DESC,
        "*:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
