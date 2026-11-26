"use client";

import type { BulkSelection } from "@/entities/api";
import {
  bulkMoveEntities,
  bulkPatchEntities,
  bulkRemoveEntities,
  bulkSetEntityLabels,
  patchEntityField,
  removeEntity,
} from "@/entities/mutations";
import { useMutate } from "@/hooks/use-mutate";
import type { CellValue } from "@/components/tables/generic-table-types";
import type { TableEntityKind } from "@workspace/api/api";
import { isActionError } from "@workspace/api/lib/action-result";
import { useCallback, useMemo } from "react";
import { toast } from "sonner";

/**
 * The handlers a table hands to the `DataTable` root for editing, bulk patching and
 * deleting rows of one entity kind, with the toast and error mapping done
 * once here.
 *
 * A cell editor commits a value the field registry has already parsed, so the
 * value reaching here is the shape both the API and the row's accessor read.
 * `saveField` handles a field that is not a plain patch on the entity (a
 * collection track number) and returns `undefined` to fall through to the
 * default.
 */
export function useEntityMutations(
  kind: TableEntityKind,
  projectId: number,
  options: {
    saveField?: (
      rowId: number,
      field: string,
      value: CellValue
    ) => Promise<boolean | undefined>;
  } = {}
) {
  const mutate = useMutate();
  const { saveField } = options;

  const onCellSave = useCallback(
    async (rowId: number, field: string, value: CellValue) => {
      const handled = await saveField?.(rowId, field, value);
      if (handled !== undefined) return handled;

      const result = await mutate(patchEntityField(kind, rowId, field, value));
      if (isActionError(result)) {
        toast.error(`Save failed: ${result.error}`);
        return false;
      }
      return true;
    },
    [kind, mutate, saveField]
  );

  const onBulkPatch = useCallback(
    async (selection: BulkSelection, patch: Record<string, unknown>) => {
      const result = await mutate(
        bulkPatchEntities(kind, projectId, selection, patch)
      );
      if (isActionError(result)) return { ok: false };
      return { ok: true, count: result.updated };
    },
    [kind, mutate, projectId]
  );

  const onBulkDelete = useCallback(
    async (selection: BulkSelection) => {
      const result = await mutate(
        bulkRemoveEntities(kind, projectId, selection)
      );
      if (isActionError(result)) return { ok: false };
      return { ok: true, deleted: result.deleted };
    },
    [kind, mutate, projectId]
  );

  const onBulkSetLabels = useCallback(
    async (
      selection: BulkSelection,
      labels: { add: number[]; remove: number[] }
    ) => {
      const result = await mutate(
        bulkSetEntityLabels(kind, projectId, selection, labels)
      );
      if (isActionError(result)) return { ok: false };
      return { ok: true, count: result.updated };
    },
    [kind, mutate, projectId]
  );

  const onBulkMove = useCallback(
    async (selection: BulkSelection, targetProjectId: number) => {
      const result = await mutate(
        bulkMoveEntities(kind, projectId, selection, targetProjectId)
      );
      if (isActionError(result)) return { ok: false };
      return {
        ok: true,
        count: result.moved,
        priorityFallbacks: result.priorityFallbacks,
      };
    },
    [kind, mutate, projectId]
  );

  const onRowDelete = useCallback(
    async (id: number) => {
      const result = await mutate(removeEntity(kind, id));
      if (isActionError(result)) return { ok: false };
      return { ok: true };
    },
    [kind, mutate]
  );

  return useMemo(
    () => ({
      onCellSave,
      onBulkPatch,
      onBulkDelete,
      onBulkSetLabels,
      onBulkMove,
      onRowDelete,
    }),
    [
      onCellSave,
      onBulkPatch,
      onBulkDelete,
      onBulkSetLabels,
      onBulkMove,
      onRowDelete,
    ]
  );
}
