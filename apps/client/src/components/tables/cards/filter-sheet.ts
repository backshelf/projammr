import { columnLabel, type LabelledColumn } from "../column-label";
import type { FilterColumnConfig } from "../generic-table-types";
import type { ColumnFilterState } from "../use-table-url-state";

/**
 * How many of a table's server-side filters currently have a value set. Drives
 * both the phone toolbar's "Filter" badge and the sheet's own filter section,
 * so the two never disagree about what counts as active.
 */
export function activeFilterCount(
  columnFilters: ColumnFilterState,
  filterColumns: FilterColumnConfig[] | undefined
): number {
  if (!filterColumns) return 0;
  return filterColumns.filter((fc) => Boolean(columnFilters[fc.param])).length;
}

/** The slice of a TanStack leaf column the sheet's Sort section needs. */
export type SortableColumn = LabelledColumn & {
  getIsSorted: () => false | "asc" | "desc";
  toggleSorting: () => void;
};

export type SortRow = {
  id: string;
  label: string;
  direction: false | "asc" | "desc";
  /** Cycles the column asc → desc → none, through the column's own API. */
  toggle: () => void;
};

/**
 * Sortable columns as sheet rows: the column's own name, its current
 * direction, and a toggle that delegates to the column itself rather than
 * reimplementing TanStack's own asc/desc/none cycle.
 */
export function sortRowsFrom(columns: SortableColumn[]): SortRow[] {
  return columns.map((column) => ({
    id: column.id,
    label: columnLabel(column),
    direction: column.getIsSorted(),
    toggle: () => column.toggleSorting(),
  }));
}
