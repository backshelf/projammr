"use client";

import { IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import { Checkbox } from "@workspace/ui/components/checkbox";
import type React from "react";

const EXPAND_COLUMN_ID = "__expand__";
const SELECT_COLUMN_ID = "__select__";

/* The leading columns are shared by every table, so they are typed by what
   their renderers touch rather than by any one table's row shape. */
type LeadingRow = {
  depth: number;
  getCanExpand: () => boolean;
  getIsExpanded: () => boolean;
  getToggleExpandedHandler: () => () => void;
  getIsSelected: () => boolean;
  getToggleSelectedHandler: () => (event: unknown) => void;
};

type LeadingTable = {
  getIsAllPageRowsSelected: () => boolean;
  getIsSomePageRowsSelected: () => boolean;
  getToggleAllPageRowsSelectedHandler: () => (event: unknown) => void;
};

const LEADING_SIZE = {
  size: 44,
  minSize: 44,
  maxSize: 44,
  enableResizing: false,
  enableSorting: false,
  enableHiding: false,
};

/**
 * Leading disclosure column, ahead of the checkbox column. The caret lives in
 * its own fixed-width column rather than inside the first data cell so every
 * row's caret shares one x-position — inline, it sat after a variable amount of
 * cell content and shifted the checkboxes of expandable rows out of line.
 */
export const EXPAND_COLUMN = {
  id: EXPAND_COLUMN_ID,
  header: () => null,
  cell: ({ row }: { row: LeadingRow }) =>
    row.getCanExpand() ? (
      <button
        type="button"
        aria-label={row.getIsExpanded() ? "Collapse row" : "Expand row"}
        className="flex w-full items-center justify-center text-ink-soft hover:text-ink"
        onClick={(e: React.MouseEvent) => {
          e.stopPropagation();
          row.getToggleExpandedHandler()();
        }}
      >
        {row.getIsExpanded() ? (
          <IconChevronDown size={14} />
        ) : (
          <IconChevronRight size={14} />
        )}
      </button>
    ) : null,
  ...LEADING_SIZE,
};

/**
 * Leading checkbox column. The header toggles every loaded row;
 * each row checkbox goes through `getToggleSelectedHandler()` (bound to
 * `onClick`, not `onChange` — a DOM change event drops the Shift modifier the
 * handler needs to establish and extend a range).
 */
export const SELECT_COLUMN = {
  id: SELECT_COLUMN_ID,
  header: ({ table }: { table: LeadingTable }) => (
    <Checkbox
      aria-label="Select all loaded rows"
      checked={table.getIsAllPageRowsSelected()}
      ref={(el: HTMLInputElement | null) => {
        if (el)
          el.indeterminate =
            table.getIsSomePageRowsSelected() &&
            !table.getIsAllPageRowsSelected();
      }}
      onChange={table.getToggleAllPageRowsSelectedHandler()}
    />
  ),
  cell: ({ row }: { row: LeadingRow }) =>
    row.depth > 0 ? null : (
      <Checkbox
        aria-label="Select row"
        checked={row.getIsSelected()}
        onClick={row.getToggleSelectedHandler()}
        onChange={() => {}}
      />
    ),
  ...LEADING_SIZE,
};

export const isLeadingColumnId = (id: string) =>
  id === EXPAND_COLUMN_ID || id === SELECT_COLUMN_ID;
