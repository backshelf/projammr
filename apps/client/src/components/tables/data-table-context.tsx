"use client";

import type { RowData } from "@tanstack/react-table";
import {
  createContext,
  type Dispatch,
  type ReactNode,
  type RefObject,
  type SetStateAction,
  use,
  useMemo,
} from "react";

import type { BulkSelection } from "@/entities/api";
import type { Status } from "@workspace/api/api";
import type { SettingsValues } from "@workspace/settings";

import type { DataTableInstance, useAppTable } from "./data-table-hook";
import type { CellValue, DataTableProps } from "./generic-table-types";
import type { Section, sectionDrillIn } from "./group-sections";
import type { DraftState } from "./parts/Draft";
import type { RowMenuRequest } from "./RowActions";
import type { useCellGrid } from "./use-cell-grid";
import type { LoadedStatus } from "./use-loaded-window";
import type { useRowCursor } from "./use-row-cursor";
import type { useTableUrlState } from "./use-table-url-state";

/** One row of the table's row model. */
export type TableRowModel<TData extends RowData> = ReturnType<
  ReturnType<typeof useAppTable<TData>>["getRowModel"]
>["rows"][number];

/**
 * What a "Move to project" asked to move: the row a row action chose, or the
 * bulk bar's selection (also the target of a row menu's Move when that row
 * sits inside a multi-row selection).
 */
export type MoveTarget<TData extends RowData> =
  | { row: TData; id: number; name: string }
  | { selection: BulkSelection; count: number };

/** A delete asked for from a row's menu or the bulk bar, and how it is named. */
export type PendingDelete = { selection: BulkSelection; label: string };

/**
 * The half of the data table root's shared state that holds still while the
 * table is used: the table, its rows, the column and feature config, the
 * handlers and every setter. It changes with the root's props, its rows and the
 * table's own state (columns, sorting, the cell grid's selection), never on a
 * cursor move, a peek or a tick, so a part that reads only this half is not
 * re-rendered by them. Each member is named after the root local it exposes.
 */
export type DataTableConfigValue<TData extends RowData, TChild = never> = {
  /**
   * The table, held across renders until its selected state, its columns or
   * its rows change; its methods always read the live instance.
   */
  table: DataTableInstance<TData>;
  data: TData[];
  entityLabel: string;
  canEdit: boolean;
  /** The view state: the root's URL source when given, else its local one. */
  urlState: ReturnType<typeof useTableUrlState>;
  /** Whether the root was given a URL state source, so its state travels there. */
  ownsUrl: boolean;
  serverDriven: boolean;
  totalRows: number;
  serverGroups: DataTableProps<TData, TChild>["serverGroups"];
  grouped: boolean;
  showCards: boolean;
  cards: DataTableProps<TData, TChild>["cards"];
  subRows: DataTableProps<TData, TChild>["subRows"];
  /** Top-level rows of the current page, children excluded. */
  topLevelRows: TableRowModel<TData>[];
  /** The page's rows split by the active grouping; null when ungrouped. */
  sections: Section<TableRowModel<TData>>[] | null;
  /** Where a section's "Show all" goes, or null when the page holds the group. */
  drillInFor: (
    section: Section<TableRowModel<TData>>
  ) => ReturnType<typeof sectionDrillIn>;
  peek: DataTableProps<TData, TChild>["peek"];
  setPeekId: (id: number | null) => void;
  /** `tables.rowClick`: whether a click on a peekable top-level row peeks it
   *  or opens its page. */
  rowClick: SettingsValues["tables.rowClick"];
  /** Opens a row's page, the same path the row cursor's `open` move takes. */
  openRow: (rowData: TData) => void;
  /** Whether rows can be selected (`enableSelection` and `canEdit`). */
  enableSelection: boolean;
  setSelectAllMatching: (all: boolean) => void;
  clearSelection: () => void;
  /** The bulk status menu's statuses, in pipeline order. */
  orderedStatuses: Status[] | undefined;
  bulkCollections: DataTableProps<TData, TChild>["bulkCollections"];
  bulkLabels: DataTableProps<TData, TChild>["bulkLabels"];
  bulkPriorityLevels: DataTableProps<TData, TChild>["bulkPriorityLevels"];
  bulkFields: DataTableProps<TData, TChild>["bulkFields"];
  /** Undefined unless the table can edit. */
  onBulkPatch: DataTableProps<TData, TChild>["onBulkPatch"];
  /** Undefined unless the table can edit. */
  onBulkAddToCollection: DataTableProps<TData, TChild>["onBulkAddToCollection"];
  /** Undefined unless the table can edit. */
  onBulkSetLabels: DataTableProps<TData, TChild>["onBulkSetLabels"];
  /** Undefined unless the table can edit. */
  onBulkMove: DataTableProps<TData, TChild>["onBulkMove"];
  /** Undefined unless the table can edit. */
  onBulkDelete: DataTableProps<TData, TChild>["onBulkDelete"];
  /** Undefined unless the table can edit. */
  actions: DataTableProps<TData, TChild>["actions"];
  /**
   * Asks to delete `selection` through the policy's gate: the shared confirm
   * opens, or the delete runs at once when the table's kind does not ask.
   */
  requestDelete: (pending: PendingDelete) => void;
  setRenaming: (renaming: boolean) => void;
  handleCellSave: (
    rowId: number,
    field: string,
    value: CellValue
  ) => Promise<boolean>;
  /**
   * Whether the table saves cell edits at all: `onCellSave` is set and the
   * viewer can edit. False for a viewer.
   */
  canSave: boolean;
  /** The row menu's config; a viewer's copy has no `onDelete`. */
  rowActions: DataTableProps<TData, TChild>["rowActions"];
  rowAccent: DataTableProps<TData, TChild>["rowAccent"];
  reorder: DataTableProps<TData, TChild>["reorder"];
  pinnedColumnId: DataTableProps<TData, TChild>["pinnedColumnId"];
  /** Undefined unless the table can edit. */
  editableCells: DataTableProps<TData, TChild>["editableCells"];
  /** The first column the cell grid can navigate to; it holds the tab stop until a cell has focus. */
  firstNavigableColumnId: string | undefined;
  /** How many columns the table puts before the caller's own (disclosure, selection). */
  leadingColumnCount: number;
  filterColumns: DataTableProps<TData, TChild>["filterColumns"];
  filterPresets: DataTableProps<TData, TChild>["filterPresets"];
  facets: DataTableProps<TData, TChild>["facets"];
  groupByOptions: DataTableProps<TData, TChild>["groupByOptions"];
  savedViews: DataTableProps<TData, TChild>["savedViews"];
  activeGroupKey: string | null;
  /** Undefined unless the table can edit. */
  newRow: DataTableProps<TData, TChild>["newRow"];
  setSelectMode: Dispatch<SetStateAction<boolean>>;
  /** Leaves select mode and drops the selection it made. */
  exitSelectMode: () => void;
  /**
   * The cell grid's wiring. It changes with the cell grid's selection and the
   * cell being edited, which every row draws.
   */
  cellGrid: ReturnType<typeof useCellGrid<TData>>;
  /** The grid wrapper's element, which the cell grid and the row cursor read. */
  gridRef: RefObject<HTMLDivElement | null>;
  /** The wrapper's pointer and focus handlers, which feed the row cursor. */
  gridHandlers: ReturnType<typeof useRowCursor>["gridHandlers"];
  /** Whether the current page has any rows. */
  hasRows: boolean;
  /** What the empty state says. */
  emptyText: string;
  /** Undefined when the table cannot move rows, which includes a viewer. */
  moveToProject: DataTableProps<TData, TChild>["moveToProject"];
  setMoveTarget: (target: MoveTarget<TData> | null) => void;
  /** Opens a row's `⋯` menu with a submenu open; `null` drops the request. */
  setMenuRequest: (request: RowMenuRequest | null) => void;
  /** Hands the table the element its search field is, or `null` when it goes. */
  registerSearch: (input: HTMLInputElement | null) => void;
  /**
   * Scrolls the grid to a row index — the row's position in `pageRows`, the
   * same order the row cursor and the loaded window use, not the flattened
   * item list `GridSections` virtualises (a group's header is one of its
   * slots too; `GridSections` translates between the two) — or does nothing
   * while the grid is on the card tier or holds no virtualiser (an empty
   * table, or a page with no scroll root). Set by `GridSections` in an effect
   * once its virtualiser exists, and cleared on unmount; a ref so a caller
   * does not re-render on every scroll.
   */
  scrollToIndex: RefObject<((index: number) => void) | null>;
};

/**
 * The half of the data table root's shared state that changes as the table is
 * used: the row cursor, the open peek row, the selection, the expanded rows,
 * the draft, the move target and how far the loaded rows reach. Its setters are
 * config: they never change, and a part that only writes one of these has no
 * reason to re-render on it. The loaders sit here beside `loaded`, and keep
 * their identity just the same.
 */
export type DataTableStateValue<TData extends RowData> = {
  /** The top-level row the keyboard cursor is on, by row id. */
  cursorRowId: string | null;
  peekId: number | null;
  /** Expanded rows by id; `true` is every row. */
  expanded: true | Record<string, boolean>;
  selectedIds: number[];
  selectAllMatching: boolean;
  canSelectAllMatching: boolean;
  /** What a bulk action targets: the ticked ids, or every row the filter matches. */
  bulkSelection: BulkSelection;
  /** Whether the open peek row's title is being edited. */
  renaming: boolean;
  /** The draft slices the toggle, the draft rows and section headers share. */
  draft: DraftState;
  /** Phone select mode: cards lead with a checkbox while it is on. */
  selectMode: boolean;
  moveTarget: MoveTarget<TData> | null;
  /** The row menu a key asked to open, until that menu closes. */
  menuRequest: RowMenuRequest | null;
  /** How far the loaded rows reach and whether their next page is on its way. */
  loaded: LoadedStatus;
  /**
   * Appends the next page; a call while one loads shares its promise. Settles
   * once the page has committed, or at once when there is nothing to load.
   */
  loadMore: () => Promise<void>;
  /**
   * Loads pages until row-model index `index` (`table.getRowModel().rows`)
   * exists: true once it has committed, false when a page fails or nothing
   * more is left to load. A locally filtered table's row model can be
   * shorter than the loaded window, so this keeps loading past a window
   * that already holds `index` while the row model does not yet.
   */
  ensureLoaded: (index: number) => Promise<boolean>;
  /** Fetches the page that failed again. */
  retryLoad: () => Promise<void>;
};

/** Both halves of the data table root's shared state, as one value. */
export type DataTableContextValue<
  TData extends RowData,
  TChild = never,
> = DataTableConfigValue<TData, TChild> & DataTableStateValue<TData>;

// A context cannot carry the provider's row type, so each half is held with it
// erased: `DataTableProvider` widens it on the way in and the hooks narrow it
// back for their caller. Both are casts because Table v9's recursive column
// types never let a table of one row type assign to a table of `any`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above
type AnyDataTableConfigValue = DataTableConfigValue<any, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above
type AnyDataTableStateValue = DataTableStateValue<any>;

const DataTableConfigContext = createContext<AnyDataTableConfigValue | null>(
  null
);

const DataTableStateContext = createContext<AnyDataTableStateValue | null>(
  null
);

/**
 * Provides both halves. Each must keep its identity until one of its members
 * changes — the root memoises each on its members — since every reader of a
 * half re-renders when the half's identity changes.
 */
export function DataTableProvider<TData extends RowData, TChild = never>({
  config,
  state,
  children,
}: {
  config: DataTableConfigValue<TData, TChild>;
  state: DataTableStateValue<TData>;
  children: ReactNode;
}): ReactNode {
  return (
    <DataTableConfigContext value={config as AnyDataTableConfigValue}>
      <DataTableStateContext value={state as AnyDataTableStateValue}>
        {children}
      </DataTableStateContext>
    </DataTableConfigContext>
  );
}

function outsideProvider(hook: string): Error {
  return new Error(`\`${hook}\` must be used within a \`DataTableProvider\`.`);
}

/**
 * The nearest data table root's config half; throws outside a
 * `DataTableProvider`.
 */
export function useDataTableConfig<
  TData extends RowData,
  TChild = never,
>(): DataTableConfigValue<TData, TChild> {
  const config = use(DataTableConfigContext);
  if (config === null) throw outsideProvider("useDataTableConfig");
  return config as DataTableConfigValue<TData, TChild>;
}

/**
 * The nearest data table root's state half; throws outside a
 * `DataTableProvider`.
 */
export function useDataTableState<
  TData extends RowData,
>(): DataTableStateValue<TData> {
  const state = use(DataTableStateContext);
  if (state === null) throw outsideProvider("useDataTableState");
  return state as DataTableStateValue<TData>;
}

/**
 * Both halves of the nearest data table root's state, merged; throws outside
 * a `DataTableProvider`. A reader of this re-renders when either half changes.
 */
export function useDataTable<
  TData extends RowData,
  TChild = never,
>(): DataTableContextValue<TData, TChild> {
  const config = use(DataTableConfigContext);
  const state = use(DataTableStateContext);
  const merged = useMemo(
    () => (config && state ? { ...config, ...state } : null),
    [config, state]
  );
  if (merged === null) throw outsideProvider("useDataTable");
  return merged as DataTableContextValue<TData, TChild>;
}
