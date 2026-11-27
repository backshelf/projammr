"use client";

import { useTableUrlState } from "@/components/tables/use-table-url-state";
import { useProjectRole } from "@/hooks/use-project-role";
import type { RowData } from "@tanstack/react-table";
import { ConfirmDeleteDialog } from "@workspace/ui/components/confirm-delete-dialog";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  type DataTableConfigValue,
  DataTableProvider,
  type DataTableStateValue,
  type MoveTarget,
} from "./data-table-context";
import {
  selectRootTableState,
  useAppTable,
  useHeldTable,
} from "./data-table-hook";
import type { DataTableProps } from "./generic-table-types";
import { Cards } from "./parts/Cards";
import { useDraft } from "./parts/Draft";
import { Grid } from "./parts/Grid";
import { Move } from "./parts/Move";
import { Paging } from "./parts/Paging";
import { Peek } from "./parts/Peek";
import { SavedViews } from "./parts/SavedViews";
import { Selection } from "./parts/Selection";
import { Toolbar } from "./parts/Toolbar";
import { RowDeleteContext } from "./row-delete";
import { rowIdOf } from "./row-id";
import type { RowMenuRequest } from "./RowActions";
import { cellEntry, useCellGrid } from "./use-cell-grid";
import { useLoadedWindow } from "./use-loaded-window";
import { useRowActions } from "./use-row-actions";
import { useRowCursor } from "./use-row-cursor";
import { useTableDelete } from "./use-table-delete";
import { useTableEditing } from "./use-table-editing";
import { useTableSelection } from "./use-table-selection";
import {
  useExpandedAnnounce,
  useTableSections,
  useTableView,
} from "./use-table-view";

/** A table's view state and its setters, whether held in the URL or in React. */
export type TableStateSource = ReturnType<typeof useTableUrlState>;

/**
 * The URL state source for a page's own table, given the `serverPage` the root
 * will get. The source navigates exactly when the root is server-driven: a
 * server-paged table whose source only rewrote the URL would never refetch its
 * rows. Callers build their source here rather than deriving `navigate`
 * themselves, so the two cannot disagree.
 */
export function usePageTableState(
  serverPage: DataTableProps<RowData>["serverPage"],
  emptyQuery?: string
) {
  return useTableUrlState({ navigate: Boolean(serverPage), emptyQuery });
}

export type { DataTableProps };

/**
 * Root of the table for app data: composes view state, the loaded row window,
 * selection, inline editing, deletion, keyboard cursor, and cell grid, then
 * publishes the split config/state contexts to its compound parts (`children`).
 *
 * Every write affordance — editable cells, draft rows, selection and the bulk
 * bar, delete — is withheld from a viewer; the server enforces the same rule
 * independently.
 */
export function DataTable<TData extends RowData, TChild = never>(
  props: DataTableProps<TData, TChild>
) {
  const canEdit = useProjectRole()?.can("editor") ?? true;
  const {
    data: inputData,
    onCellSave,
    hotkeys = "focus",
    serverPage,
    entityLabel = "row",
    deleteKind,
    serverGroups,
    getRowGroupKey,
    subRows,
    rowActions: rowActionsProp,
    children,
  } = props;

  const enableSelection = canEdit && (props.enableSelection ?? false);
  const moveToProject = canEdit ? props.moveToProject : undefined;
  const rowActions = useMemo(
    () =>
      rowActionsProp && !canEdit
        ? { ...rowActionsProp, onDelete: undefined }
        : rowActionsProp,
    [rowActionsProp, canEdit]
  );

  const [moveTarget, setMoveTarget] = useState<MoveTarget<TData> | null>(null);
  const [menuRequest, setMenuRequest] = useState<RowMenuRequest | null>(null);
  const [searchInput, setSearchInput] = useState<HTMLInputElement | null>(null);

  const view = useTableView(props, enableSelection);

  const {
    data,
    setData,
    rowCount,
    loaded,
    loadMore,
    ensureLoaded: ensureWindowLoaded,
    retryLoad,
  } = useLoadedWindow({
    rows: inputData,
    serverPage,
    viewParams: view.urlState.viewParams,
    serverDriven: view.serverDriven,
    grouped: view.grouped,
  });

  const resetTableSelectionRef = useRef<(() => void) | null>(null);
  const selection = useTableSelection({
    canEdit,
    enableSelection,
    data,
    rowCount,
    serverDriven: view.serverDriven,
    selectAllMatchingAllowed: serverPage?.selectAllMatching !== false,
    scopeParams: serverPage?.scopeParams,
    globalFilter: view.urlState.state.globalFilter,
    columnFilters: view.urlState.state.columnFilters,
    isPhone: view.isPhone,
    resetTableSelectionRef,
    bulk: props,
  });

  const editing = useTableEditing({
    editableCells: props.editableCells,
    newRow: props.newRow,
    onCellSave,
    canEdit,
    setData,
  });

  const deletion = useTableDelete({
    deleteKind,
    entityLabel,
    onRowDelete: rowActions?.onDelete,
    onBulkDelete: selection.onBulkDelete,
    clearSelection: selection.clearSelection,
  });

  useExpandedAnnounce(inputData, data, view.expanded, subRows?.onExpand);

  const liveTable = useAppTable(
    {
      ...view.tableOptions,
      data,
      getRowId: (row, _index, parent) => {
        const id = String(rowIdOf(row));
        return parent ? `${parent.id}.${id}` : id;
      },
      globalFilterFn: "includesString",
      autoResetCellSelection: false,
      autoResetExpanded: false,
      enableSubRowSelection: false,
      enableCellSelection: (cell) =>
        view.selectableColumnIds.has(cell.column.id),
      state: {
        ...view.tableState,
        ...(enableSelection ? { rowSelection: selection.rowSelection } : {}),
      },
      ...(enableSelection
        ? { onRowSelectionChange: selection.onRowSelectionChange }
        : {}),
    },
    selectRootTableState
  );
  const table = useHeldTable(liveTable, view.columns, data);

  const pageRows = table.getRowModel().rows;
  const rowModelRef = useRef({ rows: pageRows, windowLength: data.length });
  useLayoutEffect(() => {
    resetTableSelectionRef.current = () => table.resetRowSelection(true);
    rowModelRef.current = { rows: pageRows, windowLength: data.length };
  });

  // Row-model-indexed wrapper around `ensureWindowLoaded` for cursor, peek and
  // paste when local filtering makes the row model shorter than the window.
  const ensureLoaded = useCallback(
    async (index: number): Promise<boolean> => {
      for (;;) {
        const { rows, windowLength } = rowModelRef.current;
        if (index < rows.length) return true;
        if (!(await ensureWindowLoaded(windowLength))) return false;
      }
    },
    [ensureWindowLoaded]
  );

  const totalRows = serverPage
    ? rowCount
    : table.getPreExpandedRowModel().rows.length;
  const hasRows = pageRows.length > 0;
  const hasFocusedCell = table.getFocusedCell() != null;
  const firstNavigableColumnId = table
    .getAllLeafColumns()
    .map((c: { id: string }) => c.id)
    .find((id: string) => view.selectableColumnIds.has(id));

  const { topLevelRows, sections, drillInFor } = useTableSections({
    pageRows,
    groupingEnabled: view.groupingEnabled,
    activeGroupKey: view.activeGroupKey,
    groupFilterParam: view.groupFilterParam,
    getRowGroupKey,
    serverGroups,
  });

  const gridRef = useRef<HTMLDivElement>(null);
  const scrollToIndexRef = useRef<((index: number) => void) | null>(null);
  const tableId = useId();
  const draft = useDraft();

  const buildRowActions = useRowActions<TData, TChild>({
    entityLabel,
    canEdit,
    canSave: editing.canSave,
    peek: view.peek,
    setPeekId: view.setPeekId,
    setRenaming: view.setRenaming,
    selectedIds: selection.selectedIds,
    clearSelection: selection.clearSelection,
    orderedStatuses: selection.orderedStatuses,
    bulkCollections: props.bulkCollections,
    onBulkPatch: selection.onBulkPatch,
    onBulkAddToCollection: selection.onBulkAddToCollection,
    onBulkMove: selection.onBulkMove,
    onBulkDelete: selection.onBulkDelete,
    requestDelete: deletion.requestDelete,
    handleCellSave: editing.handleCellSave,
    moveToProject,
    setMoveTarget,
    rowActions,
    actions: selection.actions,
    data,
  });
  const cursorRowActions = useCallback(
    (row: TData, rowId: number) =>
      rowActions ? buildRowActions(row, rowId) : null,
    [rowActions, buildRowActions]
  );

  const openCellRef = useRef<
    ((rowKey: string, columnId: string) => void) | null
  >(null);
  const cellOpenable = useCallback(
    (columnId: string) =>
      cellEntry(editing.editableCells, columnId) !== "none" &&
      view.columnVisibility[columnId] !== false,
    [editing.editableCells, view.columnVisibility]
  );

  const { cursorRowId, gridHandlers, focusInGrid } = useRowCursor({
    table,
    rows: topLevelRows,
    gridRef,
    alwaysOn: hotkeys === "page",
    showCards: view.showCards,
    peek: view.peek,
    enableSelection,
    hasFocusedCell,
    setPeekId: view.setPeekId,
    router: view.router,
    ensureLoaded,
    hasMore: loaded.hasMore,
    scrollToIndex: scrollToIndexRef,
    rowActionsFor: cursorRowActions,
    setMenuRequest,
    searchInput,
    cellOpenable,
    openCell: openCellRef,
  });

  // Called after `useRowCursor` so the grid's scope push lands after the
  // table's when both flip on in one commit (see `useCellGrid`).
  const cellGrid = useCellGrid({
    table,
    data,
    editableCells: editing.editableCells,
    selectableColumnIds: view.selectableColumnIds,
    gridRef,
    tableId,
    canSave: editing.canSave,
    saveCell: editing.handleCellSave,
    scrollToIndex: scrollToIndexRef,
    ensureLoaded,
    loaded,
    focusInGrid,
  });
  useEffect(() => {
    openCellRef.current = cellGrid.openCell;
  });

  const config = useMemo(
    (): DataTableConfigValue<TData, TChild> => ({
      ...view.config,
      ...selection.config,
      ...editing.config,
      table,
      data,
      entityLabel,
      canEdit,
      totalRows,
      topLevelRows,
      sections,
      drillInFor,
      requestDelete: deletion.requestDelete,
      rowActions,
      firstNavigableColumnId,
      cellGrid,
      gridRef,
      gridHandlers,
      hasRows,
      moveToProject,
      setMoveTarget,
      setMenuRequest,
      registerSearch: setSearchInput,
      scrollToIndex: scrollToIndexRef,
    }),
    [
      view.config,
      selection.config,
      editing.config,
      table,
      data,
      entityLabel,
      canEdit,
      totalRows,
      topLevelRows,
      sections,
      drillInFor,
      deletion.requestDelete,
      rowActions,
      firstNavigableColumnId,
      cellGrid,
      gridHandlers,
      hasRows,
      moveToProject,
    ]
  );

  const state = useMemo(
    (): DataTableStateValue<TData> => ({
      ...view.state,
      ...selection.state,
      cursorRowId,
      draft,
      moveTarget,
      menuRequest,
      loaded,
      loadMore,
      ensureLoaded,
      retryLoad,
    }),
    [
      view.state,
      selection.state,
      cursorRowId,
      draft,
      moveTarget,
      menuRequest,
      loaded,
      loadMore,
      ensureLoaded,
      retryLoad,
    ]
  );

  return (
    <table.AppTable>
      <DataTableProvider config={config} state={state}>
        <RowDeleteContext
          value={deletion.canDelete ? deletion.requestRowDelete : null}
        >
          <div>
            {children}

            <ConfirmDeleteDialog
              {...deletion.dialog}
              title={`Delete ${deletion.pendingDelete?.label ?? entityLabel}?`}
            />
          </div>
        </RowDeleteContext>
      </DataTableProvider>
    </table.AppTable>
  );
}

DataTable.Toolbar = Toolbar;
DataTable.SavedViews = SavedViews;
DataTable.Cards = Cards;
DataTable.Grid = Grid;
DataTable.Paging = Paging;
DataTable.Selection = Selection;
DataTable.Peek = Peek;
DataTable.Move = Move;
