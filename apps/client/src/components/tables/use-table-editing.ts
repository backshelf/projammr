"use client";

import { fieldKind } from "@/fields";
import {
  type CustomFieldValues,
  isCustomFieldKey,
  withCustomFieldValue,
} from "@/fields/custom-field";
import type { RowData } from "@tanstack/react-table";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useMemo,
} from "react";

import type {
  CellValue,
  DataTableProps,
  EditableCellConfig,
} from "./generic-table-types";
import { rowIdOf } from "./row-id";

type RowPatchFn<TData> = (
  value: CellValue,
  row: TData
) => Record<string, unknown>;

type UseTableEditingOptions<TData extends RowData> = {
  editableCells: Record<string, EditableCellConfig> | undefined;
  newRow?: DataTableProps<TData>["newRow"];
  onCellSave: DataTableProps<TData>["onCellSave"];
  canEdit: boolean;
  setData: Dispatch<SetStateAction<TData[]>>;
};

/**
 * Optimistic inline cell editing with rollback on save failure.
 *
 * Withholds `editableCells` and `newRow` from viewers. Columns that save under
 * another field name (such as a status id) patch via their field kind's
 * `optimisticPatch`, and custom-field columns patch their key inside the row's
 * `fields` bag. The previous row snapshot is captured inside the state updater
 * so `handleCellSave` never depends on `data`.
 */
export function useTableEditing<TData extends RowData>({
  editableCells: editableCellsProp,
  newRow: newRowProp,
  onCellSave,
  canEdit,
  setData,
}: UseTableEditingOptions<TData>) {
  const editableCells = canEdit ? editableCellsProp : undefined;
  const newRow = canEdit ? newRowProp : undefined;

  const patchBySavedField = useMemo(() => {
    const map = new Map<string, RowPatchFn<TData>>();
    for (const [columnId, config] of Object.entries(editableCells ?? {})) {
      if (isCustomFieldKey(columnId)) {
        map.set(columnId, (value, row) => ({
          fields: withCustomFieldValue(
            (row as { fields?: CustomFieldValues }).fields,
            columnId,
            value
          ),
        }));
        continue;
      }
      const { saveAs, optimisticPatch } = fieldKind(config.type);
      if (saveAs && optimisticPatch) {
        map.set(saveAs, (value) => optimisticPatch(value, config));
      }
    }
    return map;
  }, [editableCells]);

  const applyOptimisticPatch = useCallback(
    (rowId: number, field: string, value: CellValue) => {
      setData((prev) =>
        prev.map((row) => {
          if (rowIdOf(row) !== rowId) return row;
          const patch = patchBySavedField.get(field);
          if (patch) return { ...row, ...patch(value, row) } as TData;
          return { ...row, [field]: value } as TData;
        })
      );
    },
    [patchBySavedField, setData]
  );

  const handleCellSave = useCallback(
    async (
      rowId: number,
      field: string,
      value: CellValue
    ): Promise<boolean> => {
      if (!onCellSave) return false;

      let previous: TData | undefined;
      setData((prev) => {
        previous = prev.find((row) => rowIdOf(row) === rowId);
        return prev;
      });
      applyOptimisticPatch(rowId, field, value);

      const ok = await onCellSave(rowId, field, value);
      const rollback = previous;
      if (!ok && rollback) {
        setData((prev) =>
          prev.map((row) => (rowIdOf(row) === rowId ? rollback : row))
        );
      }
      return ok;
    },
    [onCellSave, applyOptimisticPatch, setData]
  );

  const canSave = canEdit && Boolean(onCellSave);

  const config = useMemo(
    () => ({
      editableCells,
      newRow,
      handleCellSave,
      canSave,
    }),
    [editableCells, newRow, handleCellSave, canSave]
  );

  return {
    editableCells,
    patchBySavedField,
    applyOptimisticPatch,
    handleCellSave,
    canSave,
    config,
  };
}
