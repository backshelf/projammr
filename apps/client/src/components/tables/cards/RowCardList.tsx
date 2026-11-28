"use client";

import { useDragSensors } from "@/lib/drag-sensors";
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  useSensor,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Button } from "@workspace/ui/components/button";
import { useCanvasRoot } from "@workspace/ui/components/layout/scroll-root";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { LABEL } from "@workspace/ui/lib/shell";
import { cn } from "@workspace/ui/lib/utils";
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";

import type { RowActionsConfig, RowActionsTarget } from "../RowActions";
import type { LoadedStatus } from "../use-loaded-window";
import { LoadMoreRetry } from "../parts/LoadMoreRetry";
import { RowActionSheet } from "./RowActionSheet";
import { RowCard } from "./RowCard";
import type { RowCardModel } from "./row-card-model";

export type RowCardActions = RowActionsConfig & { target: RowActionsTarget };

/**
 * A run of cards under one heading. An ungrouped list is a single section with
 * no `label`, which draws no heading — the same shape either way, so the list
 * has one path through its rows rather than a grouped one and a flat one.
 */
export type RowCardSection = {
  key: string;
  label?: string;
  /** The group's size across the whole filtered set, not just this page. */
  count: number;
  rows: RowCardModel[];
  /** Narrows the list to this group. Absent when the page holds it all. */
  onShowAll?: () => void;
};

/** Ticking rows for a bulk action, in place of opening them. */
export type RowCardSelection = {
  selectedIds: ReadonlySet<number>;
  onToggle: (id: number) => void;
  /** Leaves select mode; the list's only way out of it. */
  onDone: () => void;
};

/** Disclosing a row's children beneath it. */
export type RowCardExpansion = {
  expandedIds: ReadonlySet<number>;
  onToggle: (id: number) => void;
};

/** How many items past the viewport the virtualiser keeps mounted, each side;
 *  also the sentinel's trigger distance — the same rule `GridSections` uses. */
const OVERSCAN = 10;

/** A first-paint guess for a card's height; `measureElement` corrects it once
 *  it is in the DOM, so this only has to be roughly right. */
const ESTIMATED_ITEM_HEIGHT = 76;

/** One slot of the flattened list the virtualiser indexes: a section's
 *  heading, or a card. */
type CardItem =
  | { kind: "header"; section: RowCardSection }
  | {
      kind: "row";
      row: RowCardModel;
      /** Unique across the flattened list: grouped, one row can sit in several sections. */
      key: string;
    };

function SectionHeading({ section }: { section: RowCardSection }) {
  return (
    <h3
      className={cn(
        LABEL,
        "flex items-center gap-2 bg-paper/95 px-(--gutter) py-2 text-ink-soft backdrop-blur-sm"
      )}
    >
      <span className="truncate">{section.label}</span>
      <span className="text-ink-soft">{section.count}</span>
      {section.onShowAll ? (
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto shrink-0 text-art"
          onClick={section.onShowAll}
        >
          Show all {section.count} →
        </Button>
      ) : null}
    </h3>
  );
}

/**
 * The table's rows as a stacked list, for widths where a grid of real columns
 * cannot be read. It draws from the same loaded rows the table would, so
 * search, filters and grouping all still apply — only the presentation
 * changes.
 *
 * `getActions` is called for the one row whose sheet is open rather than for
 * every row, since building a row's actions closes over the whole selection.
 *
 * The rows are windowed the way a long tree is: `useVirtualizer`
 * indexes the flattened item list (a section's heading is its own slot, same
 * as `GridSections`) and only the window's items mount, absolutely positioned
 * — a list of divs has no table row to pad instead. `measureElement` corrects
 * each item's height, since a card's differs with its meta line and whether
 * it is expanded. Without a scroll root (`useCanvasRoot()` returns
 * `undefined`: a test, or a page that embeds the list without one) every card
 * mounts instead, unwindowed, and the load-more sentinel never fires — the
 * list falls back to its original, un-virtualised markup so a grouped list's
 * per-section `role="list"` stays intact there.
 */
function SortableRowCard({
  row,
  entityLabel,
}: {
  row: RowCardModel;
  entityLabel: string;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: row.id });

  return (
    <RowCard
      cardRef={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      isDragging={isDragging}
      row={row}
      entityLabel={entityLabel}
      dragHandle={{ attributes, listeners }}
    />
  );
}

export function RowCardList({
  sections,
  entityLabel,
  getActions,
  selection,
  expansion,
  grouped,
  loaded,
  loadMore,
  retryLoad,
  reorder,
  scrollToIndex,
}: {
  sections: RowCardSection[];
  entityLabel: string;
  getActions?: (id: number) => RowCardActions | null;
  /** Present only while the list is in select mode. */
  selection?: RowCardSelection;
  expansion?: RowCardExpansion;
  /** Grouped mode is a per-group preview, not a page: the sentinel never
   *  fires while it is on, the same rule `GridSections` follows. */
  grouped: boolean;
  loaded: LoadedStatus;
  loadMore: () => Promise<void>;
  retryLoad: () => Promise<void>;
  reorder?: {
    onMove: (rowId: number, trackNumber: number) => Promise<boolean>;
  };
  scrollToIndex: RefObject<((index: number) => void) | null>;
}) {
  // The row whose sheet is open, and whether it is showing. The two are
  // separate because the row outlives the closing: the sheet plays its exit
  // animation from the mounted Radix root, which needs the row it was opened
  // for to still be there while it leaves.
  const [sheetRowId, setSheetRowId] = useState<number | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [reorderMode, setReorderMode] = useState(false);
  const [activeDragId, setActiveDragId] = useState<number | null>(null);
  const [optimisticRows, setOptimisticRows] = useState<{
    base: RowCardModel[];
    rows: RowCardModel[];
  } | null>(null);

  const sourceRows = useMemo(() => sections[0]?.rows ?? [], [sections]);
  const canReorder = Boolean(
    reorder && !grouped && !selection && sourceRows.length > 0
  );
  const isReordering = canReorder && reorderMode;
  const reorderRows =
    optimisticRows?.base === sourceRows ? optimisticRows.rows : sourceRows;
  const activeDragRow =
    activeDragId == null
      ? null
      : (reorderRows.find((r) => r.id === activeDragId) ?? null);

  const keyboardSensor = useSensor(KeyboardSensor, {
    coordinateGetter: sortableKeyboardCoordinates,
  });
  const sensors = useDragSensors(keyboardSensor);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveDragId(Number(event.active.id));
  }, []);

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      setActiveDragId(null);
      const { active, over } = event;
      if (!over || active.id === over.id || !reorder) return;
      const oldIndex = reorderRows.findIndex((r) => r.id === Number(active.id));
      const newIndex = reorderRows.findIndex((r) => r.id === Number(over.id));
      if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return;

      const targetTrackNumber =
        reorderRows[newIndex]?.trackNumber ?? newIndex + 1;
      const nextRows = arrayMove(reorderRows, oldIndex, newIndex).map(
        (r, i) => ({
          ...r,
          trackNumber: i + 1,
        })
      );
      setOptimisticRows({ base: sourceRows, rows: nextRows });

      const ok = await reorder.onMove(Number(active.id), targetTrackNumber);
      if (!ok) setOptimisticRows(null);
    },
    [reorder, reorderRows, sourceRows]
  );

  const openSheet = useCallback((id: number) => {
    setSheetRowId(id);
    setSheetOpen(true);
  }, []);

  const sheetRow =
    sheetRowId == null
      ? null
      : (sections
          .flatMap((section) => section.rows)
          .find((row) => row.id === sheetRowId) ?? null);
  const actions = getActions && sheetRow ? getActions(sheetRow.id) : null;

  const renderCard = (row: RowCardModel) => (
    <RowCard
      key={row.id}
      row={row}
      entityLabel={entityLabel}
      onOpenActions={getActions ? openSheet : undefined}
      selected={selection?.selectedIds.has(row.id)}
      onToggleSelect={selection?.onToggle}
      expanded={expansion?.expandedIds.has(row.id)}
      onToggleExpand={expansion?.onToggle}
    />
  );

  // `undefined` where nothing published a scroll root (a test, an embedded
  // list with no page scroller); the fallback below renders unwindowed.
  const canvasRoot = useCanvasRoot();
  const windowed = canvasRoot !== undefined;

  // The flattened list the virtualiser indexes: a section's heading (only
  // where it has a label — the ungrouped list's one section has none),
  // followed by its own cards.
  const items = useMemo((): CardItem[] => {
    const flattened: CardItem[] = [];
    for (const section of sections) {
      if (section.label) flattened.push({ kind: "header", section });
      for (const row of section.rows) {
        flattened.push({ kind: "row", row, key: `${section.key}:${row.id}` });
      }
    }
    return flattened;
  }, [sections]);

  // The scroll handle takes a row's position in the table's page rows; a
  // section heading has no row index, so it never claims a slot here.
  const flatIndexByRowIndex = useMemo(() => {
    const map = new Map<number, number>();
    items.forEach((item, flatIndex) => {
      if (item.kind === "row") map.set(item.row.rowIndex, flatIndex);
    });
    return map;
  }, [items]);

  const listRef = useRef<HTMLDivElement>(null);

  // `canvasRoot` is a ref, attached during the same commit's layout phase as
  // this component's own layout effects — an ancestor's ref can still be
  // unattached the first time this runs, so the very first render can find no
  // scroll element. One extra render once mount has fully settled lets both
  // the margin below and the virtualiser see it — the same fix `GridSections`
  // uses.
  const [refsSettled, setRefsSettled] = useState(0);
  useEffect(() => {
    // eslint-disable-next-line @eslint-react/set-state-in-effect -- the state exists only to force this one extra render; see the comment above
    setRefsSettled((n) => n + 1);
  }, []);

  // The list's own offset inside the scroll root: content above it (the
  // toolbar, the select-mode bar) is real height the virtualiser's coordinate
  // system otherwise knows nothing about.
  const [scrollMargin, setScrollMargin] = useState(0);
  useLayoutEffect(() => {
    const root = canvasRoot?.current;
    const list = listRef.current;
    if (!root || !list) return;
    setScrollMargin(
      list.getBoundingClientRect().top -
        root.getBoundingClientRect().top +
        root.scrollTop
    );
  }, [canvasRoot, refsSettled]);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => canvasRoot?.current ?? null,
    estimateSize: () => ESTIMATED_ITEM_HEIGHT,
    overscan: OVERSCAN,
    scrollMargin,
  });

  // Later tasks walk past the loaded window through this ref instead of
  // reaching for the virtualiser themselves, which only this part holds —
  // the same handoff `GridSections` makes while it is the mounted view.
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

  const nearEnd =
    windowed &&
    !grouped &&
    lastVirtualItem !== undefined &&
    items.length - 1 - lastVirtualItem.index <= OVERSCAN;
  useEffect(() => {
    if (!nearEnd || !loaded.hasMore || loaded.state !== "idle") return;
    void loadMore();
  }, [nearEnd, loaded.hasMore, loaded.state, loadMore]);

  return (
    <div className="-mx-(--gutter) border-t border-rule">
      {selection ? (
        <div className="flex min-h-11 items-center justify-between gap-2 border-b border-rule px-(--gutter) py-1.5">
          <span className={cn(LABEL, "text-ink-soft")}>Select</span>
          <Button variant="ghost" size="sm" onClick={selection.onDone}>
            Done
          </Button>
        </div>
      ) : isReordering ? (
        <div className="flex min-h-11 items-center justify-between gap-2 border-b border-rule px-(--gutter) py-1.5">
          <span className={cn(LABEL, "text-ink-soft")}>Reorder</span>
          <Button
            variant="ghost"
            size="sm"
            className="coarse:min-h-11"
            onClick={() => setReorderMode(false)}
          >
            Done
          </Button>
        </div>
      ) : canReorder ? (
        <div className="flex min-h-11 items-center justify-end gap-2 border-b border-rule px-(--gutter) py-1">
          <Button
            variant="ghost"
            size="sm"
            className="coarse:min-h-11"
            onClick={() => setReorderMode(true)}
          >
            Reorder
          </Button>
        </div>
      ) : null}

      {isReordering ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={(e) => void handleDragEnd(e)}
          onDragCancel={() => setActiveDragId(null)}
        >
          <SortableContext
            items={reorderRows.map((r) => r.id)}
            strategy={verticalListSortingStrategy}
          >
            <div role="list">
              {reorderRows.map((row) => (
                <SortableRowCard
                  key={row.id}
                  row={row}
                  entityLabel={entityLabel}
                />
              ))}
            </div>
          </SortableContext>
          <DragOverlay>
            {activeDragRow ? (
              <div className="rounded-md border border-rule bg-paper shadow-overlay">
                <RowCard row={activeDragRow} entityLabel={entityLabel} />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      ) : windowed ? (
        <div ref={listRef}>
          <div
            role="list"
            style={{
              height: virtualizer.getTotalSize(),
              width: "100%",
              position: "relative",
            }}
          >
            {virtualItems.map((virtualItem) => {
              const item = items[virtualItem.index];
              if (!item) return null;
              return (
                <div
                  key={
                    item.kind === "header"
                      ? `header:${item.section.key}`
                      : item.key
                  }
                  ref={virtualizer.measureElement}
                  data-index={virtualItem.index}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    // `virtualItem.start` carries `scrollMargin` baked in (an
                    // "absolute", scroll-root-relative coordinate);
                    // `getTotalSize()` — this container's own height — does
                    // not, so the item's local offset needs it subtracted
                    // back out, the way `GridSections` derives its padding
                    // spacers from the same two numbers.
                    transform: `translateY(${virtualItem.start - scrollMargin}px)`,
                  }}
                >
                  {item.kind === "header" ? (
                    <SectionHeading section={item.section} />
                  ) : (
                    renderCard(item.row)
                  )}
                </div>
              );
            })}
          </div>
          {!grouped && loaded.state === "loading" && (
            <div aria-hidden>
              {Array.from({ length: 5 }, (_, i) => (
                <div
                  key={`load-more-skeleton:${i}`}
                  className="flex min-h-14 items-center px-(--gutter) py-2.5"
                >
                  <Skeleton className="h-11 w-full" />
                </div>
              ))}
            </div>
          )}
          {!grouped && loaded.state === "error" && (
            <div className="px-(--gutter) py-2.5">
              <LoadMoreRetry onRetry={() => void retryLoad()} />
            </div>
          )}
        </div>
      ) : (
        sections.map((section) => (
          <Fragment key={section.key}>
            {section.label ? (
              <h3
                className={cn(
                  LABEL,
                  "sticky top-0 z-1 flex items-center gap-2 bg-paper/95 px-(--gutter) py-2 text-ink-soft backdrop-blur-sm"
                )}
              >
                <span className="truncate">{section.label}</span>
                <span className="text-ink-soft">{section.count}</span>
                {section.onShowAll ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto shrink-0 text-art"
                    onClick={section.onShowAll}
                  >
                    Show all {section.count} →
                  </Button>
                ) : null}
              </h3>
            ) : null}
            <div role="list" aria-label={section.label}>
              {section.rows.map((row) => renderCard(row))}
            </div>
          </Fragment>
        ))
      )}

      {sheetRow && actions ? (
        <RowActionSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          title={sheetRow.title}
          subtitle={sheetRow.subtitle}
          config={actions}
          target={actions.target}
          play={sheetRow.play}
        />
      ) : null}
    </div>
  );
}
