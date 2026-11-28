"use client";

import { resolvePeek, stepPeek } from "@/lib/peek-param";
import { useDragSensors } from "@/lib/drag-sensors";
import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
} from "@dnd-kit/core";
import type { ActionError, Status } from "@workspace/api/api";
import { isActionError } from "@workspace/api/lib/action-result";
import { LayoutGroup } from "@workspace/ui/lib/motion";
import { cn } from "@workspace/ui/lib/utils";
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
import { BoardCard } from "./BoardCard";
import { BoardColumn } from "./BoardColumn";
import type { BoardCardData } from "./board-types";

/** Rows fetched per column per page — passed to callers' `fetchColumn`. */
export const BOARD_PAGE_SIZE = 50;

/** Synthetic column for rows with `statusId === null` (`status=0` server sentinel). */
const NO_STATUS: Status = {
  id: 0,
  projectId: 0,
  name: "No status",
  percentage: -1,
  description: null,
  colourHex: "var(--ink-soft)",
  createdAt: "",
  updatedAt: "",
};

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
  canEdit = true,
  toPlay,
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
  canEdit?: boolean;
  toPlay?: (row: TRow) => {
    kind: "track" | "collection";
    id: number;
    title?: string;
  } | null;
}) {
  const realStatuses = useMemo(
    () => [...statuses].sort((a, b) => a.percentage - b.percentage),
    [statuses]
  );
  const orderedStatuses = useMemo(
    () => [NO_STATUS, ...realStatuses],
    [realStatuses]
  );
  const statusIdsKey = orderedStatuses.map((s) => s.id).join(",");

  const [columns, setColumns] = useState<Record<number, ColumnState<TRow>>>({});
  const [activeCard, setActiveCard] = useState<BoardCardData | null>(null);
  const [mobileColumnId, setMobileColumnId] = useState<number>(
    () => realStatuses[0]?.id ?? orderedStatuses[0]?.id ?? 0
  );
  const resolvedMobileId = orderedStatuses.some((s) => s.id === mobileColumnId)
    ? mobileColumnId
    : (realStatuses[0]?.id ?? orderedStatuses[0]?.id ?? 0);

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

  const moveCardBetweenColumns = useCallback(
    async (
      rowId: number,
      sourceStatusId: number,
      targetStatusId: number
    ): Promise<boolean> => {
      if (sourceStatusId === targetStatusId || targetStatusId === 0) {
        return false;
      }

      const movedRow = columns[sourceStatusId]?.rows.find(
        (r) => r.id === rowId
      );
      if (!movedRow) return false;

      const targetStatus = realStatuses.find((s) => s.id === targetStatusId);
      const updatedRow: TRow = targetStatus
        ? {
            ...movedRow,
            ...("status" in movedRow ? { status: targetStatus } : {}),
            ...("statusId" in movedRow ? { statusId: targetStatus.id } : {}),
          }
        : movedRow;

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
          rows: [updatedRow, ...(prev[targetStatusId]?.rows ?? [])],
          rowCount: (prev[targetStatusId]?.rowCount ?? 0) + 1,
        },
      }));

      const ok = await onMoveCard(rowId, targetStatusId);
      if (ok) return true;

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
      return false;
    },
    [columns, realStatuses, onMoveCard, entityLabel]
  );

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const rowId = Number(event.active.id);
      const sourceStatusId = event.active.data.current?.statusId as
        number | undefined;
      const row =
        sourceStatusId != null
          ? columns[sourceStatusId]?.rows.find((r) => r.id === rowId)
          : allRows.find((r) => r.id === rowId);
      setActiveCard(row ? toCard(row) : null);
    },
    [columns, allRows, toCard]
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveCard(null);
      const { active, over } = event;
      if (!over) return;
      const rowId = Number(active.id);
      const targetStatusId = Number(over.id);
      const sourceStatusId = active.data.current?.statusId as
        number | undefined;
      if (sourceStatusId == null) return;
      void moveCardBetweenColumns(rowId, sourceStatusId, targetStatusId);
    },
    [moveCardBetweenColumns]
  );

  const peekColumnId = useMemo(() => {
    if (!peekedRow) return undefined;
    for (const status of orderedStatuses) {
      if (columns[status.id]?.rows.some((r) => r.id === peekedRow.id)) {
        return status.id;
      }
    }
    return undefined;
  }, [peekedRow, orderedStatuses, columns]);

  return (
    <>
      <div
        role="tablist"
        aria-label="Board columns"
        className="flex items-center gap-1.5 overflow-x-auto pb-3 md:hidden"
      >
        {orderedStatuses.map((status) => {
          const selected = status.id === resolvedMobileId;
          const count = columns[status.id]?.rowCount ?? 0;
          return (
            <button
              key={status.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setMobileColumnId(status.id)}
              className={cn(
                "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3 text-small font-medium motion-ink",
                selected
                  ? "border-ink bg-ink text-paper"
                  : "border-rule bg-paper text-ink-soft hover:text-ink"
              )}
            >
              <span className="truncate">{status.name}</span>
              <span className="text-micro tabular-nums opacity-80">
                {count}
              </span>
            </button>
          );
        })}
      </div>
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveCard(null)}
      >
        {/* One group across every column, so a card leaving one and arriving
            in another is measured as the same card travelling. */}
        <LayoutGroup>
          <div className="flex snap-x snap-mandatory scroll-px-(--gutter) gap-3 overflow-x-auto pb-4">
            {orderedStatuses.map((status) => {
              const column = columns[status.id];
              const moveTargets = realStatuses.filter(
                (target) => target.id !== status.id
              );
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
                  moveTargets={moveTargets}
                  onMoveTo={(rowId, targetId) =>
                    void moveCardBetweenColumns(rowId, status.id, targetId)
                  }
                  canEdit={canEdit}
                  className={cn(
                    status.id !== resolvedMobileId && "hidden md:flex"
                  )}
                />
              );
            })}
          </div>
        </LayoutGroup>
        <DragOverlay>
          {activeCard ? (
            <BoardCard
              card={activeCard}
              columnId={0}
              onOpen={() => {}}
              overlay
            />
          ) : null}
        </DragOverlay>
      </DndContext>
      <PeekPanel
        row={peekedRow ? toPeekRow(peekedRow) : null}
        onClose={() => setPeekId(null)}
        href={peekedRow ? href(peekedRow) : "#"}
        entityLabel={entityLabel}
        play={peekedRow ? (toPlay?.(peekedRow) ?? null) : null}
        statusEdit={
          canEdit &&
          peekedRow &&
          peekColumnId != null &&
          realStatuses.length > 0
            ? {
                statuses: realStatuses,
                onSelect: (newStatusId) =>
                  moveCardBetweenColumns(
                    peekedRow.id,
                    peekColumnId,
                    newStatusId
                  ),
              }
            : undefined
        }
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
