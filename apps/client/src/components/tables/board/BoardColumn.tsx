"use client";

import { StatusDisplay } from "@/components/status/StatusDisplay";
import type { Status } from "@workspace/api/api";
import { useDroppable } from "@dnd-kit/core";
import { Button } from "@workspace/ui/components/button";
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
}: {
  status: Status;
  cards: BoardCardData[];
  rowCount: number;
  loading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  onOpen: (id: number) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status.id });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex w-[min(18rem,78vw)] shrink-0 snap-start flex-col gap-3 rounded-lg border border-rule bg-paper-sunk/40 p-3 motion-ink",
        // A live drop target answers in the room's light rather than in ink.
        isOver && "ring-2 ring-art/40"
      )}
    >
      <div className="flex items-center justify-between gap-2 px-1">
        <StatusDisplay status={status} variant="chip" />
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
          />
        ))}
        {cards.length === 0 && !loading && (
          <p className="py-6 text-center text-micro text-ink-soft">
            No {status.name.toLowerCase()} items
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
