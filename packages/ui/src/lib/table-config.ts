import type { RowData } from "@tanstack/react-table";
import {
  cellSelectionFeature,
  columnFilteringFeature,
  columnOrderingFeature,
  columnResizingFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  createColumnHelper,
  createExpandedRowModel,
  createFilteredRowModel,
  createSortedRowModel,
  filterFn_includesString,
  globalFilteringFeature,
  metaHelper,
  rowExpandingFeature,
  rowSelectionFeature,
  rowSortingFeature,
  tableFeatures,
} from "@tanstack/react-table";

/** What a column carries in its `meta`. */
export type DataTableColumnMeta = {
  /** Suppresses the header's sort-direction icon so a short fixed-width
   *  header (`idColumn`'s "ID") never loses characters to it. The column
   *  still sorts on a header click. */
  hideSortIndicator?: boolean;
  /** The heading the column menu lists this column under ("Fields" for a
   *  project's custom fields). Columns with none are listed first, under no
   *  heading. */
  group?: string;
};

/**
 * The feature slots shared by every DataTable. Exported so a caller that
 * needs a variant features object (e.g. a custom filtered row model) can
 * spread these and override a single slot without re-declaring the rest.
 */
export const dataTableFeatureSlots = {
  rowSortingFeature,
  columnFilteringFeature,
  columnVisibilityFeature,
  columnOrderingFeature,
  rowSelectionFeature,
  globalFilteringFeature,
  columnSizingFeature,
  columnResizingFeature,
  cellSelectionFeature,
  rowExpandingFeature,
  sortedRowModel: createSortedRowModel(),
  expandedRowModel: createExpandedRowModel(),
  filterFns: {
    includesString: filterFn_includesString,
  },
};

export const dataTableFeatures = tableFeatures({
  ...dataTableFeatureSlots,
  filteredRowModel: createFilteredRowModel(),
  columnMeta: metaHelper<DataTableColumnMeta>(),
});

export function createDataTableHelper<TData extends RowData>() {
  return createColumnHelper<typeof dataTableFeatures, TData>();
}

/**
 * A data-table column array, as produced by `createDataTableHelper().columns()`.
 * `columns()` returns `Array<ColumnDef> & [...tuple]` to preserve each column's
 * value type; this alias names that return so a table component can type its
 * `columns` prop without re-deriving it.
 */
export type DataTableColumns<TData extends RowData> = ReturnType<
  ReturnType<typeof createDataTableHelper<TData>>["columns"]
>;

/**
 * Default per-column sizing for data tables. A column with no explicit `size`
 * starts at `size` px and can be dragged between `minSize` and `maxSize`.
 *
 * `sortUndefined: "last"` keeps rows with a null/undefined accessor value at
 * the bottom in both directions, so the many nullable music-metadata columns
 * (bpm, isrc, key, …) don't scatter null rows through the middle of a sort.
 */
export const dataTableDefaultColumn = {
  size: 160,
  minSize: 60,
  maxSize: 600,
  sortUndefined: "last" as const,
};

export const dataTableColumnResizeMode = "onChange" as const;
