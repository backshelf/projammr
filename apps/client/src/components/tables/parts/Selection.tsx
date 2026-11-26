"use client";

import { fieldWriteBody } from "@/fields/custom-field";
import { useFeedbackPolicy } from "@/lib/policies/provider";
import { pluralizeCount } from "@workspace/session-diff/format";
import type { RowData } from "@tanstack/react-table";
import { AnimatePresence } from "@workspace/ui/lib/motion";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { BulkActionsBar } from "../BulkActionsBar";
import { useDataTable } from "../data-table-context";
import { rowIdOf } from "../row-id";
import { offeredActions, runTableAction } from "../table-actions";

/**
 * The bulk actions bar, shown while any row is selected. Selection state is
 * written by several capabilities, so it lives in the root; this part only
 * renders the bar over it and turns the bar's actions into bulk calls.
 */
export function Selection(): ReactNode {
  const {
    enableSelection,
    entityLabel,
    totalRows,
    selectedIds,
    selectAllMatching,
    setSelectAllMatching,
    canSelectAllMatching,
    bulkSelection,
    clearSelection,
    orderedStatuses,
    bulkCollections,
    bulkLabels,
    bulkPriorityLevels,
    bulkFields,
    onBulkPatch,
    onBulkAddToCollection,
    onBulkSetLabels,
    onBulkMove,
    moveToProject,
    onBulkDelete,
    requestDelete,
    setMoveTarget,
    actions,
    data,
  } = useDataTable<RowData>();
  const { undoWindowMs } = useFeedbackPolicy();

  // An all-matching selection spans rows that are not loaded; the loaded ones
  // are what decides which declared actions it is offered.
  const selected = new Set<number | undefined>(selectedIds);
  const selectedRows = selectAllMatching
    ? data
    : data.filter((row) => selected.has(rowIdOf(row)));
  const selectedCount = selectAllMatching ? totalRows : selectedIds.length;
  const showBar =
    enableSelection && (selectedIds.length > 0 || selectAllMatching);

  return (
    <>
      {/* The bar mounts with its count already in it, which a screen reader
          does not announce; this region stays mounted so every change is. */}
      {enableSelection && (
        <span role="status" className="sr-only">
          {showBar
            ? `${pluralizeCount(selectedCount, entityLabel)} selected`
            : ""}
        </span>
      )}
      <AnimatePresence>
        {showBar && (
          <BulkActionsBar
            selectedCount={selectedCount}
            entityLabel={entityLabel}
            allMatching={selectAllMatching}
            canSelectAllMatching={canSelectAllMatching}
            onSelectAllMatching={() => setSelectAllMatching(true)}
            onClear={clearSelection}
            statuses={orderedStatuses}
            collections={bulkCollections}
            labels={bulkLabels}
            priorityLevels={bulkPriorityLevels}
            onSetStatus={
              onBulkPatch
                ? async (statusId) => {
                    const r = await onBulkPatch(bulkSelection, { statusId });
                    if (r.ok) {
                      toast.success(
                        `Updated ${r.count ?? selectedIds.length} ${entityLabel}s`
                      );
                      clearSelection();
                    } else {
                      toast.error("Bulk status change failed");
                    }
                  }
                : undefined
            }
            onAddToCollection={
              onBulkAddToCollection && !selectAllMatching
                ? async (collectionId) => {
                    const r = await onBulkAddToCollection(
                      collectionId,
                      selectedIds
                    );
                    if (r.ok) {
                      toast.success(
                        `Added ${r.count ?? selectedIds.length} to collection`
                      );
                      clearSelection();
                    } else {
                      toast.error("Bulk add to collection failed");
                    }
                  }
                : undefined
            }
            onSetLabels={
              onBulkSetLabels
                ? async (add, remove) => {
                    const r = await onBulkSetLabels(bulkSelection, {
                      add,
                      remove,
                    });
                    if (r.ok) {
                      toast.success(
                        `Updated ${r.count ?? selectedIds.length} ${entityLabel}s`
                      );
                      clearSelection();
                    } else {
                      toast.error("Bulk label change failed");
                    }
                  }
                : undefined
            }
            onSetPriority={
              onBulkPatch
                ? async (priorityId) => {
                    const r = await onBulkPatch(bulkSelection, { priorityId });
                    if (r.ok) {
                      toast.success(
                        `Updated ${r.count ?? selectedIds.length} ${entityLabel}s`
                      );
                      clearSelection();
                    } else {
                      toast.error("Bulk priority change failed");
                    }
                  }
                : undefined
            }
            fields={bulkFields}
            onSetField={
              onBulkPatch
                ? async (key, value) => {
                    const r = await onBulkPatch(
                      bulkSelection,
                      fieldWriteBody(key, value)
                    );
                    if (r.ok) {
                      toast.success(
                        `Updated ${r.count ?? selectedIds.length} ${entityLabel}s`
                      );
                      clearSelection();
                    } else {
                      toast.error("Bulk field change failed");
                    }
                  }
                : undefined
            }
            actions={offeredActions(actions, selectedRows, async (action) => {
              const ok = await runTableAction(
                action,
                bulkSelection,
                `${entityLabel}s`,
                undoWindowMs
              );
              if (ok) clearSelection();
            })}
            onMove={
              onBulkMove && moveToProject
                ? () =>
                    setMoveTarget({
                      selection: bulkSelection,
                      count: selectAllMatching ? totalRows : selectedIds.length,
                    })
                : undefined
            }
            onDelete={
              onBulkDelete
                ? () =>
                    requestDelete({
                      selection: bulkSelection,
                      label: pluralizeCount(
                        selectAllMatching ? totalRows : selectedIds.length,
                        entityLabel
                      ),
                    })
                : undefined
            }
          />
        )}
      </AnimatePresence>
    </>
  );
}
