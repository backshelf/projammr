"use client";

import { resolvePeek, stepPeek } from "@/lib/peek-param";
import { useDragSensors } from "@/lib/drag-sensors";
import { DndContext, type DragEndEvent } from "@dnd-kit/core";
import type { ActionError, Status } from "@workspace/api/api";
import { isActionError } from "@workspace/api/lib/action-result";
import { LayoutGroup } from "@workspace/ui/lib/motion";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useState,
} from "react";
import { toast } from "sonner";

import { PeekPanel, type PeekRow } from "../PeekPanel";
import { usePeekRow } from "../use-peek-row";
import { BoardColumn } from "./BoardColumn";
import type { BoardCardData } from "./board-types";

/** Rows fetched per column per page — passed to callers' `fetchColumn`. */
export const BOARD_PAGE_SIZE = 50;

type ColumnState<TRow> = {
  rows: TRow[];
  rowCount: number;
  page: number;
  loading: boolean;
};

const EMPTY_COLUMN = { rows: [], rowCount: 0, page: 1, loading: true };

/**
 * A kanban board over the same rows the list view shows, grouped into one
 * column per status. Each column paginates independently through the
 * project's existing filtered/paginated list endpoint — there is no
 * board-specific server query, since fetching one status at a time already
 * gives an exact per-column count and page.
 */
export function BoardView<TRow extends { id: number }>({
  statuses,
  fetchColumn,
  toCard,
  toPeekRow,
  href,
  onMoveCard,
  entityLabel,
}: {
  statuses: Status[];
  fetchColumn: (
    statusId: number,
    page: number
  ) => Promise<{ rows: TRow[]; rowCount: number } | ActionError>;
  toCard: (row: TRow) => BoardCardData;
  toPeekRow: (row: TRow) => PeekRow;
  href: (row: TRow) => string;
  onMoveCard: (rowId: number, newStatusId: number) => Promise<boolean>;
  entityLabel: string;
}) {
  const orderedStatuses = useMemo(
    () => [...statuses].sort((a, b) => a.percentage - b.percentage),
    [statuses]
  );
  const statusIdsKey = orderedStatuses.map((s) => s.id).join(",");

  const [columns, setColumns] = useState<Record<number, ColumnState<TRow>>>({});

  // Fetches a page and stores it. Only `loadColumn` raises the loading flag:
  // a column the board has no entry for yet already renders as loading.
  const storePage = useCallback(
    (statusId: number, page: number) =>
      fetchColumn(statusId, page).then((result) => {
        if (isActionError(result)) {
          toast.error(`Failed to load ${entityLabel}s: ${result.error}`);
          setColumns((prev) => ({
            ...prev,
            [statusId]: { ...(prev[statusId] ?? EMPTY_COLUMN), loading: false },
          }));
          return;
        }
        setColumns((prev) => ({
          ...prev,
          [statusId]: {
            rows:
              page === 1
                ? result.rows
                : [...(prev[statusId]?.rows ?? []), ...result.rows],
            rowCount: result.rowCount,
            page,
            loading: false,
          },
        }));
      }),
    [fetchColumn, entityLabel]
  );

  const loadColumn = useCallback(
    (statusId: number, page: number) => {
      setColumns((prev) => ({
        ...prev,
        [statusId]: {
          ...(prev[statusId] ?? EMPTY_COLUMN),
          page,
          loading: true,
        },
      }));
      void storePage(statusId, page);
    },
    [storePage]
  );

  // An effect event, so the first pages refetch only when the set of statuses
  // changes and not on every `storePage` identity change (a drag-driven filter
  // change would otherwise reload every column).
  const loadFirstPage = useEffectEvent((statusId: number) => {
    void storePage(statusId, 1);
  });

  useEffect(() => {
    for (const id of statusIdsKey.split(",")) {
      if (id) loadFirstPage(Number(id));
    }
  }, [statusIdsKey]);

  const allRows = useMemo(
    () => Object.values(columns).flatMap((c) => c.rows),
    [columns]
  );

  const [peekId, setPeekId] = usePeekRow(true);
  const { row: peekedRow, index: peekIndex } = resolvePeek(allRows, peekId);
  // Each column paginates on its own; the board has no single "more past the
  // window" to report, so previous/next clamp at the ends rather than load.
  const prevId = stepPeek(allRows, peekIndex, -1, { hasMore: false });
  const nextId = stepPeek(allRows, peekIndex, 1, { hasMore: false });

  const sensors = useDragSensors();

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over) return;
      const rowId = Number(active.id);
      const targetStatusId = Number(over.id);
      const sourceStatusId = active.data.current?.statusId as
        number | undefined;
      if (sourceStatusId == null || sourceStatusId === targetStatusId) return;

      const movedRow = columns[sourceStatusId]?.rows.find(
        (r) => r.id === rowId
      );
      if (!movedRow) return;

      setColumns((prev) => ({
        ...prev,
        [sourceStatusId]: {
          ...(prev[sourceStatusId] ?? EMPTY_COLUMN),
          rows: (prev[sourceStatusId]?.rows ?? []).filter(
            (r) => r.id !== rowId
          ),
          rowCount: (prev[sourceStatusId]?.rowCount ?? 1) - 1,
        },
        [targetStatusId]: {
          ...(prev[targetStatusId] ?? EMPTY_COLUMN),
          rows: [movedRow, ...(prev[targetStatusId]?.rows ?? [])],
          rowCount: (prev[targetStatusId]?.rowCount ?? 0) + 1,
        },
      }));

      onMoveCard(rowId, targetStatusId).then((ok) => {
        if (ok) return;
        toast.error(`Failed to move ${entityLabel}`);
        setColumns((prev) => ({
          ...prev,
          [sourceStatusId]: {
            ...(prev[sourceStatusId] ?? EMPTY_COLUMN),
            rows: [movedRow, ...(prev[sourceStatusId]?.rows ?? [])],
            rowCount: (prev[sourceStatusId]?.rowCount ?? 0) + 1,
          },
          [targetStatusId]: {
            ...(prev[targetStatusId] ?? EMPTY_COLUMN),
            rows: (prev[targetStatusId]?.rows ?? []).filter(
              (r) => r.id !== rowId
            ),
            rowCount: (prev[targetStatusId]?.rowCount ?? 1) - 1,
          },
        }));
      });
    },
    [columns, onMoveCard, entityLabel]
  );

  return (
    <>
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        {/* One group across every column, so a card leaving one and arriving
            in another is measured as the same card travelling. */}
        <LayoutGroup>
          <div className="flex snap-x snap-mandatory scroll-px-(--gutter) gap-3 overflow-x-auto pb-4">
            {orderedStatuses.map((status) => {
              const column = columns[status.id];
              return (
                <BoardColumn
                  key={status.id}
                  status={status}
                  cards={(column?.rows ?? []).map(toCard)}
                  rowCount={column?.rowCount ?? 0}
                  loading={column?.loading ?? true}
                  hasMore={(column?.rows.length ?? 0) < (column?.rowCount ?? 0)}
                  onLoadMore={() =>
                    loadColumn(status.id, (column?.page ?? 1) + 1)
                  }
                  onOpen={setPeekId}
                />
              );
            })}
          </div>
        </LayoutGroup>
      </DndContext>
      <PeekPanel
        row={peekedRow ? toPeekRow(peekedRow) : null}
        onClose={() => setPeekId(null)}
        href={peekedRow ? href(peekedRow) : "#"}
        entityLabel={entityLabel}
        onPrevious={
          prevId != null && prevId !== "load" ? () => setPeekId(prevId) : null
        }
        onNext={
          nextId != null && nextId !== "load" ? () => setPeekId(nextId) : null
        }
      />
    </>
  );
}
