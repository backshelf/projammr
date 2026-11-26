"use client";

import { QUEUE_SCOPE, type QueueSurface } from "@/components/commands/queue";
import { useCommandScope } from "@/components/commands/provider";
import {
  usePlayerActions,
  useUpcoming,
} from "@/components/music-player/player-hooks";
import {
  artistLabel,
  MusicPlayerTrack,
  trackLabel,
  versionLabel,
  type PlayerSize,
} from "@/components/music-player/types";
import { useDragSensors } from "@/lib/drag-sensors";
import {
  closestCenter,
  DndContext,
  DragEndEvent,
  KeyboardSensor,
  useSensor,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { IconGripVertical, IconX } from "@tabler/icons-react";
import { Button } from "@workspace/ui/components/button";
import { IconButton } from "@workspace/ui/components/icon-button";
import { useLatestRef } from "@workspace/ui/hooks/use-latest-ref";
import { AnimatePresence, LEAVE, m } from "@workspace/ui/lib/motion";
import { cn } from "@workspace/ui/lib/utils";
import { useMemo, useState } from "react";

/** The grip and the remove button are the two things a finger drives directly,
 *  so they grow to a 44px target in the full-size queue. In the desktop
 *  popover a cursor is doing the driving and the row stays dense. */
const GRIP: Record<PlayerSize, string> = {
  card: "p-0.5",
  full: "grid size-11 place-items-center",
};

const GRIP_ICON: Record<PlayerSize, number> = { card: 14, full: 18 };

function QueueRow({
  qIndex,
  track,
  size,
  isCursor,
  onRemove,
  onJump,
}: {
  qIndex: number;
  track: MusicPlayerTrack;
  size: PlayerSize;
  isCursor: boolean;
  onRemove: () => void;
  onJump: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isSorting,
  } = useSortable({ id: qIndex });

  return (
    <m.div
      ref={setNodeRef}
      // The sort itself is dnd-kit's: the row follows the finger and the rows
      // it passes slide under dnd-kit's own transition, so `layout` is off for
      // exactly that long — the two cannot write the transform at once. The
      // rest of the time a removed row fades and the rows below it travel up.
      layout={isSorting ? false : "position"}
      exit={{ opacity: 0, pointerEvents: "none", transition: LEAVE.move }}
      style={
        isSorting
          ? { transform: CSS.Transform.toString(transform), transition }
          : undefined
      }
      data-dragging={isDragging || undefined}
      data-cursor={isCursor || undefined}
      className={
        "relative flex items-center gap-1 px-2 py-1 motion-reveal after:pointer-events-none after:absolute after:inset-0 after:border after:border-art after:opacity-0 after:motion-reveal hover:bg-ink/4 data-cursor:after:opacity-100 data-dragging:opacity-70"
      }
    >
      <span
        {...attributes}
        {...listeners}
        suppressHydrationWarning
        className={cn(
          "shrink-0 cursor-grab touch-none text-ink-soft hover:text-ink",
          GRIP[size]
        )}
      >
        <IconGripVertical size={GRIP_ICON[size]} />
      </span>
      <button
        type={"button"}
        onClick={onJump}
        className={"min-w-0 flex-1 text-left"}
      >
        <p className={"truncate text-small font-medium"}>
          {trackLabel(track)}
          {versionLabel(track) && (
            <span className={"ml-1 text-ink-soft"}>{versionLabel(track)}</span>
          )}
        </p>
        {artistLabel(track) && (
          <p className={"truncate text-micro text-ink-soft"}>
            {artistLabel(track)}
          </p>
        )}
      </button>
      {size === "full" ? (
        <IconButton
          size={"touch"}
          aria-label={"Remove from queue"}
          onClick={onRemove}
        >
          <IconX />
        </IconButton>
      ) : (
        <Button
          variant={"ghost"}
          size={"icon-xs"}
          aria-label={"Remove from queue"}
          onClick={onRemove}
        >
          <IconX />
        </Button>
      )}
    </m.div>
  );
}

/**
 * The upcoming rows, reorderable by drag. Loaded on demand by the surface
 * showing them: the drag machinery is a chunk of its own and only wanted once
 * the queue is opened.
 */
export default function QueueList({ size }: { size: PlayerSize }) {
  const upcoming = useUpcoming();
  const { remove, move, jump } = usePlayerActions();

  // An index into `upcoming`, clamped at read so a removal leaves it on the
  // entry that took the removed one's place, or the new last one.
  const [cursorIndex, setCursorIndex] = useState(0);
  const cursor = Math.min(cursorIndex, upcoming.length - 1);
  const cursorEntry = upcoming[cursor];
  const count = upcoming.length;

  const moves = useLatestRef({
    step: (delta: 1 | -1) => setCursorIndex(cursor + delta),
    remove: () => cursorEntry && remove(cursorEntry.qIndex),
    jump: () => cursorEntry && jump(cursorEntry.qIndex),
  });
  const canPrevious = cursor > 0;
  const canNext = cursor < count - 1;
  const canAct = count > 0;
  const surface = useMemo<QueueSurface>(
    () => ({
      next: canNext ? () => moves.current.step(1) : null,
      previous: canPrevious ? () => moves.current.step(-1) : null,
      remove: canAct ? () => moves.current.remove() : null,
      jump: canAct ? () => moves.current.jump() : null,
    }),
    [moves, canNext, canPrevious, canAct]
  );
  useCommandScope(QUEUE_SCOPE, surface, true);

  const sensors = useDragSensors(
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const ids = upcoming.map((u) => u.qIndex);

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    move(Number(active.id), Number(over.id));
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {/* Keyed by the entry's key, not its qIndex: a removal renumbers the
            indices below it, and the row that has to fade is the one that
            went, not the one now wearing its number. */}
        <AnimatePresence initial={false}>
          {upcoming.map((u) => (
            <QueueRow
              key={u.key}
              qIndex={u.qIndex}
              track={u.track}
              size={size}
              isCursor={u.qIndex === cursorEntry?.qIndex}
              onRemove={() => remove(u.qIndex)}
              onJump={() => jump(u.qIndex)}
            />
          ))}
        </AnimatePresence>
      </SortableContext>
    </DndContext>
  );
}
