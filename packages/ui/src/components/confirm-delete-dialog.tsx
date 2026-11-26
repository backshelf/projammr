"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./alert-dialog";
import { Field, FieldLabel } from "./field";
import { Input } from "./input";
import {
  useId,
  useState,
  type ComponentProps,
  type MouseEvent,
  type ReactNode,
} from "react";

export interface ConfirmDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  /**
   * When set, the dialog shows a labelled "Type {confirmText} to confirm"
   * input and keeps Delete disabled until the typed text matches exactly —
   * for an action whose loss is too large to trust to one click, such as
   * deleting a whole project.
   */
  confirmText?: string;
  onConfirm: () => void | Promise<void>;
  /**
   * Where focus goes once the dialog closes; by default the element that had
   * it when the dialog opened. For a confirm whose action takes its own
   * trigger off the page.
   */
  finalFocus?: ComponentProps<typeof AlertDialogContent>["finalFocus"];
  /**
   * What the action asks beyond a yes: a choice the confirm carries out
   * (where the deleted thing's rows go), shown under the description.
   */
  children?: ReactNode;
}

/**
 * Confirmation dialog for a destructive action. Replaces `window.confirm`,
 * which blocks the event loop and cannot be styled. The confirm button is
 * always the destructive variant and stays disabled while `onConfirm` is in
 * flight, or until `confirmText` (when given) is typed exactly.
 */
export function ConfirmDeleteDialog({
  open,
  onOpenChange,
  title,
  description = "This cannot be undone.",
  confirmLabel = "Delete",
  confirmText,
  onConfirm,
  finalFocus,
  children,
}: ConfirmDeleteDialogProps) {
  const [pending, setPending] = useState(false);
  const [typed, setTyped] = useState("");
  const confirmInputId = useId();

  // A reopened dialog starts from a blank input rather than inheriting
  // whatever was typed (and matched) the last time it was open. Adjusting
  // state during render on the `open` transition — rather than in an effect
  // — avoids the extra render an effect-driven reset would cost.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open) {
      setTyped("");
    }
  }

  const textConfirmed = confirmText == null || typed === confirmText;
  const confirmDisabled = pending || !textConfirmed;

  const confirm = async () => {
    setPending(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } finally {
      setPending(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={pending ? undefined : onOpenChange}>
      <AlertDialogContent
        finalFocus={finalFocus}
        confirm={confirmDisabled ? undefined : confirm}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {children}
        {confirmText != null && (
          <Field>
            <FieldLabel htmlFor={confirmInputId}>
              Type {confirmText} to confirm
            </FieldLabel>
            <Input
              id={confirmInputId}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              disabled={pending}
            />
          </Field>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={confirmDisabled}
            onClick={(e: MouseEvent) => {
              e.preventDefault();
              void confirm();
            }}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
