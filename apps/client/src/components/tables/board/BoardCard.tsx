"use client";

import { ArchivedFlag } from "@/components/track/ArchivedFlag";
import { imageUrl } from "@/lib/utils";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import {
  IconArrowUpRight,
  IconDotsVertical,
  IconGripVertical,
} from "@tabler/icons-react";
import type { Status } from "@workspace/api/api";
import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { m, SPRING } from "@workspace/ui/lib/motion";
import { cn } from "@workspace/ui/lib/utils";

import { TABLE_THUMB_WIDTH } from "../columns";
import { PriorityBadge } from "../Priority";
import { StatusOption } from "../RowActions";
import type { BoardCardData } from "./board-types";

/**
 * One draggable kanban card. Its drag data carries the column it started in,
 * so `onDragEnd` knows which column to remove it from without scanning every
 * column's rows.
 *
 * Dragging attaches only to the dedicated grip handle (`touchAction: "none"`)
 * so touch scrolling works across the card body, and a `⋯` menu exposes
 * keyboard and tap status moves alongside `DragOverlay` travel.
 */
export function BoardCard({
  card,
  columnId,
  onOpen,
  moveTargets,
  onMoveTo,
  canEdit = true,
  overlay = false,
}: {
  card: BoardCardData;
  columnId: number;
  onOpen: (id: number) => void;
  moveTargets?: Status[];
  onMoveTo?: (rowId: number, statusId: number) => void;
  canEdit?: boolean;
  overlay?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: card.id,
      data: { statusId: columnId },
      disabled: overlay || !canEdit,
    });

  const cover = imageUrl(card.image, TABLE_THUMB_WIDTH);

  return (
    <m.div
      ref={overlay ? undefined : setNodeRef}
      layoutId={overlay ? undefined : `board-card-${card.id}`}
      layout={overlay ? false : !isDragging}
      transition={SPRING.surface}
      style={{
        transform:
          !overlay && isDragging
            ? CSS.Translate.toString(transform)
            : undefined,
      }}
      className={cn(
        "flex w-full flex-col gap-2 rounded-md border border-rule bg-paper p-3 text-left",
        // The one place a lift is allowed: the finger is holding it.
        (isDragging || overlay) && "shadow-overlay",
        isDragging && !overlay && "opacity-40"
      )}
    >
      <div className="flex items-start gap-1.5">
        {canEdit && !overlay && (
          <button
            type="button"
            aria-label={`Drag ${card.title}`}
            style={{ touchAction: "none" }}
            className="-ml-1 inline-flex size-7 shrink-0 cursor-grab items-center justify-center rounded-sm text-ink-soft hover:text-ink active:cursor-grabbing coarse:size-11"
            {...listeners}
            {...attributes}
          >
            <IconGripVertical className="size-4" aria-hidden />
          </button>
        )}
        <button
          type="button"
          onClick={() => onOpen(card.id)}
          className="flex min-w-0 flex-1 items-start gap-2 text-left"
        >
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
              <p className="truncate text-micro text-ink-soft">
                {card.subtitle}
              </p>
            )}
          </div>
        </button>
        {!overlay && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="-mr-1 shrink-0 coarse:size-11"
                aria-label={`Actions for ${card.title}`}
              >
                <IconDotsVertical className="size-4" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => onOpen(card.id)}>
                <IconArrowUpRight />
                Open
              </DropdownMenuItem>
              {canEdit && onMoveTo && moveTargets && moveTargets.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Move to</DropdownMenuLabel>
                  {moveTargets.map((status) => (
                    <DropdownMenuItem
                      key={status.id}
                      onSelect={() => onMoveTo(card.id, status.id)}
                    >
                      <StatusOption status={status} />
                    </DropdownMenuItem>
                  ))}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {card.archived && <ArchivedFlag className="self-start" />}
      {card.priority && <PriorityBadge level={card.priority} hideDefault />}
    </m.div>
  );
}
