"use client";

import {
  IconArrowDown,
  IconArrowsUpDown,
  IconArrowUp,
} from "@tabler/icons-react";
import type { RowData } from "@tanstack/react-table";
import { Button } from "@workspace/ui/components/button";
import { Empty, EmptyHeader, EmptyTitle } from "@workspace/ui/components/empty";
import {
  PINNED_CELL,
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table";
import { useHydrated } from "@workspace/ui/hooks/use-hydrated";
import { cn } from "@workspace/ui/lib/utils";
import type { ReactNode } from "react";

import { useDataTable } from "../data-table-context";
import { isLeadingColumnId } from "../leading-columns";
import { Draft } from "./Draft";
import { GridSections } from "./GridSections";

/**
 * The grid tier of the table: the keyboard, paste and pointer wrapper around a
 * header with sorting and resizing, the pinned column and the row-actions
 * spacer, and the body. The draft toggle and the empty state follow it.
 *
 * The wrapper and table are withheld on the card tier; the toggle withholds
 * itself there, and the empty state shows on both tiers.
 */
export function Grid<TData extends RowData, TChild = never>(): ReactNode {
  const { showCards, hasRows, emptyText } = useDataTable<TData, TChild>();

  return (
    <>
      {!showCards && <GridTable<TData, TChild> />}

      <Draft<TData, TChild> />

      {!hasRows && (
        <div className="sticky left-0 w-full">
          <Empty className="border-0 py-10">
            <EmptyHeader>
              <EmptyTitle>{emptyText}</EmptyTitle>
            </EmptyHeader>
          </Empty>
        </div>
      )}
    </>
  );
}

function GridTable<TData extends RowData, TChild = never>(): ReactNode {
  const {
    table,
    cellGrid,
    gridRef,
    gridHandlers,
    rowActions,
    pinnedColumnId,
    sections,
    totalRows,
  } = useDataTable<TData, TChild>();

  // Until the client has answered, a phone would paint one frame of the grid
  // at its full width — the server renders the desktop layout because it has
  // no viewport to read. Below the phone breakpoint the grid is held invisible
  // for that frame, so what flashes is nothing rather than a 1200px table.
  const hydrated = useHydrated();

  // `aria-rowcount` counts every `row`-rolled `<tr>` a screen reader could
  // reach, the header included: grouped, that is a header per section plus
  // its own rows — the flattened list `GridSections` virtualises over, not
  // `totalRows`, which counts entities and not their section headers.
  // Ungrouped, an expanded row's children are rows too, each with an index.
  const bodyRowCount = sections
    ? sections.reduce((count, section) => count + 1 + section.rows.length, 0)
    : totalRows +
      table.getRowModel().rows.filter((row) => row.depth > 0).length;

  return (
    <div
      ref={gridRef}
      onKeyDown={cellGrid.onKeyDown}
      onPaste={cellGrid.onPaste}
      {...gridHandlers}
    >
      {/* One description for every editable cell to point at, rather
          than the same sentence repeated inside each of them. */}
      <span id={cellGrid.editHintId} className="sr-only">
        Press Enter to edit
      </span>
      <Table
        variant="entity"
        role="grid"
        aria-rowcount={bodyRowCount + 1}
        className={cn("table-fixed", !hydrated && "phone:invisible")}
        style={{ minWidth: table.getTotalSize() }}
      >
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id} role="row" aria-rowindex={1}>
              {headerGroup.headers.map((header) => {
                const sorted = header.column.getIsSorted();
                const Icon =
                  sorted === "asc"
                    ? IconArrowUp
                    : sorted === "desc"
                      ? IconArrowDown
                      : IconArrowsUpDown;
                const hideSortIndicator =
                  header.column.columnDef.meta?.hideSortIndicator ?? false;
                const flexFill =
                  (header.column.id === "title" ||
                    header.column.id === "name") &&
                  table.state.columnSizing[header.column.id] == null;

                return (
                  <TableHead
                    key={header.id}
                    role="columnheader"
                    colSpan={header.colSpan}
                    style={
                      flexFill
                        ? { minWidth: header.getSize() }
                        : { width: header.getSize() }
                    }
                    className={cn(
                      "relative",
                      isLeadingColumnId(header.column.id) &&
                        "px-0 text-center [&>*]:mx-auto",
                      header.column.id === pinnedColumnId &&
                        cn(PINNED_CELL, "z-3")
                    )}
                    data-slot={
                      header.column.id === pinnedColumnId ? "pinned" : undefined
                    }
                  >
                    {header.isPlaceholder ? null : header.column.getCanSort() ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="max-w-full"
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        <span className="truncate">
                          <table.FlexRender header={header} />
                        </span>
                        {!hideSortIndicator && <Icon className="shrink-0" />}
                      </Button>
                    ) : (
                      <span className="block truncate">
                        <table.FlexRender header={header} />
                      </span>
                    )}
                    {header.column.getCanResize() && (
                      <span
                        role="separator"
                        aria-orientation="vertical"
                        aria-label={`Resize ${header.column.id} column`}
                        onMouseDown={header.getResizeHandler()}
                        onTouchStart={header.getResizeHandler()}
                        onClick={(e) => e.stopPropagation()}
                        className={cn(
                          "absolute top-0 right-0 h-full w-1.5 cursor-col-resize touch-none bg-rule select-none fine:opacity-0 fine:motion-reveal fine:hover:opacity-100 coarse:hidden",
                          header.column.getIsResizing() && "bg-art opacity-100"
                        )}
                      />
                    )}
                  </TableHead>
                );
              })}
              {rowActions && (
                <TableHead
                  role="columnheader"
                  className="sticky right-0 z-4 w-0 p-0"
                  style={{ width: 0 }}
                >
                  <span className="sr-only">Row actions</span>
                </TableHead>
              )}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          <GridSections<TData, TChild> />
        </TableBody>
      </Table>
    </div>
  );
}
