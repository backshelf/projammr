"use client";

import { IconFilter, IconRestore, IconSearch } from "@tabler/icons-react";
import type { RowData } from "@tanstack/react-table";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { cn } from "@workspace/ui/lib/utils";
import dynamic from "next/dynamic";
import { type ReactNode, useCallback, useMemo, useState } from "react";

import { activeFilterCount } from "../cards/filter-sheet";
import { columnLabel, type LabelledColumn } from "../column-label";
import { useDataTable } from "../data-table-context";
import { FilterMenu } from "../filter-controls";
import { ColumnSettingsMenu, GroupByMenu } from "../toolbar-menus";

// The sheet's Collapsible sections and save-view form are dead weight on a
// desktop, which never mounts the button that opens it — split into its own
// chunk the same way `QueuePopover` defers `QueueList`.
const FilterSheet = dynamic(
  () => import("../cards/FilterSheet").then((m) => m.FilterSheet),
  { ssr: false }
);

/** The table's free-text filter. The two toolbars sit it in different room —
 *  a fixed column on a desktop, the rest of the row on a phone — so the width
 *  is the caller's to give. */
function TableSearch({
  value,
  onChange,
  className,
  touch,
  inputRef,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  /** Receives the input element on mount and `null` on unmount. */
  inputRef?: (input: HTMLInputElement | null) => void;
  /**
   * Sized for a finger, for the toolbar that sits it beside a 44px button.
   * Only the height: `Input` already carries 16px text below `md`, which is
   * what stops iOS zooming the page when the field takes focus.
   */
  touch?: boolean;
}) {
  return (
    <div className={cn("relative", className)}>
      <IconSearch className="pointer-events-none absolute top-1/2 left-2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
      <Input
        ref={inputRef}
        type="search"
        placeholder="Search..."
        aria-label="Search the table"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn("z-10 pl-8", touch && "coarse:h-11")}
      />
    </div>
  );
}

/**
 * The table's two toolbars: a desktop row of search, filter, group, saved-view
 * and column menus, and a phone row of search and a "Filter" button that opens
 * the sheet those menus collapse into. Which of them are hidden is CSS, so both
 * are always rendered. `children` sit in the desktop row between group-by and
 * the column menu, where the caller places extra controls such as `SavedViews`.
 */
export function Toolbar<TData extends RowData, TChild = never>({
  children,
}: {
  children?: ReactNode;
}) {
  const {
    table,
    urlState,
    ownsUrl,
    filterColumns,
    facets,
    groupByOptions,
    savedViews,
    enableSelection,
    activeGroupKey,
    selectMode,
    setSelectMode,
    registerSearch,
  } = useDataTable<TData, TChild>();

  const columnVisibility = table.state.columnVisibility;
  const groupingEnabled = (groupByOptions?.length ?? 0) > 0;

  // Hideable columns in their current visual order, for the column menu, the
  // ungrouped ones first and each group's after them (a sort that keeps the
  // visual order within each). The menu's up/down arrows and the checkboxes
  // both write column state, which `useTableUrlState` mirrors into the URL.
  const orderedColumnControls = useMemo(() => {
    const order = urlState.state.columnOrder;
    const rank = (id: string) => {
      const i = order.indexOf(id);
      return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    };
    return table
      .getAllLeafColumns()
      .filter((c: { getCanHide: () => boolean }) => c.getCanHide())
      .sort((a: { id: string }, b: { id: string }) => rank(a.id) - rank(b.id))
      .map(
        (
          column: LabelledColumn & {
            columnDef: { meta?: { group?: string } };
            toggleVisibility: (v: boolean) => void;
          }
        ) => ({
          id: column.id,
          label: columnLabel(column),
          group: column.columnDef.meta?.group,
          isVisible: columnVisibility[column.id] !== false,
          toggleVisibility: (v: boolean) => column.toggleVisibility(v),
        })
      )
      .sort(
        (a: { group?: string }, b: { group?: string }) =>
          Number(a.group !== undefined) - Number(b.group !== undefined)
      );
  }, [table, urlState.state.columnOrder, columnVisibility]);

  // The menu lists only hideable columns, but `columnOrder` must name every
  // leaf column: a partial array reorders the columns it omits to the end.
  // A move is therefore resolved against the menu's neighbours and then
  // applied to the full order, so pinned and non-hideable columns stay put.
  const moveColumn = useCallback(
    (id: string, delta: number) => {
      const menuIds = orderedColumnControls.map((c) => c.id);
      const menuFrom = menuIds.indexOf(id);
      const menuTo = menuFrom + delta;
      if (menuFrom < 0 || menuTo < 0 || menuTo >= menuIds.length) return;

      const allIds = table.getAllLeafColumns().map((c: { id: string }) => c.id);
      const from = allIds.indexOf(id);
      const to = allIds.indexOf(menuIds[menuTo]!);
      if (from < 0 || to < 0) return;

      const next = allIds.slice();
      next.splice(to, 0, next.splice(from, 1)[0]!);
      table.setColumnOrder(next);
    },
    [orderedColumnControls, table]
  );

  // The phone toolbar's "Filter" button opens this in place of the five
  // desktop menus. Loaded on first tap rather than with the table — its
  // Collapsible sections and the save-view form are dead weight on desktop,
  // which never mounts the button that opens it.
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [filterSheetLoaded, setFilterSheetLoaded] = useState(false);
  const sortableColumns = table
    .getAllLeafColumns()
    .filter((c: { getCanSort: () => boolean }) => c.getCanSort());
  const filterCount = activeFilterCount(
    urlState.state.columnFilters,
    ownsUrl ? filterColumns : undefined
  );

  return (
    <>
      <div className="relative z-10 hidden flex-wrap items-center gap-2 py-2 md:flex">
        <TableSearch
          value={urlState.state.globalFilter}
          onChange={(value) => table.setGlobalFilter(value)}
          className="max-w-xs"
          inputRef={registerSearch}
        />

        {ownsUrl &&
          filterColumns?.map((fc) => (
            <FilterMenu
              key={fc.param}
              config={fc}
              value={urlState.state.columnFilters[fc.param] ?? null}
              counts={facets?.[fc.param] ?? {}}
              onChange={(value) => urlState.setColumnFilter(fc.param, value)}
            />
          ))}

        {ownsUrl && groupingEnabled && (
          <GroupByMenu
            options={groupByOptions ?? []}
            active={activeGroupKey}
            onChange={(id) => urlState.setGrouping(id ? [id] : [])}
          />
        )}

        {children}

        {ownsUrl && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => urlState.applyViewQuery("")}
          >
            <IconRestore className="h-4 w-4" />
            Reset view
          </Button>
        )}

        <div className="ml-auto">
          <ColumnSettingsMenu
            columns={orderedColumnControls}
            onMove={moveColumn}
            onResetWidths={() => table.resetColumnSizing()}
          />
        </div>
      </div>

      <div className="relative z-10 flex items-center gap-2 py-2 md:hidden">
        <TableSearch
          value={urlState.state.globalFilter}
          onChange={(value) => table.setGlobalFilter(value)}
          className="flex-1"
          touch
        />
        <Button
          variant="outline"
          size="lg"
          aria-label={
            filterCount > 0 ? `Filter (${filterCount} active)` : "Filter"
          }
          onClick={() => {
            setFilterSheetLoaded(true);
            setFilterSheetOpen(true);
          }}
        >
          <IconFilter className="h-4 w-4" aria-hidden />
          <span aria-hidden>Filter</span>
          {filterCount > 0 && (
            <Badge variant="secondary" aria-hidden>
              {filterCount}
            </Badge>
          )}
        </Button>
        {filterSheetLoaded && (
          <FilterSheet
            open={filterSheetOpen}
            onOpenChange={setFilterSheetOpen}
            filterColumns={ownsUrl ? filterColumns : undefined}
            columnFilters={urlState.state.columnFilters}
            facets={facets}
            onFilterChange={urlState.setColumnFilter}
            sortColumns={sortableColumns}
            groupByOptions={ownsUrl ? groupByOptions : undefined}
            activeGroupKey={activeGroupKey}
            onGroupChange={(id) => urlState.setGrouping(id ? [id] : [])}
            savedViews={ownsUrl ? savedViews : undefined}
            onApplyView={urlState.applyViewQuery}
            viewQuery={urlState.viewQuery}
            enableSelection={enableSelection}
            selectMode={selectMode}
            onToggleSelectMode={() => setSelectMode((v) => !v)}
          />
        )}
      </div>
    </>
  );
}
