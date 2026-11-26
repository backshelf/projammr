"use client";

import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog";
import { buttonVariants } from "@workspace/ui/components/button";
import { useModalScope } from "@workspace/ui/lib/modal-scope";
import { AnimatePresence, m, OPTICAL } from "@workspace/ui/lib/motion";
import {
  BACKDROP,
  composeRender,
  ENTRANCE,
  OVERLAY_SURFACE,
  POPUP,
} from "@workspace/ui/lib/overlay";
import {
  OverlayPresenceContext,
  PRESENT,
  useOverlayOpen,
  useOverlayPresence,
} from "@workspace/ui/lib/overlay-presence";
import { cn } from "@workspace/ui/lib/utils";
import type { VariantProps } from "class-variance-authority";
import * as React from "react";

type AsChild = { asChild?: boolean };

function AlertDialog({
  children,
  open,
  defaultOpen,
  onOpenChange,
  onOpenChangeComplete,
  ...props
}: Omit<AlertDialogPrimitive.Root.Props, "children" | "actionsRef"> & {
  children?: React.ReactNode;
}) {
  const { rootProps, presence } = useOverlayOpen<
    AlertDialogPrimitive.Root.ChangeEventDetails,
    AlertDialogPrimitive.Root.Actions
  >({ open, defaultOpen, onOpenChange, onOpenChangeComplete });
  return (
    <AlertDialogPrimitive.Root {...props} {...rootProps}>
      <OverlayPresenceContext value={presence}>
        {children}
      </OverlayPresenceContext>
    </AlertDialogPrimitive.Root>
  );
}

function AlertDialogTrigger(
  props: AlertDialogPrimitive.Trigger.Props & AsChild
) {
  return (
    <AlertDialogPrimitive.Trigger
      data-slot="alert-dialog-trigger"
      {...composeRender(props)}
    />
  );
}

function AlertDialogPortal(props: AlertDialogPrimitive.Portal.Props) {
  return (
    <AlertDialogPrimitive.Portal data-slot="alert-dialog-portal" {...props} />
  );
}

function AlertDialogOverlay({
  className,
  ...props
}: Omit<AlertDialogPrimitive.Backdrop.Props, "className" | "render"> & {
  className?: string;
}) {
  return (
    <AlertDialogPrimitive.Backdrop
      data-slot="alert-dialog-overlay"
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

/** The panel, on the same surface, placement and timing as a dialog's. */
function AlertDialogContent({
  className,
  confirm,
  ...props
}: Omit<AlertDialogPrimitive.Popup.Props, "className" | "render"> & {
  className?: string;
  /** What `mod+Enter` confirms while this dialog is open; absent (or
   *  `undefined`) leaves it with nothing to confirm. */
  confirm?: () => void;
}) {
  const { open, onExitComplete } = useOverlayPresence("AlertDialogContent");
  useModalScope(open, { confirm });
  return (
    <AnimatePresence onExitComplete={onExitComplete}>
      {open && (
        <AlertDialogPortal key="alert-dialog-portal" keepMounted>
          <AlertDialogOverlay />
          <AlertDialogPrimitive.Popup
            data-slot="alert-dialog-content"
            render={
              <m.div
                {...PRESENT}
                variants={ENTRANCE.pop}
                initial="hidden"
                animate="shown"
                exit="leaving"
              />
            }
            className={cn(OVERLAY_SURFACE, POPUP, className)}
            {...props}
          />
        </AlertDialogPortal>
      )}
    </AnimatePresence>
  );
}

function AlertDialogHeader({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-header"
      className={cn("flex flex-col gap-2 text-center sm:text-left", className)}
      {...props}
    />
  );
}

function AlertDialogFooter({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    />
  );
}

function AlertDialogTitle({
  className,
  ...props
}: Omit<AlertDialogPrimitive.Title.Props, "className"> & {
  className?: string;
}) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn("text-lg font-semibold", className)}
      {...props}
    />
  );
}

function AlertDialogDescription({
  className,
  ...props
}: Omit<AlertDialogPrimitive.Description.Props, "className"> & {
  className?: string;
}) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

type CloseProps = Omit<AlertDialogPrimitive.Close.Props, "className"> &
  AsChild & { className?: string };

/**
 * A button that closes the alert dialog unless its `onClick` calls
 * `preventDefault()` — how a confirm keeps the dialog open while the work it
 * started is still running, then closes it through `onOpenChange`.
 */
function AlertDialogClose({ onClick, ...props }: CloseProps) {
  return (
    <AlertDialogPrimitive.Close
      {...composeRender(props)}
      onClick={(event) => {
        onClick?.(event);
        if (event.isDefaultPrevented()) event.preventBaseUIHandler();
      }}
    />
  );
}

function AlertDialogAction({
  className,
  variant = "default",
  ...props
}: CloseProps & VariantProps<typeof buttonVariants>) {
  return (
    <AlertDialogClose
      data-slot="alert-dialog-action"
      className={cn(buttonVariants({ variant }), className)}
      {...props}
    />
  );
}

function AlertDialogCancel({ className, ...props }: CloseProps) {
  return (
    <AlertDialogClose
      data-slot="alert-dialog-cancel"
      className={cn(buttonVariants({ variant: "outline" }), className)}
      {...props}
    />
  );
}

export {
  AlertDialog,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
};
