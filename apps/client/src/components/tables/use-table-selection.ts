"use client";

import { byPipelinePosition } from "@/components/status/components/StatusMenu";
import type { BulkSelection } from "@/entities/api";
import type { RowData } from "@tanstack/react-table";
import { type RefObject, useCallback, useMemo, useState } from "react";

import type { DataTableProps } from "./generic-table-types";
import { rowIdOf } from "./row-id";

type BulkBarProps<TData extends RowData, TChild = never> = Pick<
  DataTableProps<TData, TChild>,
  | "bulkStatuses"
  | "bulkCollections"
  | "bulkLabels"
  | "bulkPriorityLevels"
  | "bulkFields"
  | "onBulkPatch"
  | "onBulkAddToCollection"
  | "onBulkSetLabels"
  | "onBulkMove"
  | "onBulkDelete"
  | "actions"
>;

type UseTableSelectionOptions<TData extends RowData, TChild = never> = {
  canEdit: boolean;
  enableSelection: boolean;
  data: TData[];
  rowCount: number;
  serverDriven: boolean;
  selectAllMatchingAllowed: boolean;
  scopeParams: Record<string, string> | undefined;
  globalFilter: string;
  columnFilters: Record<string, string>;
  isPhone: boolean;
  resetTableSelectionRef?: RefObject<(() => void) | null>;
  bulk?: BulkBarProps<TData, TChild>;
};

/**
 * Transient row-selection state and bulk-action config for a data table:
 * ticked row ids, the "select all matching" server-side escalation, bulk
 * selection resolution, render-phase pruning when rows leave the loaded
 * window, phone select mode, and viewer-gated bulk action handlers.
 */
export function useTableSelection<TData extends RowData, TChild = never>({
  canEdit,
  enableSelection,
  data,
  rowCount,
  serverDriven,
  selectAllMatchingAllowed,
  scopeParams,
  globalFilter,
  columnFilters,
  isPhone,
  resetTableSelectionRef,
  bulk,
}: UseTableSelectionOptions<TData, TChild>) {
  // Row selection is keyed by the same `id` string `getRowId` produces. Once a
  // row leaves `data` (deleted, or gone from a refetch) its id lingers until
  // pruned against the loaded window below.
  const [rowSelection, setRowSelection] = useState<Record<string, true>>({});
  const [selectAllMatching, setSelectAllMatching] = useState(false);

  // Select mode is the card list's answer to the grid's checkbox column: while
  // it is on, a card leads with a checkbox and a tap ticks the row instead of
  // opening it. Leaving the mode or growing past the phone tier clears it.
  const [selectMode, setSelectMode] = useState(false);

  const [prunedFor, setPrunedFor] = useState(data);
  if (data !== prunedFor) {
    setPrunedFor(data);
    if (Object.keys(rowSelection).length > 0) {
      const present = new Set(data.map((r) => String(rowIdOf(r))));
      const pruned = Object.fromEntries(
        Object.entries(rowSelection).filter(([id]) => present.has(id))
      ) as Record<string, true>;
      if (Object.keys(pruned).length !== Object.keys(rowSelection).length) {
        setRowSelection(pruned);
      }
    }
  }

  const [wasPhone, setWasPhone] = useState(isPhone);
  if (wasPhone !== isPhone) {
    setWasPhone(isPhone);
    if (!isPhone) setSelectMode(false);
  }

  const onRowSelectionChange = useCallback((updater: unknown) => {
    setSelectAllMatching(false);
    setRowSelection((prev) =>
      typeof updater === "function"
        ? (updater as (p: typeof prev) => typeof prev)(prev)
        : (updater as typeof prev)
    );
  }, []);

  const selectedIds = useMemo(
    () =>
      Object.entries(rowSelection)
        .filter(([, v]) => v)
        .map(([id]) => Number(id)),
    [rowSelection]
  );

  const allLoadedSelected = useMemo(
    () =>
      enableSelection &&
      data.length > 0 &&
      data.every((row) => Boolean(rowSelection[String(rowIdOf(row))])),
    [enableSelection, data, rowSelection]
  );

  // Offering "select all N" only makes sense when the filter matches more rows
  // than are loaded, every loaded row is already ticked, and the server owns
  // filtering so the escalated selection can carry filter params.
  const canSelectAllMatching =
    enableSelection &&
    serverDriven &&
    selectAllMatchingAllowed &&
    allLoadedSelected &&
    rowCount > data.length;

  const currentFilterParams = useMemo(() => {
    const out: Record<string, string> = {};
    if (globalFilter) out.q = globalFilter;
    for (const [k, v] of Object.entries(columnFilters)) {
      if (v) out[k] = v;
    }
    return out;
  }, [globalFilter, columnFilters]);

  const bulkSelection = useMemo(
    (): BulkSelection =>
      selectAllMatching
        ? { all: true, ...currentFilterParams, ...scopeParams }
        : { ids: selectedIds },
    [selectAllMatching, currentFilterParams, scopeParams, selectedIds]
  );

  const clearSelection = useCallback(() => {
    setSelectAllMatching(false);
    setRowSelection({});
    resetTableSelectionRef?.current?.();
  }, [resetTableSelectionRef]);

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    clearSelection();
  }, [clearSelection]);

  // Menus list statuses in pipeline order; sorted once here rather than in
  // every row's menu.
  const bulkStatuses = bulk?.bulkStatuses;
  const orderedStatuses = useMemo(
    () =>
      bulkStatuses ? [...bulkStatuses].sort(byPipelinePosition) : undefined,
    [bulkStatuses]
  );
  const bulkCollections = bulk?.bulkCollections;
  const bulkLabels = bulk?.bulkLabels;
  const bulkPriorityLevels = bulk?.bulkPriorityLevels;
  const bulkFields = bulk?.bulkFields;
  const onBulkPatch = canEdit ? bulk?.onBulkPatch : undefined;
  const onBulkAddToCollection = canEdit
    ? bulk?.onBulkAddToCollection
    : undefined;
  const onBulkSetLabels = canEdit ? bulk?.onBulkSetLabels : undefined;
  const onBulkMove = canEdit ? bulk?.onBulkMove : undefined;
  const onBulkDelete = canEdit ? bulk?.onBulkDelete : undefined;
  const actions = canEdit ? bulk?.actions : undefined;

  const config = useMemo(
    () => ({
      enableSelection,
      setSelectAllMatching,
      clearSelection,
      setSelectMode,
      exitSelectMode,
      orderedStatuses,
      bulkCollections,
      bulkLabels,
      bulkPriorityLevels,
      bulkFields,
      onBulkPatch,
      onBulkAddToCollection,
      onBulkSetLabels,
      onBulkMove,
      onBulkDelete,
      actions,
    }),
    [
      enableSelection,
      clearSelection,
      exitSelectMode,
      orderedStatuses,
      bulkCollections,
      bulkLabels,
      bulkPriorityLevels,
      bulkFields,
      onBulkPatch,
      onBulkAddToCollection,
      onBulkSetLabels,
      onBulkMove,
      onBulkDelete,
      actions,
    ]
  );

  const state = useMemo(
    () => ({
      selectedIds,
      selectAllMatching,
      canSelectAllMatching,
      bulkSelection,
      selectMode,
    }),
    [
      selectedIds,
      selectAllMatching,
      canSelectAllMatching,
      bulkSelection,
      selectMode,
    ]
  );

  return {
    rowSelection,
    onRowSelectionChange,
    selectAllMatching,
    setSelectAllMatching,
    selectedIds,
    allLoadedSelected,
    canSelectAllMatching,
    bulkSelection,
    clearSelection,
    selectMode,
    setSelectMode,
    exitSelectMode,
    orderedStatuses,
    onBulkPatch,
    onBulkAddToCollection,
    onBulkMove,
    onBulkDelete,
    actions,
    config,
    state,
  };
}
