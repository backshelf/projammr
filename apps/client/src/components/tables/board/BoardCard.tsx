"use client";

import { ArchivedFlag } from "@/components/track/ArchivedFlag";
import { imageUrl } from "@/lib/utils";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { m, SPRING } from "@workspace/ui/lib/motion";
import { cn } from "@workspace/ui/lib/utils";

import { TABLE_THUMB_WIDTH } from "../columns";
import { PriorityBadge } from "../Priority";
import type { BoardCardData } from "./board-types";

/**
 * One draggable kanban card. Its drag data carries the column it started in,
 * so `onDragEnd` knows which column to remove it from without scanning every
 * column's rows.
 *
 * A move unmounts the card in one column and mounts it in another, and the
 * shared `layoutId` carries it across: the optimistic move is visible travel
 * and a rollback travels back the same way. While the finger holds it, dnd-kit
 * owns the transform — the two cannot write it at once — so `layout` is off
 * for exactly that long and Motion re-measures from the drop point.
 */
export function BoardCard({
  card,
  columnId,
  onOpen,
}: {
  card: BoardCardData;
  columnId: number;
  onOpen: (id: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: card.id, data: { statusId: columnId } });

  const cover = imageUrl(card.image, TABLE_THUMB_WIDTH);

  return (
    <m.button
      ref={setNodeRef}
      type="button"
      onClick={() => onOpen(card.id)}
      layoutId={`board-card-${card.id}`}
      layout={!isDragging}
      transition={SPRING.surface}
      style={{
        transform: isDragging ? CSS.Translate.toString(transform) : undefined,
        touchAction: "none",
      }}
      className={cn(
        "flex w-full flex-col gap-2 rounded-md border border-rule bg-paper p-3 text-left",
        // The one place a lift is allowed: the finger is holding it.
        isDragging && "opacity-70 shadow-overlay"
      )}
      {...listeners}
      {...attributes}
    >
      <div className="flex items-start gap-2">
        {cover && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cover}
            alt=""
            className="size-8 shrink-0 rounded object-cover"
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-body font-medium text-ink">
            {card.title}
          </p>
          {card.subtitle && (
            <p className="truncate text-micro text-ink-soft">{card.subtitle}</p>
          )}
        </div>
      </div>
      {card.archived && <ArchivedFlag className="self-start" />}
      {card.priority && <PriorityBadge level={card.priority} />}
    </m.button>
  );
}
