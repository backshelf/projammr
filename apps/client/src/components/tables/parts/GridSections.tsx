"use client";

import type { RowData } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useCanvasRoot } from "@workspace/ui/components/layout/scroll-root";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { TableCell, TableRow } from "@workspace/ui/components/table";
import { useDensity } from "@workspace/ui/lib/appearance";
import { LayoutGroup } from "@workspace/ui/lib/motion";
import React, {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";

import {
  type TableRowModel,
  useDataTableConfig,
  useDataTableState,
} from "../data-table-context";
import { siblingsToSettle } from "../draft-visibility";
import type { Section } from "../group-sections";
import { rowIdOf } from "../row-id";
import { DraftTableRow, SeededDraftRow, sectionSeed } from "./Draft";
import { GridRow } from "./GridRow";
import { LoadMoreRetry } from "./LoadMoreRetry";

const NO_SELECTED_IDS: number[] = [];

/** How many items past the viewport the virtualiser keeps mounted, each side;
 *  also the sentinel's trigger distance, there being no page size in the
 *  context to measure "a page from the end" against. */
const OVERSCAN = 10;

/** A first-paint guess for an item's height; `measureElement` corrects it
 *  once it is in the DOM, so this only has to be roughly right. */
const ESTIMATED_ITEM_HEIGHT = 40;

/** How much of that guess is the cells' vertical padding (the entity table's
 *  `py-2`, top and bottom): the part `--density` scales. */
const ESTIMATED_CELL_PADDING = 16;

/** The first-paint guess at a density factor (`useDensity`), so a compact or
 *  spacious table's scroll height is roughly right before a row is measured. */
export const estimatedItemHeight = (density: number) =>
  ESTIMATED_ITEM_HEIGHT + ESTIMATED_CELL_PADDING * (density - 1);

/** One slot of the flattened list the virtualiser indexes: a group's header,
 *  or a row — top-level or sub-row, the virtualiser does not tell them apart. */
type GridItem<TData extends RowData> =
  | { kind: "header"; section: Section<TableRowModel<TData>> }
  | {
      kind: "row";
      row: TableRowModel<TData>;
      rowIndex: number;
      /** Unique across the flattened list: grouped, one row can sit in several sections. */
      key: string;
    };

/**
 * The grid's body: grouped, a header per section with its count, drill-in and
 * add-in-group, then that section's rows and seeded draft; ungrouped, the
 * rows. The ungrouped draft row follows either, so it is there for a table
 * with no rows too.
 *
 * Renders inside a `TableBody`, and only on the grid tier: the rows cost a
 * context menu and a row-actions closure each, which a phone never builds.
 *
 * The rows are windowed: `useVirtualizer` indexes the flattened item list (a
 * header and its rows are separate items) and only the window's items mount,
 * padded above and below by one `aria-hidden` spacer row each rather than
 * TanStack's usual absolute positioning — the grid is a real `table-fixed`
 * table, which has no way to position a row inside itself. Past the last
 * item, a loading strip or a retry row follows, then the pinned draft row.
 * Without a scroll root (`useCanvasRoot()` returns `undefined`: a test, or a
 * page that embeds the table without one) every row mounts instead,
 * unwindowed, and the load-more sentinel never fires.
 */
export function GridSections<
  TData extends RowData,
  TChild = never,
>(): ReactNode {
  const {
    table,
    sections,
    drillInFor,
    urlState,
    newRow,
    activeGroupKey,
    rowActions,
    peek,
    gridRef,
    scrollToIndex,
  } = useDataTableConfig<TData, TChild>();
  const {
    peekId,
    cursorRowId,
    menuRequest,
    selectedIds,
    loaded,
    loadMore,
    retryLoad,
    draft,
  } = useDataTableState<TData>();
  const {
    addingInGroup,
    setAddingInGroup,
    settleSection,
    armSection,
    disarmSection,
  } = draft;

  // `undefined` where nothing published a scroll root (a test, an embedded
  // table with no page scroller); the fallback below renders unwindowed.
  const canvasRoot = useCanvasRoot();
  const windowed = canvasRoot !== undefined;

  const pageRows = table.getRowModel().rows;

  // The pinned actions cell is rendered outside the column model, so a row
  // spanning the full grid has to count it too.
  const visibleLeafCount =
    table.getVisibleLeafColumns().length + (rowActions ? 1 : 0);

  // A seeded draft opens directly under its section header, so the rows that
  // move for it are that section's own. Everything below keeps its place. The
  // walk costs a pass over the page only while a section is armed.
  const settlingRowIds = ((): ReadonlySet<string> | null => {
    if (!sections || !settleSection) return null;
    const sectionedRows = sections.flatMap((section) =>
      section.rows.map((row) => ({ id: row.id, sectionKey: section.key }))
    );
    return siblingsToSettle(
      sectionedRows,
      sectionedRows.findIndex((row) => row.sectionKey === settleSection),
      settleSection
    );
  })();

  // The flattened list the virtualiser indexes: grouped, each section's
  // header followed by its own rows; ungrouped, the page's rows. A section's
  // seeded draft row is not in it — closed, it costs nothing (an
  // `AnimatePresence` with nothing to show), so it travels with its header
  // outside the window rather than costing every row after it a measured slot
  // it only occasionally needs.
  const items = useMemo((): GridItem<TData>[] => {
    if (!sections) {
      return pageRows.map((row, rowIndex): GridItem<TData> => ({
        kind: "row",
        row,
        rowIndex,
        key: row.id,
      }));
    }
    const indexOfRow = new Map(pageRows.map((row, index) => [row.id, index]));
    const flattened: GridItem<TData>[] = [];
    for (const section of sections) {
      flattened.push({ kind: "header", section });
      for (const row of section.rows) {
        flattened.push({
          kind: "row",
          row,
          rowIndex: indexOfRow.get(row.id) ?? 0,
          key: `${section.key}:${row.id}`,
        });
      }
    }
    return flattened;
  }, [sections, pageRows]);

  // `canvasRoot` is a ref, attached during the same commit's layout phase as
  // this component's own layout effects — an ancestor's ref can still be
  // unattached the first time this runs, so the very first render can find no
  // scroll element. One extra render once mount has fully settled (every ref
  // in the tree attached by the time a passive effect runs) lets both the
  // margin below and the virtualiser see it.
  const [refsSettled, setRefsSettled] = useState(0);
  useEffect(() => {
    // eslint-disable-next-line @eslint-react/set-state-in-effect -- the state exists only to force this one extra render; see the comment above
    setRefsSettled((n) => n + 1);
  }, []);

  // The tbody's own offset inside the scroll root: content above it (the
  // toolbar, the sticky header) is real height the virtualiser's coordinate
  // system otherwise knows nothing about, so a long scroll down would read as
  // still being near the top. Measured once the scroll root and the grid
  // wrapper both exist — `gridRef` is the grid's own wrapper, the closest
  // marker to the tbody the config half hands this part.
  const [scrollMargin, setScrollMargin] = useState(0);
  useLayoutEffect(() => {
    const root = canvasRoot?.current;
    const grid = gridRef.current;
    if (!root || !grid) return;
    const theadHeight =
      grid.querySelector("thead")?.getBoundingClientRect().height ?? 0;
    setScrollMargin(
      grid.getBoundingClientRect().top -
        root.getBoundingClientRect().top +
        root.scrollTop +
        theadHeight
    );
  }, [canvasRoot, gridRef, refsSettled]);

  const density = useDensity();
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => canvasRoot?.current ?? null,
    estimateSize: () => estimatedItemHeight(density),
    overscan: OVERSCAN,
    scrollMargin,
  });

  // The scroll handle takes a row index (a row's position in `pageRows`);
  // grouped, a section header is its own slot in `items`, so a row's index
  // there can run ahead of its row index. Row items already carry their row
  // index, so this maps back from it to find the handle's target slot.
  const flatIndexByRowIndex = useMemo(() => {
    const map = new Map<number, number>();
    items.forEach((item, flatIndex) => {
      if (item.kind === "row") map.set(item.rowIndex, flatIndex);
    });
    return map;
  }, [items]);

  // Later tasks (the row cursor, peek, the cell grid) walk past the loaded
  // window through this ref instead of reaching for the virtualiser
  // themselves, which only this part holds.
  useEffect(() => {
    if (!windowed) return;
    scrollToIndex.current = (rowIndex) => {
      const flatIndex = flatIndexByRowIndex.get(rowIndex);
      if (flatIndex == null) return;
      virtualizer.scrollToIndex(flatIndex, { align: "auto" });
    };
    return () => {
      scrollToIndex.current = null;
    };
  }, [windowed, virtualizer, scrollToIndex, flatIndexByRowIndex]);

  const virtualItems = virtualizer.getVirtualItems();
  const lastVirtualItem = virtualItems.at(-1);
  const paddingTop =
    windowed && virtualItems[0]
      ? Math.max(virtualItems[0].start - scrollMargin, 0)
      : 0;
  const paddingBottom =
    windowed && lastVirtualItem
      ? Math.max(
          virtualizer.getTotalSize() - (lastVirtualItem.end - scrollMargin),
          0
        )
      : 0;

  // Grouped mode is a per-group preview, not a page, so there is nothing to
  // append (the root reports no more rows while grouped, too). Ungrouped only,
  // and only once there is a window to have scrolled to the end of.
  const nearEnd =
    windowed &&
    !sections &&
    lastVirtualItem !== undefined &&
    items.length - 1 - lastVirtualItem.index <= OVERSCAN;
  useEffect(() => {
    if (!nearEnd || !loaded.hasMore || loaded.state !== "idle") return;
    void loadMore();
  }, [nearEnd, loaded.hasMore, loaded.state, loadMore]);

  // A row is memoised on its props, so everything about it that changes as the
  // table is used is worked out here, where the root's state is read, and
  // handed down; an unticked row's selection is one shared empty list.
  const gridRow = (
    row: TableRowModel<TData>,
    rowIndex: number,
    flatIndex: number
  ) => {
    const isTopLevel = row.depth === 0;
    const rowId = rowIdOf(row.original);
    const selected = row.getIsSelected();
    return (
      <GridRow<TData, TChild>
        row={row}
        rowIndex={rowIndex}
        flatIndex={flatIndex}
        rowRef={windowed ? virtualizer.measureElement : undefined}
        isCursor={isTopLevel && row.id === cursorRowId}
        isPeeked={
          Boolean(peek) && isTopLevel && rowId != null && rowId === peekId
        }
        settling={settlingRowIds?.has(row.id) ?? false}
        selected={selected}
        selectedIds={selected ? selectedIds : NO_SELECTED_IDS}
        menuRequest={
          isTopLevel && rowId != null && menuRequest?.rowId === rowId
            ? menuRequest
            : null
        }
      />
    );
  };

  const renderHeader = (
    section: Section<TableRowModel<TData>>,
    flatIndex: number
  ): ReactNode => {
    const drillIn = drillInFor(section);
    const seed = sectionSeed(newRow, activeGroupKey, section.key);
    const isAdding = addingInGroup === section.key;
    return (
      <React.Fragment key={`header:${section.key}`}>
        <TableRow
          ref={windowed ? virtualizer.measureElement : undefined}
          data-index={flatIndex}
          role="row"
          aria-rowindex={flatIndex + 2}
          className="bg-paper-sunk hover:bg-paper-sunk"
        >
          <TableCell colSpan={visibleLeafCount} className="py-1.5 font-medium">
            {section.label}
            <span className="ml-2 font-normal text-ink-soft">
              {section.count}
            </span>
            {seed && (
              <button
                type="button"
                aria-label={`Add to ${section.label}`}
                className="ml-3 font-normal text-art hover:underline"
                onPointerDown={() => armSection(section.key)}
                onFocus={() => armSection(section.key)}
                onPointerLeave={() => {
                  if (!isAdding) disarmSection(section.key);
                }}
                onClick={() => setAddingInGroup(isAdding ? null : section.key)}
              >
                {isAdding ? "Cancel" : "+ Add"}
              </button>
            )}
            {drillIn && (
              <button
                type="button"
                className="ml-3 font-normal text-art hover:underline"
                onClick={() =>
                  urlState.drillIntoGroup(drillIn.param, drillIn.value)
                }
              >
                Show all {section.count} →
              </button>
            )}
          </TableCell>
        </TableRow>
        <SeededDraftRow<TData, TChild> section={section} />
      </React.Fragment>
    );
  };

  const renderItem = (item: GridItem<TData>, flatIndex: number): ReactNode => {
    if (item.kind === "header") return renderHeader(item.section, flatIndex);
    return (
      <React.Fragment key={item.key}>
        {gridRow(item.row, item.rowIndex, flatIndex)}
      </React.Fragment>
    );
  };

  const renderedRows = windowed
    ? virtualItems.map((virtualItem) => {
        const item = items[virtualItem.index];
        return item ? renderItem(item, virtualItem.index) : null;
      })
    : items.map((item, index) => renderItem(item, index));

  return (
    // One group, so a draft row and the rows it displaces measure against
    // each other rather than each on its own.
    <LayoutGroup>
      {pageRows.length > 0 && (
        <>
          {paddingTop > 0 && (
            <tr aria-hidden>
              <td colSpan={visibleLeafCount} style={{ height: paddingTop }} />
            </tr>
          )}
          {renderedRows}
          {paddingBottom > 0 && (
            <tr aria-hidden>
              <td
                colSpan={visibleLeafCount}
                style={{ height: paddingBottom }}
              />
            </tr>
          )}
          {windowed &&
            !sections &&
            loaded.state === "loading" &&
            Array.from({ length: 5 }, (_, i) => (
              <TableRow key={`load-more-skeleton:${i}`} aria-hidden>
                <TableCell colSpan={visibleLeafCount}>
                  <Skeleton className="h-4 w-3/4" />
                </TableCell>
              </TableRow>
            ))}
          {windowed && !sections && loaded.state === "error" && (
            <TableRow>
              <TableCell colSpan={visibleLeafCount}>
                <LoadMoreRetry onRetry={() => void retryLoad()} />
              </TableCell>
            </TableRow>
          )}
        </>
      )}
      <DraftTableRow<TData, TChild> />
    </LayoutGroup>
  );
}
