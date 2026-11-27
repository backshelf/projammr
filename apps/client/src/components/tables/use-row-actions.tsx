import { useCopyText } from "@/components/copy-text/CopyTextProvider";
import { rowActionTargetIds } from "@/components/tables/row-action-target";
import { useFeedbackPolicy } from "@/lib/policies/provider";
import type { RowData } from "@tanstack/react-table";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { toast } from "sonner";

import type { DataTableContextValue } from "./data-table-context";
import { rowIdOf } from "./row-id";
import type { RowActionsConfig, RowActionsTarget } from "./RowActions";
import { offeredActions, runTableAction } from "./table-actions";

/**
 * The members of the data table's context that a row's actions read. Typed as
 * a slice of it so a consumer under the provider passes `useDataTable()`
 * whole.
 */
export type RowActionsState<TData extends RowData, TChild = never> = Pick<
  DataTableContextValue<TData, TChild>,
  | "entityLabel"
  | "canEdit"
  | "canSave"
  | "peek"
  | "setPeekId"
  | "setRenaming"
  | "selectedIds"
  | "clearSelection"
  | "orderedStatuses"
  | "bulkCollections"
  | "onBulkPatch"
  | "onBulkAddToCollection"
  | "onBulkMove"
  | "onBulkDelete"
  | "requestDelete"
  | "handleCellSave"
  | "moveToProject"
  | "setMoveTarget"
  | "rowActions"
  | "actions"
  | "data"
>;

/**
 * Builds the handlers for one row's menu, the pinned action bar and the phone
 * action sheet. A row inside a multi-row selection targets the whole
 * selection and routes through the bulk endpoints; any other row is its own
 * target and uses the per-field patch the inline editors use, so a one-row
 * status change stays a single `PATCH` rather than a bulk call. A handler the
 * table cannot honour is left undefined, which hides its action. A declared
 * action is offered when any of the target's loaded rows passes its `offered`,
 * and runs on the whole target.
 *
 * It holds no state, so the desktop grid and the phone cards each call it.
 */
export function useRowActions<TData extends RowData, TChild = never>({
  entityLabel,
  canEdit,
  canSave,
  peek,
  setPeekId,
  setRenaming,
  selectedIds,
  clearSelection,
  orderedStatuses,
  bulkCollections,
  onBulkPatch,
  onBulkAddToCollection,
  onBulkMove,
  onBulkDelete,
  requestDelete,
  handleCellSave,
  moveToProject,
  setMoveTarget,
  rowActions,
  actions,
  data,
}: RowActionsState<TData, TChild>) {
  const router = useRouter();
  const copyText = useCopyText();
  const { undoWindowMs } = useFeedbackPolicy();

  return useCallback(
    (
      row: TData,
      rowId: number
    ): RowActionsConfig & { target: RowActionsTarget } => {
      const ids = rowActionTargetIds(rowId, selectedIds);
      const many = ids.length > 1;
      const plural = many ? `${entityLabel}s` : entityLabel;

      const runBulk = async (
        patch: Record<string, unknown>,
        describe: (count: number) => string
      ) => {
        if (!onBulkPatch) return;
        const r = await onBulkPatch({ ids }, patch);
        if (r.ok) {
          toast.success(describe(r.count ?? ids.length));
          if (many) clearSelection();
        } else {
          toast.error(`Could not update ${plural}`);
        }
      };

      const targetIds = new Set<number | undefined>(ids);
      const targetRows = many
        ? data.filter((r) => targetIds.has(rowIdOf(r)))
        : [row];

      return {
        playback: rowActions?.play?.(row),
        statuses: orderedStatuses,
        collections: bulkCollections,
        onSetStatus:
          onBulkPatch || canSave
            ? (statusId: number) => {
                if (many) {
                  void runBulk({ statusId }, (n) => `Updated ${n} ${plural}`);
                } else {
                  void handleCellSave(rowId, "statusId", statusId);
                }
              }
            : undefined,
        onAddToCollection: onBulkAddToCollection
          ? async (collectionId: number) => {
              const r = await onBulkAddToCollection(collectionId, ids);
              if (r.ok) {
                toast.success(`Added ${r.count ?? ids.length} to collection`);
                if (many) clearSelection();
              } else {
                toast.error("Could not add to collection");
              }
            }
          : undefined,
        onCopyLink: rowActions?.copyHref
          ? () => {
              const href = rowActions.copyHref!(row);
              void copyText(new URL(href, window.location.origin).toString(), {
                success: "Link copied",
              });
            }
          : undefined,
        onRename:
          canEdit && peek && canSave
            ? () => {
                setPeekId(rowId);
                setRenaming(true);
              }
            : undefined,
        onOpen: peek ? () => setPeekId(rowId) : undefined,
        onOpenPage:
          peek && !many ? () => router.push(peek.href(row)) : undefined,
        actions: offeredActions(actions, targetRows, async (action) => {
          const ok = await runTableAction(
            action,
            { ids },
            plural,
            undoWindowMs
          );
          if (ok && many) clearSelection();
        }),
        onMove: moveToProject
          ? many
            ? onBulkMove
              ? () => setMoveTarget({ selection: { ids }, count: ids.length })
              : undefined
            : () =>
                setMoveTarget({
                  row,
                  id: rowId,
                  name: rowActions?.label
                    ? rowActions.label(row)
                    : `this ${entityLabel}`,
                })
          : undefined,
        onDelete: (many ? onBulkDelete : rowActions?.onDelete)
          ? () =>
              requestDelete({
                selection: { ids },
                label: many
                  ? `${ids.length} ${plural}`
                  : rowActions?.label
                    ? `"${rowActions.label(row)}"`
                    : `this ${entityLabel}`,
              })
          : undefined,
        target: { count: ids.length, label: plural },
      };
    },
    [
      selectedIds,
      entityLabel,
      canEdit,
      canSave,
      orderedStatuses,
      bulkCollections,
      onBulkPatch,
      onBulkAddToCollection,
      onBulkMove,
      onBulkDelete,
      handleCellSave,
      clearSelection,
      rowActions,
      actions,
      data,
      peek,
      moveToProject,
      setPeekId,
      setRenaming,
      requestDelete,
      setMoveTarget,
      router,
      copyText,
      undoWindowMs,
    ]
  );
}
