"use client";

import {
  type GroupSummary,
  type Section,
  sectionDrillIn,
  sectionize,
} from "@/components/tables/group-sections";
import { usePeekRow } from "@/components/tables/use-peek-row";
import { useSetting } from "@/lib/settings/provider";
import type { RowData } from "@tanstack/react-table";
import { useIsMobile } from "@workspace/ui/hooks/use-mobile";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { TableRowModel } from "./data-table-context";
import type { DataTableProps } from "./generic-table-types";
import { EXPAND_COLUMN, SELECT_COLUMN } from "./leading-columns";
import { rowIdOf } from "./row-id";
import { useTableLocalState } from "./use-table-local-state";

type TableViewInput<TData extends RowData, TChild = never> = Pick<
  DataTableProps<TData, TChild>,
  | "columns"
  | "editableCells"
  | "navigableColumns"
  | "initiallyHiddenColumns"
  | "subRows"
  | "urlState"
  | "serverPage"
  | "groupByOptions"
  | "peek"
  | "cards"
  | "emptyText"
  | "filterColumns"
  | "facets"
  | "savedViews"
  | "serverGroups"
  | "rowAccent"
  | "pinnedColumnId"
>;

/**
 * Resolves a table's view configuration: leading disclosure/selection columns,
 * URL vs local state ownership, default-merged `columnVisibility`, grouping
 * metadata, `peek` / `openRow` navigation, phone card tier, and sub-row
 * expansion state.
 */
export function useTableView<TData extends RowData, TChild = never>(
  input: TableViewInput<TData, TChild>,
  enableSelection: boolean
) {
  const {
    columns: inputColumns,
    editableCells: ungatedEditableCells,
    navigableColumns,
    initiallyHiddenColumns,
    subRows,
    urlState: urlSource,
    serverPage,
    groupByOptions,
    peek: peekProp,
    cards,
    emptyText = "No results.",
    filterColumns,
    facets,
    savedViews,
    serverGroups,
    rowAccent,
    pinnedColumnId,
  } = input;

  // `inUrl` configures the peek hook below; the rest is the config parts read.
  const peekInUrl = peekProp?.inUrl ?? false;
  const peek = useMemo(() => {
    if (!peekProp) return undefined;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { inUrl, ...config } = peekProp;
    return config;
  }, [peekProp]);

  const [peekId, setPeekId] = usePeekRow(peekInUrl);
  // Whether the open peek row's title is being edited (transient, never in URL).
  const [renaming, setRenaming] = useState(false);
  const router = useRouter();
  const rowClick = useSetting("tables.rowClick");
  // The same path the row cursor's `open` move takes (`use-row-cursor.ts`).
  const openRow = useCallback(
    (rowData: TData) => {
      if (peek) router.push(peek.href(rowData));
    },
    [peek, router]
  );

  // Built from the ungated prop: a viewer's grid is navigable and copyable,
  // while `entryOf` makes every cell of it read-only.
  const selectableColumnIds = useMemo(
    () => new Set(navigableColumns ?? Object.keys(ungatedEditableCells ?? {})),
    [navigableColumns, ungatedEditableCells]
  );

  const hierarchyEnabled = Boolean(subRows);

  // Prepend disclosure and selection columns when enabled; memoized on inputs
  // so the table's column model is not rebuilt on unrelated renders.
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

  // A table given a URL source owns the page URL; every other table keeps the
  // same view state in React so parts read one shape either way.
  const localState = useTableLocalState();
  const ownsUrl = urlSource != null;
  const urlState = urlSource ?? localState;

  // Only a table whose state travels in the URL can hand the server sorts and
  // filters on every change; an embedded table processes loaded rows locally.
  const serverDriven = Boolean(serverPage) && ownsUrl;

  const groupingEnabled = (groupByOptions?.length ?? 0) > 0;
  const activeGroupKey = urlState.state.grouping[0] ?? null;
  const activeGroupOption = groupByOptions?.find(
    (o) => o.id === activeGroupKey
  );
  // Only a group key the table offers groups the server's page; a stale or
  // hand-edited `?group=` pages normally and must not stop the window.
  const grouped = activeGroupOption != null;
  const groupFilterParam = activeGroupOption?.filterParam;

  // Deferring the search term keeps input responsive on locally filtered tables.
  const deferredGlobalFilter = useDeferredValue(urlState.state.globalFilter);
  const globalFilter = serverDriven
    ? urlState.state.globalFilter
    : deferredGlobalFilter;

  // An absent column in `columnVisibility` reads as visible, so
  // `initiallyHiddenColumns` is merged in only while the URL says nothing about it.
  const columnVisibility = useMemo(() => {
    const fromDefaults = Object.fromEntries(
      (initiallyHiddenColumns ?? [])
        .filter((id) => !(id in urlState.state.columnVisibility))
        .map((id) => [id, false])
    );
    return { ...fromDefaults, ...urlState.state.columnVisibility };
  }, [initiallyHiddenColumns, urlState.state.columnVisibility]);

  // Row expansion is transient disclosure state keyed by `getRowId`.
  const [expanded, setExpanded] = useState<true | Record<string, boolean>>({});
  const onExpandedChange = useCallback((updater: unknown) => {
    setExpanded((prev) =>
      typeof updater === "function"
        ? (updater as (p: typeof prev) => typeof prev)(prev)
        : (updater as typeof prev)
    );
  }, []);

  // Child rows are a different entity than the parent's row type.
  const getSubRows = useMemo(
    () =>
      subRows
        ? (row: TData) => subRows.getRows(row) as unknown as TData[] | undefined
        : undefined,
    [subRows]
  );

  // Below the phone breakpoint rows render as stacked cards when configured.
  const isPhone = useIsMobile();
  const showCards = isPhone && cards != null && peek != null;

  const tableState = {
    globalFilter,
    sorting: urlState.state.sorting,
    columnVisibility,
    columnOrder: urlState.state.columnOrder,
    columnSizing: urlState.state.columnSizing,
    ...(hierarchyEnabled ? { expanded } : {}),
  };

  const tableOptions = {
    columns,
    ...(getSubRows ? { getSubRows } : {}),
    ...(serverDriven && serverPage
      ? { manualFiltering: true, manualSorting: true }
      : {}),
    onGlobalFilterChange: urlState.setGlobalFilter,
    onSortingChange: urlState.setSorting,
    onColumnVisibilityChange: urlState.setColumnVisibility,
    onColumnOrderChange: urlState.setColumnOrder,
    onColumnSizingChange: urlState.setColumnSizing,
    ...(hierarchyEnabled ? { onExpandedChange } : {}),
  };

  const config = useMemo(
    () => ({
      urlState,
      ownsUrl,
      serverDriven,
      grouped,
      showCards,
      cards,
      subRows,
      peek,
      setPeekId,
      rowClick,
      openRow,
      setRenaming,
      leadingColumnCount,
      groupByOptions,
      activeGroupKey,
      emptyText,
      filterColumns,
      facets,
      savedViews,
      serverGroups,
      rowAccent,
      pinnedColumnId,
    }),
    [
      urlState,
      ownsUrl,
      serverDriven,
      grouped,
      showCards,
      cards,
      subRows,
      peek,
      setPeekId,
      rowClick,
      openRow,
      leadingColumnCount,
      groupByOptions,
      activeGroupKey,
      emptyText,
      filterColumns,
      facets,
      savedViews,
      serverGroups,
      rowAccent,
      pinnedColumnId,
    ]
  );

  const state = useMemo(
    () => ({
      peekId,
      expanded,
      renaming,
    }),
    [peekId, expanded, renaming]
  );

  return {
    columns,
    selectableColumnIds,
    urlState,
    serverDriven,
    columnVisibility,
    groupingEnabled,
    activeGroupKey,
    groupFilterParam,
    grouped,
    peek,
    setPeekId,
    setRenaming,
    openRow,
    router,
    isPhone,
    showCards,
    expanded,
    tableState,
    tableOptions,
    config,
    state,
  };
}

/**
 * Announces every expanded top-level row once per `inputData` snapshot so lazy
 * hierarchies fetch on expansion, on appended pages, and again after a parent
 * refetch.
 */
export function useExpandedAnnounce<TData extends RowData>(
  inputData: TData[],
  data: TData[],
  expanded: true | Record<string, boolean>,
  onExpand: ((row: TData) => void) | undefined
) {
  const announcedRef = useRef({ data: inputData, ids: new Set<string>() });

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
}

type UseTableSectionsOptions<TData extends RowData> = {
  pageRows: TableRowModel<TData>[];
  groupingEnabled: boolean;
  activeGroupKey: string | null;
  groupFilterParam: string | undefined;
  getRowGroupKey:
    ((row: TData, groupKey: string) => string | string[] | null) | undefined;
  serverGroups: GroupSummary[] | undefined;
};

/**
 * Derives top-level rows, grouped sections (`sectionize`), and per-section
 * drill-in filter links (`sectionDrillIn`) from the table's row model.
 */
export function useTableSections<TData extends RowData>({
  pageRows,
  groupingEnabled,
  activeGroupKey,
  groupFilterParam,
  getRowGroupKey,
  serverGroups,
}: UseTableSectionsOptions<TData>) {
  const topLevelRows = useMemo(
    () => pageRows.filter((row) => row.depth === 0),
    [pageRows]
  );

  const sections = useMemo(
    (): Section<TableRowModel<TData>>[] | null =>
      groupingEnabled && activeGroupKey && getRowGroupKey
        ? sectionize(
            pageRows,
            (row) => getRowGroupKey(row.original as TData, activeGroupKey),
            serverGroups ?? []
          )
        : null,
    [groupingEnabled, activeGroupKey, getRowGroupKey, pageRows, serverGroups]
  );

  // Only top-level rows count against a group's total; expanded children must
  // not make an incomplete preview read as complete.
  const drillInFor = useCallback(
    (section: Section<TableRowModel<TData>>) =>
      sectionDrillIn(
        { ...section, rows: section.rows.filter((row) => row.depth === 0) },
        groupFilterParam
      ),
    [groupFilterParam]
  );

  return { topLevelRows, sections, drillInFor };
}
