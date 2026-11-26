"use client";

import type { RowData } from "@tanstack/react-table";

import { useDataTable } from "../data-table-context";

/**
 * The footer under the rows: how many rows the view matches, and how many
 * groups they fall into while grouped. Shown only while the table has rows.
 */
export function Paging() {
  const { table, totalRows, serverGroups, grouped } = useDataTable<RowData>();

  if (table.getRowModel().rows.length === 0) return null;

  const rows = `${totalRows} ${totalRows === 1 ? "row" : "rows"}`;

  return (
    <div className="px-2 py-2 text-small text-ink-soft">
      {grouped ? `${rows} in ${(serverGroups ?? []).length} groups` : rows}
    </div>
  );
}
