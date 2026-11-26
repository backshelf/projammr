"use client";

import { useFeedbackPolicy } from "@/lib/policies/provider";
import { confirmPolicy, type DeleteKind } from "@/lib/policies/shell";
import { useLatestRef } from "@workspace/ui/hooks/use-latest-ref";
import { useCallback, useState } from "react";

/** The part of a `ConfirmDeleteDialog`'s props the gate owns. */
type DeleteGateDialog = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void>;
};

export type DeleteGate<T> = {
  /**
   * Asks to delete `target`: opens the confirm when the viewer's policy asks
   * before deleting this kind, and deletes at once when it does not.
   */
  request: (target: T) => void;
  /**
   * The target the confirm is about, `null` until one is requested. It stays
   * set while the confirm closes, so the dialog's copy does not change as it
   * leaves.
   */
  pending: T | null;
  /** Spread onto the one `ConfirmDeleteDialog` the caller renders. */
  dialog: DeleteGateDialog;
};

/**
 * The gate in front of every delete: whether a delete of `kind` asks first is
 * the feedback policy's to say (`confirmPolicy`), and this is the one place
 * that asks it. A caller renders its own `ConfirmDeleteDialog` with its own
 * title and copy, spreads `dialog` onto it, and calls `request` where it used
 * to open the dialog.
 *
 * A caller with a single thing to delete leaves `T` as `void` and calls
 * `request()`. `request` keeps its identity across renders, so it can sit in
 * a context value or a memoised callback.
 */
export function useDeleteGate<T = void>(
  kind: DeleteKind | undefined,
  remove: (target: T) => unknown
): DeleteGate<T> {
  const policy = useFeedbackPolicy();
  // A table with no kind deletes nothing; should a delete reach it anyway, it asks.
  const confirm = kind == null || confirmPolicy(kind, policy);
  // Boxed, so a `void` target still counts as held.
  const [held, setHeld] = useState<{ target: T; open: boolean } | null>(null);
  const latest = useLatestRef({ confirm, remove });

  const request = useCallback(
    (target: T) => {
      if (latest.current.confirm) setHeld({ target, open: true });
      else void latest.current.remove(target);
    },
    [latest]
  );

  const onOpenChange = useCallback((open: boolean) => {
    if (!open) setHeld((current) => current && { ...current, open: false });
  }, []);

  const onConfirm = useCallback(async () => {
    if (held?.open) await remove(held.target);
  }, [held, remove]);

  return {
    request,
    pending: held ? held.target : null,
    dialog: { open: held?.open ?? false, onOpenChange, onConfirm },
  };
}
