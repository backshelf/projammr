"use client";

import {
  createTableHook,
  type RowData,
  type TableState,
} from "@tanstack/react-table";
import { useMemo } from "react";
import {
  dataTableColumnResizeMode,
  dataTableDefaultColumn,
  dataTableFeatures,
} from "@workspace/ui/lib/table-config";

import { PeekHandle } from "./cell-components";
import {
  cellContext,
  headerContext,
  tableContext,
} from "./table-hook-contexts";

/**
 * The data table's table hook: its features and the options every data table
 * shares, bound once. `useAppTable` takes the rest per table, and
 * `useTableContext` reads the table the nearest `table.AppTable` provides.
 *
 * Registers only the cell components, which read their cell and the root's
 * state through modules this one does not import back: a part imports this
 * module, so this module imports no part. The table and header maps are passed
 * empty rather than left out, which would type every name on the table as a
 * registered component.
 */
export const { useAppTable, createAppColumnHelper } = createTableHook({
  features: dataTableFeatures,
  tableContext,
  cellContext,
  headerContext,
  tableComponents: {},
  cellComponents: { PeekHandle },
  headerComponents: {},
  defaultColumn: dataTableDefaultColumn,
  columnResizeMode: dataTableColumnResizeMode,
});

/** What the data table root selects from its table's state. */
export type RootTableState = Omit<
  TableState<typeof dataTableFeatures>,
  "rowSelection"
>;

/**
 * The data table root's selector: every state slice but row selection. Row
 * selection is the root's own React state, so the root re-renders on it
 * without the table's help; leaving it out keeps a tick from changing
 * `table.state`, and with it the held table every row draws from. A row learns
 * of its own tick from its `selected` prop instead.
 */
export function selectRootTableState({
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  rowSelection,
  ...state
}: TableState<typeof dataTableFeatures>): RootTableState {
  return state;
}

/** The table the data table root builds and hands its parts. */
export type DataTableInstance<TData extends RowData> = ReturnType<
  typeof useAppTable<TData, RootTableState>
>;

/**
 * `table`, held across renders until its selected state, its columns or its
 * rows change. The table `useAppTable` returns is a fresh object every render,
 * since its options are rebuilt each time, yet every method on it reads the one
 * core instance's live state: only `state` and `options` belong to the render.
 * The held copy changes identity exactly when something drawn from it can, so
 * a memoised value that holds it is not rebuilt on every render.
 */
export function useHeldTable<TTable extends { state: unknown }>(
  table: TTable,
  columns: unknown,
  data: unknown
): TTable {
  // eslint-disable-next-line react-hooks/exhaustive-deps, @eslint-react/exhaustive-deps -- keyed on what the table draws from, not on its per-render identity; see above
  return useMemo(() => table, [table.state, columns, data]);
}
