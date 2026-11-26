"use client";

import type { GridSurface } from "@/components/commands/grid";
import { isTypingTarget } from "@workspace/ui/lib/keymap";
import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  needsLoadFor,
  type CellEffect,
  type CellEvent,
  type CellRef,
  type EntryMode,
} from "./cell-interaction";
import type { CellValue, EditableCellConfig } from "./generic-table-types";
import { planPaste } from "./paste-cells";
import { gridToTsv, tsvToGrid } from "./tsv";

type Direction = "up" | "down" | "left" | "right";

/** The rectangle(s) a cell selection covers, in row-model index space. */
type CellSelectionBounds = {
  minRowIndex: number;
  maxRowIndex: number;
  minColumnIndex: number;
  maxColumnIndex: number;
};

/** The slice of the TanStack table the grid's keyboard layer drives. */
type GridTable = {
  getSelectedCellRangesData: () => unknown[][][];
  getFocusedCell: () =>
    { row: { id: string }; column: { id: string } } | null | undefined;
  getRowModel: () => { rows: { id: string; original: unknown }[] };
  getAllLeafColumns: () => { id: string }[];
  getCellSelectionBounds: () => CellSelectionBounds[];
  extendCellSelection: (direction: "up" | "down" | "left" | "right") => void;
  moveCellSelection: (direction: "up" | "down" | "left" | "right") => void;
  selectAllCells: () => void;
  resetCellSelection: (defaultState?: boolean) => void;
};

/**
 * Spreadsheet-style keyboard handling for the cell grid: a `GridSurface` for
 * the command registry to drive (arrow navigation, ⌘A, ⌘C as TSV, Enter into
 * the interaction machine), a typed character into the interaction machine
 * from the element's own `onKeyDown`, and paste of a TSV rectangle anchored
 * at the focused cell into the editable columns it covers.
 */
export function useCellClipboard({
  table,
  editableCells,
  selectableColumnIds,
  editing,
  entryOf,
  seedableOf,
  dispatch,
  saveCell,
  ensureLoaded,
  hasMore,
  loadFailed,
  revealCell,
  scrollToIndex,
}: {
  table: GridTable;
  editableCells?: Record<string, EditableCellConfig>;
  selectableColumnIds: Set<string>;
  /** The cell showing its editor: while one does, the grid takes no keys. */
  editing: CellRef | null;
  /** How a column's cells are entered; `"none"` for a read-only column. */
  entryOf: (columnId: string) => EntryMode;
  /** Whether a typed character means anything on this column's kind. */
  seedableOf: (columnId: string) => boolean;
  /** Runs an event through the machine and returns the effect it decided on. */
  dispatch: (event: CellEvent) => CellEffect;
  saveCell?: (
    rowId: number,
    field: string,
    value: CellValue
  ) => Promise<boolean>;
  /** Loads the page holding `index` into the row model, if it is not there yet. */
  ensureLoaded: (index: number) => Promise<boolean>;
  /** Whether the server holds rows past the loaded window. */
  hasMore: boolean;
  /** Whether the last page load failed (the grid shows its retry line). */
  loadFailed: boolean;
  /** Scrolls a cell's row into the window first, then focuses it once mounted. */
  revealCell: (rowKey: string, columnId: string) => void;
  /** Scrolls the grid to a row index, with no DOM focus of its own. */
  scrollToIndex: { current: ((rowIndex: number) => void) | null };
}) {
  const copySelection = useCallback(() => {
    const regions = table.getSelectedCellRangesData();
    if (regions.length === 0) return;
    const tsv = regions.map(gridToTsv).join("\n\n");
    void navigator.clipboard?.writeText(tsv);
  }, [table]);

  // The cell-selection feature only moves state: nothing in it, or in this
  // grid before now, puts DOM focus on the cell a keyboard move landed on,
  // so a move past the mounted window left the focused cell invisible.
  // `getFocusedCell`/`moveCellSelection` read and write the feature's own
  // atom directly rather than React state, so a read right after a move
  // already sees it — no pending/effect indirection needed here, unlike the
  // row model itself.
  const revealFocusedCell = useCallback(() => {
    const focused = table.getFocusedCell();
    if (focused) revealCell(focused.row.id, focused.column.id);
  }, [table, revealCell]);

  // A paste rectangle waiting on rows a load-past-the-window brought in: the
  // parsed grid and where it lands, resolved once the table's own row model
  // — read fresh below, never off a `rows` array captured before an `await`
  // — carries them. Mirrors `use-row-cursor.ts`'s `pendingIndex`.
  const [pendingPaste, setPendingPaste] = useState<{
    grid: string[][];
    columnIds: string[];
    start: { row: number; column: number };
    /** The focused row's id when the paste began, checked against `start.row`. */
    anchorKey: string;
  } | null>(null);

  const runPaste = useCallback(
    async (
      grid: string[][],
      columnIds: string[],
      start: { row: number; column: number },
      rows: ReturnType<GridTable["getRowModel"]>["rows"]
    ) => {
      if (!saveCell) return;
      const { saves, skipped, notEditable } = planPaste({
        grid,
        columnIds,
        start,
        rowIds: rows.map((row) => (row.original as { id?: number }).id),
        configs: editableCells ?? {},
      });

      const results = await Promise.all(
        saves.map(({ rowId, field, value }) => saveCell(rowId, field, value))
      );
      const failed = results.filter((ok) => !ok).length;
      if (failed > 0) toast.error(`${failed} cell(s) failed to paste`);
      if (skipped > 0) {
        toast.error(`${skipped} cell(s) skipped: not valid for their column`);
      }
      if (notEditable > 0) {
        toast.error(`${notEditable} cell(s) skipped: column is not editable`);
      }
    },
    [saveCell, editableCells]
  );

  const pasteIntoSelection = useCallback(
    async (text: string) => {
      const focused = table.getFocusedCell();
      if (!focused || !saveCell) return;

      const grid = tsvToGrid(text);
      if (grid.length === 0) return;

      const rows = table.getRowModel().rows;
      const startRowIndex = rows.findIndex((r) => r.id === focused.row.id);
      const columnIds = table
        .getAllLeafColumns()
        .map((c) => c.id)
        .filter((id) => selectableColumnIds.has(id));
      const startColIndex = columnIds.indexOf(focused.column.id);
      if (startRowIndex < 0 || startColIndex < 0) return;

      const start = { row: startRowIndex, column: startColIndex };
      const lastRowIndex = startRowIndex + grid.length - 1;

      // A pasted block taller than what is loaded reaches for the rows a
      // load would bring in; `ensureLoaded` resolving guarantees they exist
      // in state, not that `rows` above carries them yet, so the write
      // itself waits for the pending-paste effect rather than reusing `rows`
      // here. A failed load writes nothing (the grid's own retry line reports
      // it); a load that finds the server has no more writes what exists and
      // stops, since `planPaste` skips a row past the end on its own.
      if (needsLoadFor(lastRowIndex, rows.length, hasMore)) {
        // `false` covers three outcomes, which the effect below tells apart:
        // the server ran out of rows (write what exists), the load failed
        // (`loadFailed`: write nothing), or the view changed under the load
        // (the anchor row is gone from `start.row`: write nothing).
        await ensureLoaded(lastRowIndex);
        setPendingPaste({ grid, columnIds, start, anchorKey: focused.row.id });
        return;
      }

      await runPaste(grid, columnIds, start, rows);
    },
    [table, saveCell, selectableColumnIds, hasMore, ensureLoaded, runPaste]
  );

  useEffect(() => {
    if (!pendingPaste) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect, @eslint-react/set-state-in-effect
    setPendingPaste(null);
    const rows = table.getRowModel().rows;
    if (
      loadFailed ||
      rows[pendingPaste.start.row]?.id !== pendingPaste.anchorKey
    )
      return;
    void runPaste(
      pendingPaste.grid,
      pendingPaste.columnIds,
      pendingPaste.start,
      rows
    );
  }, [pendingPaste, table, runPaste, loadFailed]);

  // The row index an arrow-down load-past-the-window move is waiting to land
  // on, mirroring `pendingPaste` above and `use-row-cursor.ts`'s
  // `pendingIndex`: resolved once the row model carries it, never off a
  // `rows` read from before the `ensureLoaded` await.
  const [pendingDownIndex, setPendingDownIndex] = useState<number | null>(null);

  useEffect(() => {
    if (pendingDownIndex == null) return;
    if (table.getRowModel().rows.length <= pendingDownIndex) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect, @eslint-react/set-state-in-effect
    setPendingDownIndex(null);
    table.moveCellSelection("down");
    revealFocusedCell();
  }, [pendingDownIndex, table, revealFocusedCell]);

  const move = useCallback(
    (direction: Direction) => {
      if (direction === "down") {
        const focused = table.getFocusedCell();
        const rows = table.getRowModel().rows;
        const rowIndex = focused
          ? rows.findIndex((r) => r.id === focused.row.id)
          : -1;
        // Otherwise the feature's own clamp stands: a row short of the last
        // loaded one moves within what is already there, and nothing more to
        // load leaves the selection where it is.
        if (
          rowIndex !== -1 &&
          needsLoadFor(rowIndex + 1, rows.length, hasMore)
        ) {
          void ensureLoaded(rowIndex + 1).then((ok) => {
            // A stale pending index left set by an earlier call must not
            // fire on a later, unrelated rows change once this one comes
            // back empty.
            setPendingDownIndex(ok ? rowIndex + 1 : null);
          });
          return;
        }
      }
      table.moveCellSelection(direction);
      revealFocusedCell();
    },
    [table, hasMore, ensureLoaded, revealFocusedCell]
  );

  const extend = useCallback(
    (direction: Direction) => {
      table.extendCellSelection(direction);
      // The feature only moves the range's state; a row-changing extend
      // reveals the moving edge too, so the user can see how far the
      // selection now reaches. Scroll only — extending keeps focus (and
      // `getFocusedCell`, which the feature reads off the range's anchor) on
      // the cell the selection started from, not the edge that moved, so
      // there is no single cell here to hand DOM focus to.
      if (direction === "up" || direction === "down") {
        const bounds = table.getCellSelectionBounds();
        const active = bounds[bounds.length - 1];
        if (active) {
          scrollToIndex.current?.(
            direction === "down" ? active.maxRowIndex : active.minRowIndex
          );
        }
      }
    },
    [table, scrollToIndex]
  );

  const selectAll = useCallback(() => {
    table.selectAllCells();
    revealFocusedCell();
  }, [table, revealFocusedCell]);

  const focused = table.getFocusedCell();
  const focusedRowKey = focused?.row.id ?? null;
  const focusedColumnId = focused?.column.id ?? null;
  const focusedEntry = focusedColumnId ? entryOf(focusedColumnId) : "none";

  // A read-only cell leaves Enter to the browser, so a link inside one still
  // activates; what the key does to a cell that does hold one is the
  // machine's.
  const enter = useMemo(() => {
    if (focusedRowKey == null || focusedColumnId == null) return null;
    if (focusedEntry === "none") return null;
    return () => {
      dispatch({
        type: "enter",
        cell: { rowKey: focusedRowKey, columnId: focusedColumnId },
        entry: focusedEntry,
      });
    };
  }, [focusedRowKey, focusedColumnId, focusedEntry, dispatch]);

  const surface = useMemo<GridSurface>(
    () => ({ move, extend, selectAll, copy: copySelection, enter }),
    [move, extend, selectAll, copySelection, enter]
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (editing) return;
      // The draft row's inputs sit inside the element this handler is bound to
      // and do not stop propagation, so every key typed in one arrives here
      // too. Without this a typed character would open a cell's editor
      // instead of reaching the text being typed.
      if (isTypingTarget(e.target)) return;

      // A character on a cell opens its editor seeded with it. The machine
      // decides what is a character; the key is only claimed when it opened
      // one, so a read-only cell leaves it to the page's own hotkeys. The
      // grid's arrows, ⌘A, ⌘C and Enter answer through the command registry
      // instead, once this handler leaves them alone.
      if (e.metaKey || e.ctrlKey || e.altKey || e.nativeEvent.isComposing) {
        return;
      }
      const target = table.getFocusedCell();
      if (!target) return;
      const effect = dispatch({
        type: "type",
        cell: { rowKey: target.row.id, columnId: target.column.id },
        entry: entryOf(target.column.id),
        seedable: seedableOf(target.column.id),
        char: e.key,
      });
      if (effect.type === "openEditor") e.preventDefault();
    },
    [editing, table, entryOf, seedableOf, dispatch]
  );

  const onPaste = useCallback(
    (e: React.ClipboardEvent<HTMLDivElement>) => {
      if (editing) return;
      // As in `onKeyDown`: a paste into a draft field reaches the grid too,
      // and would spread a TSV rectangle over the cells instead.
      if (isTypingTarget(e.target)) return;
      const text = e.clipboardData.getData("text/plain");
      if (!text) return;
      e.preventDefault();
      void pasteIntoSelection(text);
    },
    [editing, pasteIntoSelection]
  );

  return { onKeyDown, onPaste, surface };
}
