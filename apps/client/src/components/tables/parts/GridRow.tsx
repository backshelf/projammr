"use client";

import { fieldKind } from "@/fields";
import type { FieldValue } from "@/fields/types";
import {
  type TableRowModel,
  useDataTableConfig,
} from "@/components/tables/data-table-context";
import { isLeadingColumnId } from "@/components/tables/leading-columns";
import {
  MotionTableRow,
  type MotionTableRowProps,
} from "@/components/tables/motion-row";
import { rowIdOf } from "@/components/tables/row-id";
import {
  RowActionsBar,
  RowContextMenuItems,
  type RowMenuRequest,
} from "@/components/tables/RowActions";
import { useRowActions } from "@/components/tables/use-row-actions";
import type { RowData } from "@tanstack/react-table";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@workspace/ui/components/context-menu";
import {
  PINNED_CELL,
  TableCell,
  TableRow,
} from "@workspace/ui/components/table";
import { cn } from "@workspace/ui/lib/utils";
import { memo, type ReactNode } from "react";

/**
 * What marks a cell as editable, on a fine pointer hover: a 1px inset hairline
 * in the stronger rule token and the text cursor. An outline rather than a
 * box-shadow, so it composes with the selection's inset `--art` edges instead
 * of replacing them, and it steps aside for the focus ring. A cell that is its
 * own control (a toggle, a status trigger) gets the pointer on that control
 * instead of an I-beam.
 */
const EDITABLE_CELL =
  "data-editable:cursor-text fine:data-editable:not-focus-visible:hover:outline-1 fine:data-editable:not-focus-visible:hover:-outline-offset-1 fine:data-editable:not-focus-visible:hover:outline-rule-strong data-editable:[&_[data-cell-control]]:cursor-pointer";

/**
 * A row's element. It travels to its new place while a draft row is open in
 * its section and is a plain row the rest of the time: Motion measures a
 * layout-enabled element on every render, which a table nobody is adding to
 * has no use for.
 */
function SettlingRow({
  settling,
  ...props
}: MotionTableRowProps & { settling: boolean }) {
  if (!settling) return <TableRow {...props} />;
  return <MotionTableRow layout="position" {...props} />;
}

type GridRowProps<TData extends RowData> = {
  /** The table's row model; a refetch hands the row a new one. */
  row: TableRowModel<TData>;
  /** Its place in the page: the first row holds the grid's tab stop. */
  rowIndex: number;
  /**
   * Its place in the flattened item list the virtualiser indexes (a group's
   * header counts as one slot); `aria-rowindex` and `data-index` read off it
   * rather than `rowIndex`, which does not count headers.
   */
  flatIndex: number;
  /**
   * The virtualiser's `measureElement`, so a row of unknown height reports its
   * real one; `undefined` where the grid has no virtualiser (no scroll root).
   * Stable for the table's life, so it costs the row no re-render.
   */
  rowRef?: (node: HTMLTableRowElement | null) => void;
  /** Whether the keyboard cursor is on it. */
  isCursor: boolean;
  /** Whether it is the row open in the peek panel. */
  isPeeked: boolean;
  /** Whether it moves for a draft row opening beside it. */
  settling: boolean;
  /**
   * Whether it is ticked. Its checkbox cell reads that off the row itself; the
   * prop is what re-renders the row when the tick changes.
   */
  selected: boolean;
  /**
   * The selection its actions act on: every ticked id while the row is
   * ticked, else none, so a tick elsewhere leaves an unticked row alone.
   */
  selectedIds: number[];
  /** A key's request to open this row's `⋯` menu with a submenu open. */
  menuRequest: RowMenuRequest | null;
};

/**
 * One row of the grid: its cells, the pinned actions cell, click-to-peek and
 * the context menu. It reads only the root's config half; what changes per
 * row as the table is used arrives as props.
 */
function GridRowBody<TData extends RowData, TChild = never>({
  row,
  rowIndex,
  flatIndex,
  rowRef,
  isCursor,
  isPeeked,
  settling,
  selectedIds,
  menuRequest,
}: GridRowProps<TData>): ReactNode {
  const config = useDataTableConfig<TData, TChild>();
  const {
    table,
    entityLabel,
    peek,
    setPeekId,
    rowClick,
    openRow,
    rowActions,
    pinnedColumnId,
    subRows,
    editableCells,
    firstNavigableColumnId,
    leadingColumnCount,
    cellGrid,
    setMenuRequest,
  } = config;
  const buildRowActions = useRowActions<TData, TChild>({
    ...config,
    selectedIds,
  });

  const renderCellContent = (
    cell: ReturnType<typeof row.getVisibleCells>[number],
    rowId: number | undefined
  ): ReactNode => {
    // A sub-row is a different entity: its cells come from the hierarchy
    // config, keyed by the parent column they sit under.
    if (row.depth > 0) {
      if (isLeadingColumnId(cell.column.id)) {
        return <table.FlexRender cell={cell} />;
      }
      return subRows?.cells[cell.column.id]?.(
        row.original as unknown as TChild
      );
    }

    const editable = editableCells?.[cell.column.id];
    if (editable && rowId != null) {
      const kind = fieldKind(editable.type);
      const rowValue = kind.saveAs
        ? (row.original as Record<string, unknown>)[kind.saveAs]
        : cell.getValue();
      const value = (rowValue ?? null) as FieldValue;
      const target = {
        field: kind.saveAs ?? cell.column.id,
        columnId: cell.column.id,
        rowId,
        rowKey: row.id,
      };
      return kind.entry === "editor"
        ? cellGrid.renderEditableCell(
            value,
            <table.FlexRender cell={cell} />,
            editable,
            target
          )
        : cellGrid.renderOwnControl(kind, value, editable, target);
    }

    return <table.FlexRender cell={cell} />;
  };

  const rowId = rowIdOf(row.original);
  const isTopLevel = row.depth === 0;
  const peekable = Boolean(peek) && isTopLevel;
  const actions =
    rowActions != null && isTopLevel && rowId != null
      ? buildRowActions(row.original, rowId)
      : null;

  const tableRow = (
    <SettlingRow
      settling={settling}
      ref={rowRef}
      data-index={flatIndex}
      data-peeked={isPeeked || undefined}
      data-cursor={isCursor || undefined}
      role="row"
      aria-rowindex={flatIndex + 2}
      // `aria-selected` belongs to the cell grid; the open row is the
      // current one, not a selected one.
      aria-current={isPeeked || undefined}
      className={cn(
        // An overlay rather than an outline: a row's outline paints beneath
        // its sticky cells, whose opaque backgrounds would break the ring.
        // Every row carries the ring and hides it, so `j`/`k` fade one out
        // as the next fades in and the ring reads as one thing travelling.
        "group/row relative after:pointer-events-none after:absolute after:inset-0 after:z-3 after:border after:border-art after:opacity-0 after:motion-reveal data-cursor:after:opacity-100",
        peekable && "cursor-pointer",
        // A left rule rather than a fill: the open row stays legible against
        // the hover and selection backgrounds it also has to coexist with.
        isPeeked &&
          "bg-ink/6 shadow-[inset_2px_0_0_0_var(--art)] hover:bg-ink/6"
      )}
      onClick={
        peekable
          ? (e) => {
              // Anything the cell itself handles wins: links, buttons,
              // checkboxes, and the inline editors.
              const target = e.target as HTMLElement;
              if (
                target.closest(
                  'a, button, input, textarea, select, [role="menuitem"], [contenteditable="true"]'
                )
              )
                return;
              // A navigable cell belongs to the keyboard/selection grid:
              // clicking one focuses it for editing rather than peeking, so
              // the two interactions never fight over the same click.
              if (target.closest("[data-cell]")) return;
              // A drag that happened to end on this row (a resize, a
              // selection sweep) is not a click on it.
              if (window.getSelection()?.toString()) return;
              if (rowClick === "open") {
                openRow(row.original);
              } else {
                setPeekId(rowId ?? null);
              }
            }
          : undefined
      }
    >
      {row.getVisibleCells().map((cell, cellIndex) => {
        const isLeadingColumn = isLeadingColumnId(cell.column.id);
        const firstDataColumn =
          cellIndex === leadingColumnCount && !isLeadingColumn;

        // Inline editing and keyboard selection apply to top-level rows
        // only: a sub-row is a different entity type, so a
        // `PATCH /<parent-kind>/:id` from its cell would hit the wrong table.
        const isFirstNavigable =
          isTopLevel &&
          rowIndex === 0 &&
          firstNavigableColumnId === cell.column.id;
        const selProps: ReturnType<typeof cellGrid.selectionCellProps> =
          isTopLevel ? cellGrid.selectionCellProps(cell, isFirstNavigable) : {};
        const isEditingCell = Boolean(selProps["data-editing"]);

        return (
          <TableCell
            key={cell.id}
            role="gridcell"
            aria-colindex={cellIndex + 1}
            {...selProps}
            style={{
              width: cell.column.getSize(),
              ...(firstDataColumn && !isTopLevel
                ? { paddingLeft: 12 + row.depth * 20 }
                : {}),
              ...selProps.style,
            }}
            className={cn(
              isEditingCell
                ? "relative z-20 overflow-visible"
                : "overflow-hidden",
              "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
              EDITABLE_CELL,
              isLeadingColumn && "px-0 text-center [&>*]:mx-auto",
              cell.column.id === pinnedColumnId && PINNED_CELL
            )}
            data-slot={cell.column.id === pinnedColumnId ? "pinned" : undefined}
          >
            <div className={isEditingCell ? "relative" : "clip-cell"}>
              <table.AppCell cell={cell}>
                {(appCell) => renderCellContent(appCell, rowId)}
              </table.AppCell>
            </div>
          </TableCell>
        );
      })}
      {rowActions && (
        // Pinned to the viewport's right edge rather than trailing the last
        // column: the grid is routinely wider than the window, and a trailing
        // cell would scroll out of reach exactly when it is wanted. Hidden
        // until the row is hovered or the bar takes focus on fine pointers, so
        // a table at rest shows data and nothing else.
        <TableCell
          role="gridcell"
          aria-colindex={row.getVisibleCells().length + 1}
          className="sticky right-0 z-2 w-0 p-0 fine:opacity-0 fine:motion-reveal fine:group-hover/row:opacity-100 fine:focus-within:opacity-100 fine:has-aria-expanded:opacity-100"
          style={{ width: 0 }}
        >
          {actions && (
            // Matches the row's composited surface (`--paper`, 4% hover wash,
            // or 6% peek wash) with a 16px left fade gradient so the trailing
            // cell eases under the controls without a hard seam or tinted slab.
            <div
              data-slot="row-actions-plate"
              className={cn(
                "pointer-events-none absolute top-0 right-0 flex h-full items-center gap-0.5 bg-(--row-plate-bg) pr-2 pl-2 [&_a]:pointer-events-auto [&_button]:pointer-events-auto",
                isPeeked
                  ? "[--row-plate-bg:color-mix(in_oklab,var(--ink)_6%,var(--paper))]"
                  : "[--row-plate-bg:var(--paper)] group-hover/row:[--row-plate-bg:color-mix(in_oklab,var(--ink)_4%,var(--paper))]",
                "before:pointer-events-none before:absolute before:inset-y-0 before:-left-4 before:w-4 before:bg-[linear-gradient(to_right,transparent,var(--row-plate-bg))]"
              )}
            >
              <RowActionsBar
                config={actions}
                target={actions.target}
                entityLabel={entityLabel}
                menuRequest={menuRequest}
                onMenuClose={() => setMenuRequest(null)}
              />
            </div>
          )}
        </TableCell>
      )}
    </SettlingRow>
  );

  if (!actions) return tableRow;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{tableRow}</ContextMenuTrigger>
      <ContextMenuContent className="min-w-44">
        <RowContextMenuItems config={actions} target={actions.target} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

/**
 * One row of the grid, memoised: a cursor move, a peek or a tick re-renders
 * the rows whose props it changes and no others. Anything a row draws through
 * the table (columns, their sizes and order, the cell grid's selection) changes
 * the config half, which re-renders every row. `memo` drops the row's type
 * parameters; the cast restores them.
 */
export const GridRow = memo(GridRowBody) as typeof GridRowBody;
