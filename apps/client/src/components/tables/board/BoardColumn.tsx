"use client";

import { StatusDisplay } from "@/components/status/StatusDisplay";
import type { Status } from "@workspace/api/api";
import { useDroppable } from "@dnd-kit/core";
import { Button } from "@workspace/ui/components/button";
import { StatusChip } from "@workspace/ui/components/status-chip";
import { cn } from "@workspace/ui/lib/utils";

import { BoardCard } from "./BoardCard";
import type { BoardCardData } from "./board-types";

export function BoardColumn({
  status,
  cards,
  rowCount,
  loading,
  hasMore,
  onLoadMore,
  onOpen,
  moveTargets,
  onMoveTo,
  canEdit = true,
  className,
}: {
  status: Status;
  cards: BoardCardData[];
  rowCount: number;
  loading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  onOpen: (id: number) => void;
  moveTargets?: Status[];
  onMoveTo?: (rowId: number, statusId: number) => void;
  canEdit?: boolean;
  className?: string;
}) {
  // The synthetic "No status" column (`id === 0`) cannot be a drop target
  // because PATCH statusId requires a positive status id.
  const { setNodeRef, isOver } = useDroppable({
    id: status.id,
    disabled: status.id === 0 || !canEdit,
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex w-full shrink-0 snap-start flex-col gap-3 rounded-lg border border-rule bg-paper-sunk/40 p-3 motion-ink md:w-[min(18rem,78vw)]",
        "[contain-intrinsic-size:288px_480px] [content-visibility:auto]",
        // A live drop target answers in the room's light rather than in ink.
        isOver && "ring-2 ring-art/40",
        className
      )}
    >
      <div className="flex items-center justify-between gap-2 px-1">
        {status.id === 0 ? (
          <StatusChip colour="var(--ink-soft)">{status.name}</StatusChip>
        ) : (
          <StatusDisplay status={status} variant="chip" />
        )}
        <span className="text-micro text-ink-soft tabular-nums">
          {rowCount}
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {cards.map((card) => (
          <BoardCard
            key={card.id}
            card={card}
            columnId={status.id}
            onOpen={onOpen}
            moveTargets={moveTargets}
            onMoveTo={onMoveTo}
            canEdit={canEdit}
          />
        ))}
        {cards.length === 0 && !loading && (
          <p className="py-6 text-center text-micro text-ink-soft">
            {status.id === 0
              ? "No items without a status"
              : `No ${status.name.toLowerCase()} items`}
          </p>
        )}
      </div>
      {hasMore && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onLoadMore}
          disabled={loading}
        >
          {loading ? "Loading…" : "Load more"}
        </Button>
      )}
    </div>
  );
}
