"use client";

import { fieldKind } from "@/fields";
import {
  type CustomFieldValues,
  isCustomFieldKey,
  withCustomFieldValue,
} from "@/fields/custom-field";
import { usePeekRow } from "@/components/tables/use-peek-row";
import { useDeleteGate } from "@/hooks/use-delete-gate";
import { useProjectRole } from "@/hooks/use-project-role";
import { useSetting } from "@/lib/settings/provider";
import { useTableUrlState } from "@/components/tables/use-table-url-state";
import {
  sectionDrillIn,
  sectionize,
  type Section,
} from "@/components/tables/group-sections";
import { type BulkSelection, selectedIdsOf } from "@/entities/api";
import { pluralizeCount } from "@workspace/session-diff/format";
import type { RowData } from "@tanstack/react-table";
import { useRouter } from "next/navigation";
import React, {
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import { ConfirmDeleteDialog } from "@workspace/ui/components/confirm-delete-dialog";
import {
  type DataTableConfigValue,
  DataTableProvider,
  type DataTableStateValue,
  type MoveTarget,
  type PendingDelete,
} from "./data-table-context";
import {
  selectRootTableState,
  useAppTable,
  useHeldTable,
} from "./data-table-hook";
import type { CellValue, DataTableProps } from "./generic-table-types";
import { EXPAND_COLUMN, SELECT_COLUMN } from "./leading-columns";
import { Cards } from "./parts/Cards";
import { useDraft } from "./parts/Draft";
import { Grid } from "./parts/Grid";
import { Move } from "./parts/Move";
import { Paging } from "./parts/Paging";
import { Peek } from "./parts/Peek";
import { SavedViews } from "./parts/SavedViews";
import { Selection } from "./parts/Selection";
import { RowDeleteContext } from "./row-delete";
import { rowIdOf } from "./row-id";
import type { RowMenuRequest } from "./RowActions";
import { byPipelinePosition } from "@/components/status/components/StatusMenu";
import { Toolbar } from "./parts/Toolbar";
import { cellEntry, useCellGrid } from "./use-cell-grid";
import { useLoadedWindow } from "./use-loaded-window";
import { useRowActions } from "./use-row-actions";
import { useRowCursor } from "./use-row-cursor";
import { useTableLocalState } from "./use-table-local-state";
import { useIsMobile } from "@workspace/ui/hooks/use-mobile";

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
 * Root of the table for app data: holds the table, its rows, the shared
 * state its parts read, and the one delete dialog. The parts — global search,
 * sortable headers, the row count, inline editable cells, optional grouping,
 * expandable sub-rows and saved views among them — are its `children`,
 * reachable as its static properties. Columns are defined by the caller with
 * `createAppColumnHelper`.
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
    columns: inputColumns,
    emptyText = "No results.",
    editableCells: editableCellsProp,
    onCellSave,
    newRow: newRowProp,
    navigableColumns,
    urlState: urlSource,
    hotkeys = "focus",
    serverPage,
    filterColumns,
    facets,
    initiallyHiddenColumns,
    enableSelection: enableSelectionProp = false,
    entityLabel = "row",
    bulkStatuses,
    bulkCollections,
    bulkLabels,
    bulkPriorityLevels,
    bulkFields,
    onBulkPatch: onBulkPatchProp,
    onBulkAddToCollection: onBulkAddToCollectionProp,
    onBulkSetLabels: onBulkSetLabelsProp,
    onBulkMove: onBulkMoveProp,
    onBulkDelete: onBulkDeleteProp,
    deleteKind,
    actions: actionsProp,
    groupByOptions,
    serverGroups,
    getRowGroupKey,
    subRows,
    peek: peekProp,
    moveToProject: moveToProjectProp,
    rowActions: rowActionsProp,
    rowAccent,
    cards,
    pinnedColumnId,
    savedViews,
    children,
  } = props;

  // `inUrl` configures the peek hook below; the rest is the config every part
  // reads.
  const peekInUrl = peekProp?.inUrl ?? false;
  const peek = useMemo(() => {
    if (!peekProp) return undefined;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { inUrl, ...config } = peekProp;
    return config;
  }, [peekProp]);

  const editableCells = canEdit ? editableCellsProp : undefined;
  const newRow = canEdit ? newRowProp : undefined;
  const enableSelection = canEdit && enableSelectionProp;
  const onBulkPatch = canEdit ? onBulkPatchProp : undefined;
  const onBulkAddToCollection = canEdit ? onBulkAddToCollectionProp : undefined;
  const onBulkSetLabels = canEdit ? onBulkSetLabelsProp : undefined;
  const onBulkMove = canEdit ? onBulkMoveProp : undefined;
  const onBulkDelete = canEdit ? onBulkDeleteProp : undefined;
  const actions = canEdit ? actionsProp : undefined;
  const moveToProject = canEdit ? moveToProjectProp : undefined;
  const rowActions = useMemo(
    () =>
      rowActionsProp && !canEdit
        ? { ...rowActionsProp, onDelete: undefined }
        : rowActionsProp,
    [rowActionsProp, canEdit]
  );

  // Built from the ungated prop: a viewer's grid is navigable and copyable,
  // and it is `entryOf` — not the navigable set — that makes every cell of it
  // read-only.
  const selectableColumnIds = useMemo(
    () => new Set(navigableColumns ?? Object.keys(editableCellsProp ?? {})),
    [navigableColumns, editableCellsProp]
  );

  const hierarchyEnabled = Boolean(subRows);

  // Prepend the disclosure and selection columns when those are on. Memoised on
  // the inputs so the columns reference stays stable between renders that don't
  // change either — an unstable columns array rebuilds the column model every
  // render.
  const columns = useMemo(() => {
    const leading = [
      ...(hierarchyEnabled
        ? [EXPAND_COLUMN as (typeof inputColumns)[number]]
        : []),
      ...(enableSelection
        ? [SELECT_COLUMN as (typeof inputColumns)[number]]
        : []),
    ];
    return leading.length > 0 ? [...leading, ...inputColumns] : inputColumns;
  }, [inputColumns, enableSelection, hierarchyEnabled]);

  const leadingColumnCount =
    (hierarchyEnabled ? 1 : 0) + (enableSelection ? 1 : 0);

  // The optimistic patch of every column that does not save to a row field of
  // its own name, keyed by the name it saves under: a kind that saves to
  // another field (a status id) patches what that kind says, and a custom
  // field's column patches its key in the row's `fields` bag, which holds only
  // the fields that have a value.
  const patchBySavedField = useMemo(() => {
    const map = new Map<
      string,
      (value: CellValue, row: TData) => Record<string, unknown>
    >();
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

  // Menus list statuses in pipeline order; sorted once here rather than in
  // every row's menu.
  const orderedStatuses = useMemo(
    () =>
      bulkStatuses ? [...bulkStatuses].sort(byPipelinePosition) : undefined,
    [bulkStatuses]
  );

  // Row selection is transient client state (a bulk-action scratchpad), keyed
  // by the same `id` string `getRowId` produces. It never self-cleans: once a
  // row leaves `data` — deleted, or gone from a refetch — its id lingers here,
  // so prune to the ids currently loaded whenever `data` changes.
  const [rowSelection, setRowSelection] = useState<Record<string, true>>({});
  const [selectAllMatching, setSelectAllMatching] = useState(false);
  const [moveTarget, setMoveTarget] = useState<MoveTarget<TData> | null>(null);
  const [menuRequest, setMenuRequest] = useState<RowMenuRequest | null>(null);
  // The search field the toolbar renders, held as state so a key that
  // focuses it is offered only once it is there.
  const [searchInput, setSearchInput] = useState<HTMLInputElement | null>(null);

  // Row expansion is transient (a disclosure state, not a shareable view slice)
  // and keyed by `getRowId`. `true` means "all rows expanded".
  const [expanded, setExpanded] = useState<true | Record<string, boolean>>({});

  // A table given a URL source owns the page URL. Every other table keeps the
  // same view state in React, so the parts read one shape either way.
  const localState = useTableLocalState();
  const ownsUrl = urlSource != null;
  const urlState = urlSource ?? localState;

  // The server only drives a table that can reach it — one whose state travels
  // in the URL. An embedded table processes the rows it has loaded itself.
  const serverDriven = Boolean(serverPage) && ownsUrl;

  const groupingEnabled = (groupByOptions?.length ?? 0) > 0;
  const activeGroupKey = urlState.state.grouping[0] ?? null;
  const activeGroupOption = groupByOptions?.find(
    (o) => o.id === activeGroupKey
  );
  // Only a group key the table offers groups the server's page; a stale or
  // hand-edited `?group=` pages normally, so it must not stop the window.
  const grouped = activeGroupOption != null;

  // The rows the table has loaded: the `data` prop seeds them, pages appended
  // through `serverPage.load` extend them, and cell edits update them
  // optimistically through `setData`.
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
    viewParams: urlState.viewParams,
    serverDriven,
    grouped,
  });

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

  // Rows already handed to `subRows.onExpand`, so a collapse-then-expand does
  // not refetch. Keyed by the same row id the expansion state uses, and
  // started over whenever the `data` prop changes: that is the server
  // re-rendering the rows, and the children fetched describe the old ones.
  const announcedRef = useRef({ data: inputData, ids: new Set<string>() });
  const onExpand = subRows?.onExpand;

  // Announces every expanded top-level row that has not been announced since
  // the `data` prop last changed: on expansion, when a loaded page brings an
  // expanded row, and again after a refetch so an expanded row's children
  // never go stale against a fresh parent.
  useEffect(() => {
    if (!onExpand) return;
    if (announcedRef.current.data !== inputData) {
      announcedRef.current = { data: inputData, ids: new Set() };
    }
    for (const row of data) {
      const id = String(rowIdOf(row));
      if (!(expanded === true || expanded[id] === true)) continue;
      if (announcedRef.current.ids.has(id)) continue;
      announcedRef.current.ids.add(id);
      onExpand(row);
    }
  }, [inputData, data, expanded, onExpand]);

  // A locally filtered table re-filters every row on each keystroke; deferring
  // the value keeps the input responsive while the rows catch up.
  const deferredGlobalFilter = useDeferredValue(urlState.state.globalFilter);
  const globalFilter = serverDriven
    ? urlState.state.globalFilter
    : deferredGlobalFilter;

  const [peekId, setPeekId] = usePeekRow(peekInUrl);
  // Whether the open peek row's title is being edited. Unlike the open row
  // itself it never reaches the URL: a rename is not something to link to.
  const [renaming, setRenaming] = useState(false);
  const router = useRouter();
  const rowClick = useSetting("tables.rowClick");
  // The same path the row cursor's `open` move takes (`use-row-cursor.ts`):
  // never a second way of building a row's href.
  const openRow = useCallback(
    (rowData: TData) => {
      if (peek) router.push(peek.href(rowData));
    },
    [peek, router]
  );

  // The URL is the single owner of every controlled slice: an absent column in
  // `columnVisibility` reads as visible, so `initiallyHiddenColumns` is merged
  // in only while the URL says nothing about that column.
  const columnVisibility = useMemo(() => {
    const fromDefaults = Object.fromEntries(
      (initiallyHiddenColumns ?? [])
        .filter((id) => !(id in urlState.state.columnVisibility))
        .map((id) => [id, false])
    );
    return { ...fromDefaults, ...urlState.state.columnVisibility };
  }, [initiallyHiddenColumns, urlState.state.columnVisibility]);

  // `useTableUrlState` owns these slices whether or not they reach the URL —
  // an embedded table keeps the same state in React alone. Handing the table
  // the state without the setters (or the reverse) leaves it reading a value
  // nothing updates, which is how a sort click lands nowhere.
  const controlled = {
    state: {
      globalFilter,
      sorting: urlState.state.sorting,
      columnVisibility,
      columnOrder: urlState.state.columnOrder,
      columnSizing: urlState.state.columnSizing,
      ...(hierarchyEnabled ? { expanded } : {}),
      ...(enableSelection ? { rowSelection } : {}),
    },
    onGlobalFilterChange: urlState.setGlobalFilter,
    onSortingChange: urlState.setSorting,
    onColumnVisibilityChange: urlState.setColumnVisibility,
    onColumnOrderChange: urlState.setColumnOrder,
    onColumnSizingChange: urlState.setColumnSizing,
    ...(hierarchyEnabled
      ? {
          onExpandedChange: (updater: unknown) =>
            setExpanded((prev) =>
              typeof updater === "function"
                ? (updater as (p: typeof prev) => typeof prev)(prev)
                : (updater as typeof prev)
            ),
        }
      : {}),
    ...(enableSelection
      ? {
          onRowSelectionChange: (updater: unknown) => {
            setSelectAllMatching(false);
            setRowSelection((prev) =>
              typeof updater === "function"
                ? (updater as (p: typeof prev) => typeof prev)(prev)
                : (updater as typeof prev)
            );
          },
        }
      : {}),
  };

  // The child rows are a different entity, and the table's row type is the
  // parent's; this is the one place the two meet.
  const getSubRows = useMemo(
    () =>
      subRows
        ? (row: TData) => subRows.getRows(row) as unknown as TData[] | undefined
        : undefined,
    [subRows]
  );

  const liveTable = useAppTable(
    {
      columns,
      data,
      // Namespace a sub-row's id under its parent's: a track and one of its
      // sessions can share a numeric `id`, and a bare `String(id)` would then
      // collide in row state (selection, expansion) and in React keys.
      getRowId: (row, _index, parent) => {
        const id = String(rowIdOf(row));
        return parent ? `${parent.id}.${id}` : id;
      },
      globalFilterFn: "includesString",
      // Optimistic cell edits call setData constantly; without this the
      // selection and the expanded set would collapse on every keystroke-driven
      // save.
      autoResetCellSelection: false,
      autoResetExpanded: false,
      // A sub-row is a different entity than its parent (a session under a
      // track); toggling the parent's checkbox must not sweep its children into
      // a bulk action meant for the parent's kind.
      enableSubRowSelection: false,
      enableCellSelection: (cell) => selectableColumnIds.has(cell.column.id),
      ...(getSubRows ? { getSubRows } : {}),
      // With a server page, filtering and sorting are the server's: the manual
      // flags make the table trust `data` as the view's rows, in order. The
      // row-model factories stay registered but are never invoked in this mode.
      //
      // Only a table that owns the URL can hand the server a sort or a filter
      // on every change, though — an embedded table's view reaches the server
      // only through `serverPage.load`, so it keeps processing the rows it has
      // loaded itself and a header click lands before that page does.
      ...(serverDriven && serverPage
        ? { manualFiltering: true, manualSorting: true }
        : {}),
      ...controlled,
    },
    selectRootTableState
  );
  const table = useHeldTable(liveTable, columns, data);

  // `ensureWindowLoaded` compares an index against the loaded window, but the
  // row cursor, peek and paste all reason in row-model indices: a locally
  // filtered table's row model can be shorter than the window. This wraps it
  // into a row-model-indexed version for them, loading pages until the target
  // index exists in the row model or the window truly has no more to give it.
  // `rowModelRef` is read instead of closing over `table`/`data` directly:
  // `table.getRowModel()` reflects the latest `data` only after the render
  // that follows a window commit, which a loop already spanning an `await`
  // predates, so it reads a ref kept current in a layout effect instead — the
  // way the hook itself reads `committedRef`.
  const rowModelRef = useRef({
    rows: table.getRowModel().rows,
    windowLength: data.length,
  });
  useLayoutEffect(() => {
    rowModelRef.current = {
      rows: table.getRowModel().rows,
      windowLength: data.length,
    };
  });

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

  // A server-paged table counts what the server says matches its view; a
  // table holding every row counts its own top-level rows once filtered.
  const totalRows = serverPage
    ? rowCount
    : table.getPreExpandedRowModel().rows.length;

  const selectedIds = useMemo(
    () =>
      Object.entries(rowSelection)
        .filter(([, v]) => v)
        .map(([id]) => Number(id)),
    [rowSelection]
  );
  const allLoadedSelected =
    enableSelection && data.length > 0 && table.getIsAllPageRowsSelected();
  // Offering "select all N" only makes sense when the filter matches more rows
  // than are loaded and every loaded row is already ticked. It also needs the
  // server to be the one filtering: the escalated selection is sent as filter
  // params for the server to re-resolve, which a locally filtered table has no
  // equivalent of.
  const canSelectAllMatching =
    enableSelection &&
    serverDriven &&
    serverPage?.selectAllMatching !== false &&
    allLoadedSelected &&
    totalRows > data.length;

  const currentFilterParams = useMemo(() => {
    const out: Record<string, string> = {};
    if (urlState.state.globalFilter) out.q = urlState.state.globalFilter;
    for (const [k, v] of Object.entries(urlState.state.columnFilters)) {
      if (v) out[k] = v;
    }
    return out;
  }, [urlState.state.globalFilter, urlState.state.columnFilters]);

  const scopeParams = serverPage?.scopeParams;
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
    table.resetRowSelection(true);
  }, [table]);

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

  // The row to roll back is captured inside the state updater rather than
  // read from `data`, so an optimistic patch does not rebuild every handler
  // downstream of this one.
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

  const gridRef = React.useRef<HTMLDivElement>(null);

  // Owned here so it survives the grid remounting (a tier swap, a view
  // change): the ref itself never changes identity, only what it points at.
  // The grid that owns the virtualiser assigns `.current` in an effect and
  // clears it on unmount; a caller with no virtualiser to reach finds `null`.
  const scrollToIndexRef = React.useRef<((index: number) => void) | null>(null);

  const tableId = useId();

  const hasRows = table.getRowModel().rows.length > 0;

  const draft = useDraft();

  // The feature's roving tabindex gives `0` only to the focused cell, so before
  // any selection the grid is unreachable by Tab. Seed the tab stop on the
  // first navigable cell until a real focus exists.
  const hasFocusedCell = table.getFocusedCell() != null;
  const firstNavigableColumnId = table
    .getAllLeafColumns()
    .map((c: { id: string }) => c.id)
    .find((id: string) => selectableColumnIds.has(id));

  type TableRowModel = ReturnType<typeof table.getRowModel>["rows"][number];

  const pageRows = table.getRowModel().rows;

  const topLevelRows = useMemo(
    () => pageRows.filter((row) => row.depth === 0),
    [pageRows]
  );

  // With a `group` param active the server returns a bounded preview of every
  // group; a section header precedes each group's rows, carrying the group's
  // real total from `serverGroups`. A group with more rows than the preview
  // gets a "Show all" link into the ungrouped list filtered to that group.
  // The grid and the card list draw the same sections two ways.
  const groupFilterParam = activeGroupOption?.filterParam;
  const sections = useMemo(
    (): Section<TableRowModel>[] | null =>
      groupingEnabled && activeGroupKey && getRowGroupKey
        ? sectionize(
            pageRows,
            (row) => getRowGroupKey(row.original as TData, activeGroupKey),
            serverGroups ?? []
          )
        : null,
    [groupingEnabled, activeGroupKey, getRowGroupKey, pageRows, serverGroups]
  );

  // A section's own rows include the children of any expanded parent, which
  // would read as the group being complete when it is not. Only top-level rows
  // count against the group's total, in either presentation.
  const drillInFor = useCallback(
    (section: Section<TableRowModel>) =>
      sectionDrillIn(
        { ...section, rows: section.rows.filter((row) => row.depth === 0) },
        groupFilterParam
      ),
    [groupFilterParam]
  );

  // A phone gets the stacked list; every width above it keeps the grid. The
  // server has no viewport and renders the table, so a phone swaps once at
  // hydration.
  const isPhone = useIsMobile();
  const showCards = isPhone && cards != null && peek != null;

  const canDelete = Boolean(rowActions?.onDelete || onBulkDelete);

  const runDelete = useCallback(
    async ({ selection, label }: PendingDelete) => {
      // One row keeps the per-entity DELETE the row menu has always used, so
      // a single delete stays a single request rather than a bulk call.
      const namedIds = selectedIdsOf(selection);
      const single = namedIds?.length === 1 ? namedIds[0] : undefined;
      if (single != null && rowActions?.onDelete) {
        const r = await rowActions.onDelete(single);
        if (r.ok) toast.success(`Deleted ${label}`);
        else toast.error(`Could not delete ${label}`);
        return;
      }
      if (!onBulkDelete) return;
      const r = await onBulkDelete(selection);
      if (r.ok) {
        // The server counts what it actually removed, which is the only
        // number that is right when the selection was "everything matching".
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
    [rowActions, onBulkDelete, clearSelection, entityLabel]
  );
  // Every surface's delete (a row's menu, the bulk bar, a custom cell) comes
  // through here, so the policy's gate stands in front of all of them at once.
  const deletion = useDeleteGate(deleteKind, runDelete);
  const { request: requestDelete } = deletion;
  const requestRowDelete = useCallback(
    (ids: number[], label: string) =>
      requestDelete({ selection: { ids }, label }),
    [requestDelete]
  );

  // The row cursor's keys act through the same handlers the row menu builds.
  const buildRowActions = useRowActions<TData, TChild>({
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
  });
  const cursorRowActions = useCallback(
    (row: TData, rowId: number) =>
      rowActions ? buildRowActions(row, rowId) : null,
    [rowActions, buildRowActions]
  );

  // The cell grid is built after the cursor (see below), so the cursor reaches
  // its `openCell` through this ref.
  const openCellRef = useRef<
    ((rowKey: string, columnId: string) => void) | null
  >(null);
  const cellOpenable = useCallback(
    (columnId: string) =>
      cellEntry(editableCells, columnId) !== "none" &&
      columnVisibility[columnId] !== false,
    [editableCells, columnVisibility]
  );

  const { cursorRowId, gridHandlers, focusInGrid } = useRowCursor({
    table,
    rows: topLevelRows,
    gridRef,
    alwaysOn: hotkeys === "page",
    showCards,
    peek,
    enableSelection,
    hasFocusedCell,
    setPeekId,
    router,
    ensureLoaded,
    hasMore: loaded.hasMore,
    scrollToIndex: scrollToIndexRef,
    rowActionsFor: cursorRowActions,
    setMenuRequest,
    searchInput,
    cellOpenable,
    openCell: openCellRef,
  });

  // Called after `useRowCursor` on purpose: the grid's scope push has to land
  // after the table's when both flip on in one commit (see `useCellGrid`).
  const cellGrid = useCellGrid({
    table,
    data,
    editableCells,
    selectableColumnIds,
    gridRef,
    tableId,
    canSave,
    saveCell: handleCellSave,
    scrollToIndex: scrollToIndexRef,
    ensureLoaded,
    loaded,
    focusInGrid,
  });
  useEffect(() => {
    openCellRef.current = cellGrid.openCell;
  });

  // Select mode is the card list's answer to the grid's checkbox column: while
  // it is on, a card leads with a checkbox and a tap ticks the row instead of
  // opening it, since one tap cannot do both. Leaving the mode drops the
  // selection with it, so the bulk bar never outlives the mode that filled it.
  const [selectMode, setSelectMode] = useState(false);
  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    clearSelection();
  }, [clearSelection]);

  // The mode exists only where the card list does: a window that grows past
  // the phone tier swaps the list for the grid, which has its own checkbox
  // column, so the mode leaves with the list rather than waiting to come back
  // on the next resize.
  const [wasPhone, setWasPhone] = useState(isPhone);
  if (wasPhone !== isPhone) {
    setWasPhone(isPhone);
    if (!isPhone) setSelectMode(false);
  }

  // The two halves the parts read, each rebuilt only when one of its own
  // members changes: a part that reads only the config half, as every grid row
  // does, is left alone by a cursor move, a peek or a tick.
  const config = useMemo(
    (): DataTableConfigValue<TData, TChild> => ({
      table,
      data,
      entityLabel,
      canEdit,
      urlState,
      ownsUrl,
      serverDriven,
      totalRows,
      serverGroups,
      grouped,
      showCards,
      cards,
      subRows,
      topLevelRows,
      sections,
      drillInFor,
      peek,
      setPeekId,
      rowClick,
      openRow,
      enableSelection,
      setSelectAllMatching,
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
      onBulkDelete,
      actions,
      requestDelete,
      setRenaming,
      handleCellSave,
      canSave,
      rowActions,
      rowAccent,
      pinnedColumnId,
      editableCells,
      firstNavigableColumnId,
      leadingColumnCount,
      filterColumns,
      facets,
      groupByOptions,
      savedViews,
      activeGroupKey,
      newRow,
      setSelectMode,
      exitSelectMode,
      cellGrid,
      gridRef,
      gridHandlers,
      hasRows,
      emptyText,
      moveToProject,
      setMoveTarget,
      setMenuRequest,
      registerSearch: setSearchInput,
      scrollToIndex: scrollToIndexRef,
    }),
    [
      table,
      data,
      entityLabel,
      canEdit,
      urlState,
      ownsUrl,
      serverDriven,
      totalRows,
      serverGroups,
      grouped,
      showCards,
      cards,
      subRows,
      topLevelRows,
      sections,
      drillInFor,
      peek,
      setPeekId,
      rowClick,
      openRow,
      enableSelection,
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
      onBulkDelete,
      actions,
      requestDelete,
      handleCellSave,
      canSave,
      rowActions,
      rowAccent,
      pinnedColumnId,
      editableCells,
      firstNavigableColumnId,
      leadingColumnCount,
      filterColumns,
      facets,
      groupByOptions,
      savedViews,
      activeGroupKey,
      newRow,
      exitSelectMode,
      cellGrid,
      gridHandlers,
      hasRows,
      emptyText,
      moveToProject,
      scrollToIndexRef,
    ]
  );

  const state = useMemo(
    (): DataTableStateValue<TData> => ({
      cursorRowId,
      peekId,
      expanded,
      selectedIds,
      selectAllMatching,
      canSelectAllMatching,
      bulkSelection,
      renaming,
      draft,
      selectMode,
      moveTarget,
      menuRequest,
      loaded,
      loadMore,
      ensureLoaded,
      retryLoad,
    }),
    [
      cursorRowId,
      peekId,
      expanded,
      selectedIds,
      selectAllMatching,
      canSelectAllMatching,
      bulkSelection,
      renaming,
      draft,
      selectMode,
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
        <RowDeleteContext value={canDelete ? requestRowDelete : null}>
          <div>
            {children}

            <ConfirmDeleteDialog
              {...deletion.dialog}
              title={`Delete ${deletion.pending?.label ?? entityLabel}?`}
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
