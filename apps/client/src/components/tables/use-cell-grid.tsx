import { GRID_SCOPE } from "@/components/commands/grid";
import { useCommandScope } from "@/components/commands/provider";
import { fieldKind } from "@/fields";
import { formatScalar } from "@/fields/scalar";
import type { FieldKind, FieldValue } from "@/fields/types";
import type { RowData } from "@tanstack/react-table";
import {
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  cellInteraction,
  type CellEffect,
  type CellEvent,
  type CellRef,
  type CellState,
  type EntryMode,
} from "./cell-interaction";
import type { DataTableInstance } from "./data-table-hook";
import EditableCell from "./EditableCell";
import type { CellValue, EditableCellConfig } from "./generic-table-types";
import { rowIdOf } from "./row-id";
import { useCellClipboard } from "./use-cell-clipboard";
import type { LoadedStatus } from "./use-loaded-window";

const IDLE_CELL_STATE: CellState = { editing: null };

/** Attribute selector for one grid cell, as `selectionCellProps` tags it. */
const cellSelector = (rowKey: string, columnId: string) =>
  `[data-cell="${CSS.escape(rowKey)}::${CSS.escape(columnId)}"]`;

/** How a column's cells are entered, read off its editable-cell config. */
export function cellEntry(
  editableCells: Record<string, EditableCellConfig> | undefined,
  columnId: string
): EntryMode {
  const config = editableCells?.[columnId];
  return config ? fieldKind(config.type).entry : "none";
}

type CellTarget = {
  field: string;
  columnId: string;
  rowId: number;
  rowKey: string;
};

/**
 * The spreadsheet model of a data table's grid: the one cell (if any) showing
 * its editor, the seed that opened it, the focus bookkeeping of a press, the
 * clipboard, and the props and renderers the row hands each cell.
 * `cell-interaction.ts` holds the rule for what every gesture does; this hook
 * dispatches events into it and applies the effect it hands back. Saves go
 * through the root's `saveCell`, which the row actions and the peek panel use
 * too.
 *
 * A viewer's table has no editable cells, and the hook still yields selection
 * props: `entryOf` is what makes each cell of it read-only.
 */
export function useCellGrid<TData extends RowData>({
  table,
  data,
  editableCells,
  selectableColumnIds,
  gridRef,
  tableId,
  canSave,
  saveCell,
  scrollToIndex,
  ensureLoaded,
  loaded,
  focusInGrid,
}: {
  table: DataTableInstance<TData>;
  /** The rows the grid holds, which decide whether an editing cell's row is still there. */
  data: TData[];
  editableCells: Record<string, EditableCellConfig> | undefined;
  /** The columns the cursor can visit. */
  selectableColumnIds: Set<string>;
  /** The grid's wrapper element, where cells are found by their `data-cell`. */
  gridRef: RefObject<HTMLDivElement | null>;
  tableId: string;
  /** Whether the table saves cell edits at all. */
  canSave: boolean;
  saveCell: (
    rowId: number,
    field: string,
    value: CellValue
  ) => Promise<boolean>;
  /** Scrolls the grid to a row index, or does nothing while unset (unwindowed, or the card tier). */
  scrollToIndex: RefObject<((rowIndex: number) => void) | null>;
  /** Loads the page holding `index` into `data`, if it is not there yet. */
  ensureLoaded: (index: number) => Promise<boolean>;
  /** What the parts read about the rows the table has loaded. */
  loaded: LoadedStatus;
  /** Whether DOM focus is inside the grid; the grid's keys are live only then. */
  focusInGrid: boolean;
}) {
  // The reducer state: the one cell (if any) showing its editor. The ref
  // carries it between dispatches, so a gesture decides against what the last
  // one settled rather than against the render it happens to land in.
  const [cellState, setCellState] = useState<CellState>(IDLE_CELL_STATE);
  const cellStateRef = useRef<CellState>(IDLE_CELL_STATE);

  /**
   * Whether a row key still names a row the grid holds. A sub-row's key is
   * namespaced under its parent (`"10.3"`), so the parent is what decides.
   */
  const rowIsPresent = useCallback(
    (rowKey: string) => {
      const parentKey = rowKey.split(".")[0]!;
      return data.some((row) => String(rowIdOf(row)) === parentKey);
    },
    [data]
  );

  /**
   * The cell that is really editing: the one `cellState` names, but only while
   * its row is still there.
   *
   * The machine ignores every gesture on every cell while one is editing, and
   * only `editEnd` releases it — which `EditableCell` sends on save, Escape or
   * blur. React fires none of those when a row simply leaves the data, as a
   * background refresh can make it: the editor unmounts with `editing` still
   * naming it, and no gesture is left that could free it. Reading the state
   * through this rather than trusting it is what stops a vanished row taking
   * the whole grid down with it; `dispatchCell` settles the ref the same way.
   */
  const editingCell = useMemo(
    () =>
      cellState.editing && rowIsPresent(cellState.editing.rowKey)
        ? cellState.editing
        : null,
    [cellState.editing, rowIsPresent]
  );

  // The character that opened the editing cell's editor, when one did. It has
  // to outlive the keydown because the editor is not mounted until the render
  // that follows. Every edit begins with an `openEditor` effect, which
  // overwrites it, and it only reaches the cell named as editing, so an earlier
  // edit's seed never seeds a later one.
  const [editSeed, setEditSeed] = useState<{
    cell: CellRef;
    seed: string;
  } | null>(null);

  // Whether the pressed cell already held the selection anchor when the press
  // began. A ref rather than state: it is written and read inside one gesture,
  // which must not re-render between its own mousedown and click.
  const wasFocusedRef = useRef(false);

  const editHintId = `${tableId}-edit-hint`;

  /**
   * Scrolls a cell's row into the virtualised window first (`scrollToIndex`
   * is a no-op unwindowed, and null on the card tier), then waits a frame for
   * the cell to mount before acting on it — a cell scrolled out of the
   * window has nothing in the DOM yet for `querySelector` to find. The index
   * is looked up in the table's whole row model, expanded sub-rows and all,
   * which is what `scrollToIndex` addresses; `rowKey` is `row.id`.
   */
  const reachCell = useCallback(
    (rowKey: string, columnId: string, act: (el: HTMLElement) => void) => {
      const rowIndex = table
        .getRowModel()
        .rows.findIndex((row) => row.id === rowKey);
      if (rowIndex !== -1) scrollToIndex.current?.(rowIndex);
      requestAnimationFrame(() => {
        const el = gridRef.current?.querySelector<HTMLElement>(
          cellSelector(rowKey, columnId)
        );
        if (el) act(el);
      });
    },
    [table, scrollToIndex, gridRef]
  );

  const focusCellElement = useCallback(
    (rowKey: string, columnId: string) => {
      reachCell(rowKey, columnId, (el) => el.focus());
    },
    [reachCell]
  );

  // How a column's cells are entered. Read off the role-gated config, so every
  // column of a viewer's grid is `"none"`: the navigable set stays full and
  // the grid stays selectable and copyable while no gesture can edit it.
  const entryOf = useCallback(
    (columnId: string): EntryMode => cellEntry(editableCells, columnId),
    [editableCells]
  );

  // Whether a typed character means anything on this column. A `date` says no,
  // because its editor cannot show one; see `FieldKind.seedable`.
  const seedableOf = useCallback(
    (columnId: string): boolean => {
      const config = editableCells?.[columnId];
      return config ? fieldKind(config.type).seedable !== false : false;
    },
    [editableCells]
  );

  const applyCellEffect = useCallback(
    (effect: CellEffect) => {
      switch (effect.type) {
        case "toggle": {
          const { rowKey, columnId } = effect.cell;
          const row = table.getRow(rowKey, true);
          const original = row?.original;
          const rowId = original == null ? undefined : rowIdOf(original);
          if (row == null || rowId == null) return;
          // The same target the cell itself renders from: a kind may rename
          // the row field it saves, and reading one field while writing
          // another would flip the box against the wrong value. Without a
          // rename that is the column's own value, which a custom field's
          // column reads from the row's `fields` bag.
          const config = editableCells?.[columnId];
          const saveAs = config && fieldKind(config.type).saveAs;
          const current = saveAs
            ? (original as Record<string, unknown>)[saveAs]
            : row.getValue(columnId);
          void saveCell(rowId, saveAs ?? columnId, current !== true);
          return;
        }
        case "activateSelf":
          // The control opens itself; a click is how a pointer opens it, and
          // dispatching one is the only way in from the keyboard.
          reachCell(effect.cell.rowKey, effect.cell.columnId, (el) =>
            el.querySelector<HTMLElement>("[data-cell-control]")?.click()
          );
          return;
        // The state `openEditor` arrives with names the editing cell, which is
        // what mounts the editor; only the seed it may carry needs keeping.
        case "openEditor":
          setEditSeed(
            effect.seed === undefined
              ? null
              : { cell: effect.cell, seed: effect.seed }
          );
          return;
        case "none":
          return;
      }
    },
    [table, saveCell, editableCells, reachCell]
  );

  const dispatchCell = useCallback(
    (event: CellEvent): CellEffect => {
      const settled = cellStateRef.current;
      // An editing cell whose row has gone never sends `editEnd`, so the ref
      // would swallow every gesture from here on; see `editingCell`.
      const current =
        settled.editing && !rowIsPresent(settled.editing.rowKey)
          ? IDLE_CELL_STATE
          : settled;
      const { state, effect } = cellInteraction(current, event);
      cellStateRef.current = state;
      setCellState(state);
      applyCellEffect(effect);
      return effect;
    },
    [applyCellEffect, rowIsPresent]
  );

  // Leaving the editor returns focus to the owning cell, so the arrow keys go
  // straight back to grid navigation instead of scrolling the page.
  const endEdit = useCallback(
    (rowKey: string, columnId: string) => {
      dispatchCell({ type: "editEnd" });
      focusCellElement(rowKey, columnId);
    },
    [dispatchCell, focusCellElement]
  );

  /**
   * Enters a cell as pressing Enter on it would: an `editor` cell opens its
   * editor, a `self` cell has its own control clicked open.
   */
  const openCell = useCallback(
    (rowKey: string, columnId: string) => {
      dispatchCell({
        type: "enter",
        cell: { rowKey, columnId },
        entry: entryOf(columnId),
      });
    },
    [dispatchCell, entryOf]
  );

  const clipboard = useCellClipboard({
    table,
    editableCells,
    selectableColumnIds,
    editing: editingCell,
    entryOf,
    seedableOf,
    dispatch: dispatchCell,
    saveCell: canSave ? saveCell : undefined,
    ensureLoaded,
    hasMore: loaded.hasMore,
    loadFailed: loaded.state === "error",
    revealCell: focusCellElement,
    scrollToIndex,
  });

  // A plain push, so the grid's keys win over the table's `Enter` and the
  // player's arrows by being the innermost scope. `useCommandScope` re-pushes
  // only when `active` flips, and the table's focus/pointer push is active
  // whenever this one is (`focusInGrid` implies its `pointerInGrid ||
  // focusInGrid`), so that push never newly lands while this one is live. When
  // both flip on in one commit, effects run in hook order and this one lands
  // second, because `DataTable` calls `useCellGrid` after `useRowCursor`. An
  // editor closing re-activates the scope and re-pushes it on top. `onTop` is
  // reserved for the shortcuts overlay: two `onTop` pushes re-push each other.
  useCommandScope(
    GRID_SCOPE,
    clipboard.surface,
    focusInGrid && editingCell === null
  );

  const renderEditableCell = useCallback(
    (
      value: FieldValue,
      display: ReactNode,
      config: EditableCellConfig,
      target: CellTarget
    ) => (
      <EditableCell
        value={value}
        display={display}
        config={config}
        isEditing={
          editingCell?.rowKey === target.rowKey &&
          editingCell?.columnId === target.columnId
        }
        seed={
          editSeed?.cell.rowKey === target.rowKey &&
          editSeed.cell.columnId === target.columnId
            ? editSeed.seed
            : undefined
        }
        onEditEnd={() => endEdit(target.rowKey, target.columnId)}
        onSave={(v) => saveCell(target.rowId, target.field, v)}
      />
    ),
    [saveCell, editingCell, editSeed, endEdit]
  );

  // A kind that is not entered through an editor draws its own control: the
  // status menu, a checkbox. A `self` kind's control opens and saves itself,
  // and what it reports is parsed by the kind first. A `toggle` kind's only
  // shows the value, because the interaction machine's `toggle` effect is the
  // one writer of it — two writers would save the same flip twice. Either
  // control carries `data-cell-control`, which is how a press on it is told
  // from a press on the rest of the cell.
  const renderOwnControl = useCallback(
    (
      kind: FieldKind,
      value: FieldValue,
      config: EditableCellConfig,
      target: CellTarget
    ) => {
      if (kind.entry === "toggle") {
        const Display = kind.Display;
        return (
          <span data-cell-control className="inline-flex items-center">
            <span className="sr-only">
              Toggle {config.label ?? target.columnId}
            </span>
            {Display ? (
              <Display value={value} config={config} />
            ) : (
              kind.format(value, config)
            )}
          </span>
        );
      }
      const Control = kind.DraftInput;
      return (
        <Control
          id={`${tableId}-${target.rowKey}-${target.columnId}`}
          raw={formatScalar(value, config)}
          config={config}
          invalid={false}
          onChange={(raw) => {
            const parsed = kind.parse(raw, config);
            if (parsed.ok) {
              void saveCell(target.rowId, target.field, parsed.value);
            }
          }}
        />
      );
    },
    [saveCell, tableId]
  );

  const hasFocusedCell = table.getFocusedCell() != null;

  /**
   * Selection wiring for a keyboard-navigable cell: the drag handlers (never a
   * `mouseup` — `getSelectionStartHandler` owns a document-level one), a roving
   * tabindex so exactly one cell is in the tab order, a spreadsheet-style inset
   * outline drawn from the cell's selection edges (inset box-shadow, not a
   * border, so a selected cell doesn't change a border-collapse row's height),
   * an `onFocus` that seeds the focused cell when Tab lands on the grid, and
   * the gestures themselves, which are dispatched into the interaction machine
   * rather than decided here.
   */
  const selectionCellProps = useCallback(
    (
      cell: ReturnType<
        ReturnType<typeof table.getRowModel>["rows"][number]["getVisibleCells"]
      >[number],
      isFirstNavigable: boolean
    ) => {
      if (!selectableColumnIds.has(cell.column.id)) return {};
      const edges = cell.getSelectionEdges();
      const target = { rowKey: cell.row.id, columnId: cell.column.id };
      const entry = entryOf(cell.column.id);
      const startSelection = cell.getSelectionStartHandler();
      return {
        "data-cell": `${cell.row.id}::${cell.column.id}`,
        // `entry` is `"none"` for a column the role or the config leaves
        // read-only: it is still selectable and copyable, so it is announced as
        // read-only rather than left indistinguishable from an editable cell.
        "data-editable": entry !== "none" || undefined,
        "aria-readonly": entry === "none" || undefined,
        "aria-selected": cell.getIsSelected(),
        "aria-describedby": entry !== "none" ? editHintId : undefined,
        onMouseDown: (event: ReactMouseEvent<HTMLElement>) => {
          // Read before the selection handler runs: it moves the anchor, so by
          // the time this gesture's click fires every pressed cell reports
          // itself focused and a first click looks like a second.
          wasFocusedRef.current = cell.getIsFocused();
          startSelection(event);
        },
        onMouseEnter: cell.getSelectionExtendHandler(),
        onClick: (event: ReactMouseEvent) => {
          const wasFocused = wasFocusedRef.current;
          // A click with no press of its own — a dispatched one — never counts
          // as the second click on an already-selected cell.
          wasFocusedRef.current = false;
          dispatchCell({
            type: "press",
            cell: target,
            entry,
            wasFocused,
            onControl:
              (event.target as Element).closest("[data-cell-control]") != null,
          });
        },
        onDoubleClick: () =>
          dispatchCell({ type: "doublePress", cell: target, entry }),
        onFocus: () => {
          if (!cell.getIsFocused()) {
            table.setFocusedCell(cell.row.id, cell.column.id);
          }
        },
        tabIndex:
          cell.getTabIndex() === 0 || (!hasFocusedCell && isFirstNavigable)
            ? 0
            : -1,
        "data-selected": cell.getIsSelected() || undefined,
        style: {
          boxShadow: cell.getIsSelected()
            ? [
                edges.top && "inset 0 2px 0 0 var(--art)",
                edges.bottom && "inset 0 -2px 0 0 var(--art)",
                edges.left && "inset 2px 0 0 0 var(--art)",
                edges.right && "inset -2px 0 0 0 var(--art)",
              ]
                .filter(Boolean)
                .join(", ")
            : undefined,
        },
      };
    },
    // `table` is the held table, which changes with the cell selection every
    // prop here is read from.
    [
      table,
      selectableColumnIds,
      entryOf,
      editHintId,
      dispatchCell,
      hasFocusedCell,
    ]
  );

  return useMemo(
    () => ({
      /** The id of the one description every editable cell points at. */
      editHintId,
      onKeyDown: clipboard.onKeyDown,
      onPaste: clipboard.onPaste,
      openCell,
      renderEditableCell,
      renderOwnControl,
      selectionCellProps,
    }),
    [
      editHintId,
      openCell,
      clipboard.onKeyDown,
      clipboard.onPaste,
      renderEditableCell,
      renderOwnControl,
      selectionCellProps,
    ]
  );
}
