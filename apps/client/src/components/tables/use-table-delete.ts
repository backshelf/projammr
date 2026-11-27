"use client";

import { type BulkSelection, selectedIdsOf } from "@/entities/api";
import { useDeleteGate } from "@/hooks/use-delete-gate";
import type { DeleteKind } from "@/lib/policies/shell";
import { pluralizeCount } from "@workspace/session-diff/format";
import { useCallback } from "react";
import { toast } from "sonner";

import type { PendingDelete } from "./data-table-context";

type UseTableDeleteOptions = {
  deleteKind: DeleteKind | undefined;
  entityLabel: string;
  onRowDelete: ((id: number) => Promise<{ ok: boolean }>) | undefined;
  onBulkDelete:
    | ((selection: BulkSelection) => Promise<{ ok: boolean; deleted?: number }>)
    | undefined;
  clearSelection: () => void;
};

/**
 * Coordinates single-row and bulk deletes behind the table's shared
 * `useDeleteGate` confirmation dialog.
 *
 * A single-id selection routes through `onRowDelete` when present (keeping
 * one-row deletes a single request without clearing selection); multi-row or
 * all-matching selections route through `onBulkDelete`, toasting the server's
 * deleted count and clearing selection on success.
 */
export function useTableDelete({
  deleteKind,
  entityLabel,
  onRowDelete,
  onBulkDelete,
  clearSelection,
}: UseTableDeleteOptions) {
  const canDelete = Boolean(onRowDelete || onBulkDelete);

  const runDelete = useCallback(
    async ({ selection, label }: PendingDelete) => {
      const namedIds = selectedIdsOf(selection);
      const single = namedIds?.length === 1 ? namedIds[0] : undefined;
      if (single != null && onRowDelete) {
        const r = await onRowDelete(single);
        if (r.ok) toast.success(`Deleted ${label}`);
        else toast.error(`Could not delete ${label}`);
        return;
      }
      if (!onBulkDelete) return;
      const r = await onBulkDelete(selection);
      if (r.ok) {
        toast.success(
          r.deleted == null
            ? `Deleted ${label}`
            : `Deleted ${pluralizeCount(r.deleted, entityLabel)}`
        );
        clearSelection();
      } else {
        toast.error(`Could not delete ${label}`);
      }
    },
    [onRowDelete, onBulkDelete, clearSelection, entityLabel]
  );

  // Every surface's delete (a row's menu, the bulk bar, a custom cell) comes
  // through here so the policy gate stands in front of all of them at once.
  const deletion = useDeleteGate(deleteKind, runDelete);
  const { request: requestDelete } = deletion;

  const requestRowDelete = useCallback(
    (ids: number[], label: string) =>
      requestDelete({ selection: { ids }, label }),
    [requestDelete]
  );

  return {
    canDelete,
    requestDelete,
    requestRowDelete,
    pendingDelete: deletion.pending,
    dialog: deletion.dialog,
  };
}
