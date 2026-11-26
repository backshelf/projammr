"use client";

import type { ReactNode } from "react";

import { useDataTableConfig, useDataTableState } from "./data-table-context";
import { rowIdOf } from "./row-id";
import { useCellContext } from "./table-hook-contexts";

/*
 * The components the table hook registers under `cellComponents`. A column's
 * cell reaches one as a property of its render context's `cell`, and one reads
 * the cell it sits in from cell context. The table hook imports this module, so
 * this module takes its hooks from the modules the hook does not: never from
 * `data-table-hook` itself.
 */

/**
 * The row's peek handle: a button around its children that opens the row in the
 * peek panel and closes it again. A sub-row is another entity and a row without
 * a numeric id has nothing to open, so both, like a table with no `peek`,
 * render their children bare.
 */
export function PeekHandle({ children }: { children: ReactNode }) {
  const cell = useCellContext();
  const { peek, setPeekId, entityLabel } = useDataTableConfig();
  // The open row is hot state the row around this cell does not hand down, so
  // the handle reads it itself and re-renders with it.
  const { peekId } = useDataTableState();
  const rowId = rowIdOf(cell.row.original);

  if (!peek || cell.row.depth > 0 || typeof rowId !== "number") {
    return children;
  }

  const isPeeked = rowId === peekId;
  return (
    <button
      type="button"
      className="group/id w-full cursor-pointer text-left"
      aria-label={`Peek ${entityLabel} ${rowId}`}
      aria-expanded={isPeeked}
      onClick={() => setPeekId(isPeeked ? null : rowId)}
    >
      {children}
    </button>
  );
}
