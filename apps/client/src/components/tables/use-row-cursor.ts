import { useCommandScope } from "@/components/commands/provider";
import { TABLE_SCOPE, type TableSurface } from "@/components/commands/tables";
import { useLatestRef } from "@workspace/ui/hooks/use-latest-ref";
import type { RowData } from "@tanstack/react-table";
import {
  type FocusEvent,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { DataTableInstance } from "./data-table-hook";
import type { DataTableProps } from "./generic-table-types";
import { nextCursor } from "./row-cursor";
import { rowIdOf } from "./row-id";
import type {
  RowActionsConfig,
  RowActionsTarget,
  RowMenuRequest,
} from "./RowActions";

type Table<TData extends RowData> = DataTableInstance<TData>;
type TableRow<TData extends RowData> = ReturnType<
  Table<TData>["getRowModel"]
>["rows"][number];

/**
 * The keyboard's row cursor and the table's keys. The cursor is keyed by
 * `getRowId` and is separate from the cell grid's focused cell: it walks whole
 * top-level rows and never edits.
 *
 * Each table pushes the `table` command scope with its cursor as the surface.
 * With `alwaysOn` a table holds the keys from the moment it mounts; otherwise
 * it takes them over while it is pointed at or focused, since the push made
 * last wins. The phone card tier (`showCards`) pushes neither.
 *
 * Returns the cursor's row id and the handlers the grid's wrapper spreads so
 * the hook can see the pointer and focus enter and leave it.
 */
export function useRowCursor<TData extends RowData, TChild = never>({
  table,
  rows,
  gridRef,
  alwaysOn,
  showCards,
  peek,
  enableSelection,
  hasFocusedCell,
  setPeekId,
  router,
  ensureLoaded,
  hasMore,
  scrollToIndex,
  rowActionsFor,
  setMenuRequest,
  searchInput,
  cellOpenable,
  openCell,
}: {
  table: Table<TData>;
  /** The top-level rows the cursor walks, in display order. */
  rows: TableRow<TData>[];
  /** The grid's wrapper element, where the cursor's row is found by `data-cursor`. */
  gridRef: RefObject<HTMLDivElement | null>;
  /** Whether the table holds the command scope from mount. */
  alwaysOn: boolean;
  showCards: boolean;
  peek: DataTableProps<TData, TChild>["peek"];
  enableSelection: boolean;
  hasFocusedCell: boolean;
  setPeekId: (id: number | null) => void;
  router: { push: (href: string) => void };
  /** Loads pages until row-model index `index` exists, or there is nothing left to load. */
  ensureLoaded: (index: number) => Promise<boolean>;
  /** Whether the server holds rows past the loaded window. */
  hasMore: boolean;
  /** Scrolls the grid to a row index, or does nothing while unset. */
  scrollToIndex: RefObject<((index: number) => void) | null>;
  /** What the row menu offers a row, or null where the table has no row menu. */
  rowActionsFor: (
    row: TData,
    rowId: number
  ) => (RowActionsConfig & { target: RowActionsTarget }) | null;
  /** Opens a row's `⋯` menu with a submenu open. */
  setMenuRequest: (request: RowMenuRequest) => void;
  /** The table's search field, once the toolbar has rendered it. */
  searchInput: HTMLInputElement | null;
  /** Whether a column has a cell a key can open: editable, and shown. */
  cellOpenable: (columnId: string) => boolean;
  /** The cell grid's entry into a cell; set once the grid has rendered. */
  openCell: RefObject<((rowKey: string, columnId: string) => void) | null>;
}) {
  const [cursorRowId, setCursorRowId] = useState<string | null>(null);
  const [pointerInGrid, setPointerInGrid] = useState(false);
  const [focusInGrid, setFocusInGrid] = useState(false);

  const cursorRow = rows.find((row) => row.id === cursorRowId);
  const cursorRowKey = cursorRow ? rowIdOf(cursorRow.original) : undefined;

  // Kept current in its own effect (never during render) so it settles before
  // the cursor-scrolling effect, declared after it, reads it.
  const tableRef = useRef(table);
  useEffect(() => {
    tableRef.current = table;
  });

  // The row index a load-past-the-window move is waiting to land on.
  // `ensureLoaded` resolving only guarantees the row exists in state; `rows`
  // itself does not carry it until the resulting render reaches this hook, so
  // the move is resolved by index in the effect below rather than off a
  // `rows` array read straight after the `await`. `exhausted` marks a counted
  // move whose loading ran out of rows before the target: `rows` then already
  // holds everything there is, and the cursor lands on its last row.
  const [pending, setPending] = useState<{
    index: number;
    exhausted: boolean;
  } | null>(null);

  const moveCursor = (delta: 1 | -1, count = 1) => {
    const ids = rows.map((row) => row.id);
    const outcome = nextCursor(ids, cursorRowId, delta, { hasMore }, count);

    if (outcome === null || typeof outcome === "string") {
      setCursorRowId(outcome);
      return;
    }

    // `outcome.load` is an index into `rows` (top-level rows only).
    // `ensureLoaded` measures the row model as a whole, which can hold more
    // rows than `rows` while a parent is expanded, so it is given the row
    // model's own length plus the rows still to come rather than the index.
    const targetIndex = outcome.load;
    const rowModelIndex =
      table.getRowModel().rows.length + (targetIndex - ids.length);
    void (async () => {
      const ok = await ensureLoaded(rowModelIndex);
      // A stale pending index left set by an earlier call must not fire on a
      // later, unrelated `rows` change once this one comes back empty. A
      // single step that finds nothing more stays put; a counted one lands on
      // the last row.
      setPending(
        ok
          ? { index: targetIndex, exhausted: false }
          : count > 1
            ? { index: targetIndex, exhausted: true }
            : null
      );
    })();
  };

  // First row, or the last one loaded: neither loads pages.
  const jumpCursor = (edge: "first" | "last") => {
    const row = edge === "first" ? rows[0] : rows[rows.length - 1];
    if (row) setCursorRowId(row.id);
  };

  useEffect(() => {
    if (pending == null) return;
    const targetRow = pending.exhausted
      ? rows[Math.min(pending.index, rows.length - 1)]
      : rows[pending.index];
    if (!targetRow) return;
    // Clears the wait rather than leaving it to fire again on the next
    // unrelated `rows` change; nothing else can settle this once-off move.
    // The cursor-scrolling effect below covers the scroll and the frame's
    // wait once this sets the cursor onto the newly loaded row.
    // eslint-disable-next-line react-hooks/set-state-in-effect, @eslint-react/set-state-in-effect
    setPending(null);
    // eslint-disable-next-line @eslint-react/set-state-in-effect
    setCursorRowId(targetRow.id);
  }, [pending, rows]);

  // Scrolls the row into the virtualised window first (`scrollToIndex` is a
  // no-op unwindowed), then waits a frame for it to mount before the
  // `querySelector` — otherwise a cursor that has scrolled out of the window
  // finds nothing to focus.
  //
  // `scrollToIndex` counts the table's whole row model, expanded sub-rows
  // included, not the top-level `rows` the cursor walks, so the index is
  // looked up there. The table is read through a ref rather than depended on:
  // a page appending while the user has scrolled away must not re-run this
  // and yank them back to the cursor.
  useEffect(() => {
    if (cursorRowId == null) return;
    const index = tableRef.current
      .getRowModel()
      .rows.findIndex((row) => row.id === cursorRowId);
    if (index !== -1) scrollToIndex.current?.(index);
    const frame = requestAnimationFrame(() => {
      gridRef.current
        ?.querySelector("[data-cursor]")
        ?.scrollIntoView({ block: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [cursorRowId, gridRef, scrollToIndex]);

  // The row menu's own handlers for the cursor's row, so a key does exactly
  // what the menu item does. Rename and the menu's submenus are a single row's;
  // a row inside a multi-row selection targets the selection, as its menu does.
  const cursorActions =
    cursorRow && cursorRowKey != null
      ? rowActionsFor(cursorRow.original, cursorRowKey)
      : null;
  const archiveAction = cursorActions?.actions?.find(
    (action) => action.id === "archive"
  );
  const canRename =
    cursorActions?.onRename !== undefined && cursorActions.target.count === 1;
  const canAddToCollection =
    cursorActions?.onAddToCollection !== undefined &&
    (cursorActions.collections?.length ?? 0) > 0;

  // The surface changes only when what the keys can do changes; the moves
  // themselves read the latest render through `moves`.
  const moves = useLatestRef({
    moveCursor,
    jumpCursor,
    selectAll: () => table.toggleAllRowsSelected(true),
    open: () => {
      if (cursorRow && peek) router.push(peek.href(cursorRow.original));
    },
    peek: () => {
      if (cursorRowKey != null) setPeekId(cursorRowKey);
    },
    toggleSelected: () => cursorRow?.toggleSelected(),
    rename: () => cursorActions?.onRename?.(),
    archive: () => void archiveAction?.onSelect(),
    addToCollection: () => {
      if (cursorRowKey != null) {
        setMenuRequest({ rowId: cursorRowKey, submenu: "collection" });
      }
    },
    setStatus: () => {
      if (cursorRowId != null) openCell.current?.(cursorRowId, "status");
    },
    setPriority: () => {
      if (cursorRowId != null) openCell.current?.(cursorRowId, "priority");
    },
    focusSearch: () => searchInput?.focus(),
    clear: () => {
      setCursorRowId(null);
      table.resetCellSelection(true);
    },
  });
  const canOpen = cursorRow !== undefined && peek !== undefined;
  const canPeek = cursorRowKey != null && peek !== undefined;
  const canSelect =
    cursorRow !== undefined && enableSelection && cursorRow.getCanSelect();
  const canSelectAll = enableSelection && rows.length > 0;
  const canArchive = archiveAction !== undefined;
  const canSetStatus = cursorRow !== undefined && cellOpenable("status");
  const canSetPriority = cursorRow !== undefined && cellOpenable("priority");
  const canFocusSearch = searchInput !== null;
  const canClear = cursorRowId != null || hasFocusedCell;
  const surface = useMemo<TableSurface>(
    () => ({
      moveCursor: (delta, count) => moves.current.moveCursor(delta, count),
      jumpCursor: (edge) => moves.current.jumpCursor(edge),
      selectAll: canSelectAll ? () => moves.current.selectAll() : null,
      open: canOpen ? () => moves.current.open() : null,
      peek: canPeek ? () => moves.current.peek() : null,
      toggleSelected: canSelect ? () => moves.current.toggleSelected() : null,
      rename: canRename ? () => moves.current.rename() : null,
      archive: canArchive ? () => moves.current.archive() : null,
      addToCollection: canAddToCollection
        ? () => moves.current.addToCollection()
        : null,
      setStatus: canSetStatus ? () => moves.current.setStatus() : null,
      setPriority: canSetPriority ? () => moves.current.setPriority() : null,
      focusSearch: canFocusSearch ? () => moves.current.focusSearch() : null,
      clear: canClear ? () => moves.current.clear() : null,
    }),
    [
      moves,
      canOpen,
      canPeek,
      canSelect,
      canSelectAll,
      canRename,
      canArchive,
      canAddToCollection,
      canSetStatus,
      canSetPriority,
      canFocusSearch,
      canClear,
    ]
  );
  useCommandScope(TABLE_SCOPE, surface, !showCards && alwaysOn);
  useCommandScope(
    TABLE_SCOPE,
    surface,
    !showCards && (pointerInGrid || focusInGrid)
  );

  // Built once: the handlers only call state setters, and the grid wrapper
  // spreads them from the root's config half.
  const gridHandlers = useMemo(
    () => ({
      onPointerEnter: () => setPointerInGrid(true),
      onPointerLeave: () => setPointerInGrid(false),
      onFocus: () => setFocusInGrid(true),
      onBlur: (e: FocusEvent<HTMLDivElement>) => {
        if (!e.currentTarget.contains(e.relatedTarget)) {
          setFocusInGrid(false);
        }
      },
    }),
    []
  );

  return { cursorRowId, gridHandlers, focusInGrid };
}
