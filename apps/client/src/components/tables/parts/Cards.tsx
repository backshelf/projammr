"use client";

import type { RowData } from "@tanstack/react-table";
import { type ReactNode, useCallback, useMemo } from "react";

import { cardFieldsFrom } from "../cards/card-fields";
import { RowCardList, type RowCardSection } from "../cards/RowCardList";
import type { RowCardModel } from "../cards/row-card-model";
import { useDataTable } from "../data-table-context";
import { rowIdOf } from "../row-id";
import { useRowActions } from "../use-row-actions";

/**
 * The table's rows as the phone's stacked list. The root decides when the list
 * replaces the grid and owns select mode, which the grid, the toolbar and the
 * hotkeys share; this part turns the page's rows into cards and wires the
 * list's selection, expansion and action sheet to the table's own state.
 *
 * Nothing renders off the card tier or while the page has no rows; the grid's
 * empty state speaks for both tiers.
 */
export function Cards<TData extends RowData, TChild = never>(): ReactNode {
  const { showCards, hasRows } = useDataTable<TData, TChild>();
  if (!showCards || !hasRows) return null;
  return <CardList<TData, TChild> />;
}

function CardList<TData extends RowData, TChild = never>(): ReactNode {
  const context = useDataTable<TData, TChild>();
  const {
    table,
    entityLabel,
    cards,
    peek,
    subRows,
    topLevelRows,
    expanded,
    sections,
    grouped,
    drillInFor,
    urlState,
    enableSelection,
    selectedIds,
    selectMode,
    exitSelectMode,
    rowActions,
    reorder,
    loaded,
    loadMore,
    retryLoad,
    scrollToIndex,
  } = context;
  const buildRowActions = useRowActions<TData, TChild>(context);

  const childCard = cards?.childCard;
  const getChildRows = subRows?.getRows;

  // `scrollToIndex` takes a row's position among `table.getRowModel().rows`,
  // not among `topLevelRows` — a sub-row expanded under an earlier card still
  // takes a slot there, the same map `GridSections` builds off `pageRows`.
  const pageRows = table.getRowModel().rows;
  const rowIndexById = useMemo(() => {
    const map = new Map<string, number>();
    pageRows.forEach((row, index) => map.set(row.id, index));
    return map;
  }, [pageRows]);

  const cardRows = useMemo((): RowCardModel[] => {
    if (!peek || !cards) return [];
    return topLevelRows.map((row) => {
      const original = row.original as TData;
      const peekRow = peek.toPeekRow(original);
      return {
        id: peekRow.id,
        trackNumber: peekRow.trackNumber,
        href: peek.href(original),
        title: peekRow.title,
        subtitle: peekRow.subtitle,
        image: peekRow.image,
        flag: peekRow.flag,
        status: peekRow.status,
        priority: peekRow.priority,
        fields: cardFieldsFrom(peekRow, cards.keyFields),
        play: cards.play?.(original),
        children:
          childCard && getChildRows
            ? (getChildRows(original) ?? []).map(childCard)
            : undefined,
        rowIndex: rowIndexById.get(row.id) ?? 0,
      };
    });
  }, [topLevelRows, peek, cards, childCard, getChildRows, rowIndexById]);

  const cardRowFor = useCallback(
    (id: number) =>
      topLevelRows.find((row) => rowIdOf(row.original) === id) ?? null,
    [topLevelRows]
  );

  // A tap on a card already goes to the row's page, so its sheet drops "Open"
  // (the panel beside a table that is not there), and drops `playback` because
  // `RowActionSheet` renders its own `SheetPlayItem` above `ActionItems`.
  const getCardActions = useCallback(
    (id: number) => {
      const row = cardRowFor(id);
      if (!row) return null;
      return {
        ...buildRowActions(row.original as TData, id),
        onOpen: undefined,
        playback: undefined,
      };
    },
    [cardRowFor, buildRowActions]
  );

  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const toggleCardSelected = useCallback(
    (id: number) => cardRowFor(id)?.toggleSelected(),
    [cardRowFor]
  );

  // `true` is the table's shorthand for every row expanded.
  const expandedIdSet = useMemo(() => {
    if (expanded === true) {
      return new Set(topLevelRows.map((row) => Number(row.id)));
    }
    return new Set(
      Object.entries(expanded)
        .filter(([, open]) => open)
        .map(([id]) => Number(id))
    );
  }, [expanded, topLevelRows]);

  const toggleCardExpanded = useCallback(
    (id: number) => cardRowFor(id)?.toggleExpanded(),
    [cardRowFor]
  );

  // The list draws the same sections the grid does, each row swapped for its
  // card. A child row is drawn inside its parent's card, so only top-level
  // rows reach a section here — and an ungrouped list is the one section with
  // no heading.
  const { drillIntoGroup } = urlState;
  const cardSections: RowCardSection[] = useMemo(() => {
    if (!sections) {
      return [{ key: "__all__", count: cardRows.length, rows: cardRows }];
    }
    const cardById = new Map(cardRows.map((card) => [card.id, card]));
    return sections.map((section) => {
      const rows = section.rows
        .filter((row) => row.depth === 0)
        .map((row) => cardById.get(Number(row.id)))
        .filter((card): card is RowCardModel => card != null);
      const drillIn = drillInFor(section);
      return {
        key: section.key,
        label: section.label,
        count: section.count,
        rows,
        onShowAll: drillIn
          ? () => drillIntoGroup(drillIn.param, drillIn.value)
          : undefined,
      };
    });
  }, [sections, cardRows, drillInFor, drillIntoGroup]);

  return (
    <RowCardList
      sections={cardSections}
      entityLabel={entityLabel}
      grouped={grouped}
      getActions={rowActions ? getCardActions : undefined}
      selection={
        enableSelection && selectMode
          ? {
              selectedIds: selectedIdSet,
              onToggle: toggleCardSelected,
              onDone: exitSelectMode,
            }
          : undefined
      }
      expansion={
        childCard
          ? {
              expandedIds: expandedIdSet,
              onToggle: toggleCardExpanded,
            }
          : undefined
      }
      loaded={loaded}
      loadMore={loadMore}
      retryLoad={retryLoad}
      reorder={reorder}
      scrollToIndex={scrollToIndex}
    />
  );
}
