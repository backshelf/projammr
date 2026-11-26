"use client";

import { useRowEditor } from "@/components/settings/ColourItem";
import { PriorityLevelForm } from "@/components/settings/PriorityLevelForm";
import {
  levelRowId,
  type MoveDirection,
} from "@/components/settings/priority-scale";
import { PriorityBadge } from "@/components/tables/Priority";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  IconChevronDown,
  IconChevronUp,
  IconGripVertical,
  IconPencil,
  IconTrash,
} from "@tabler/icons-react";
import type { PriorityScaleLevel } from "@workspace/api/api";
import { IconButton } from "@workspace/ui/components/icon-button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { m } from "@workspace/ui/lib/motion";
import { LABEL, REVEAL_ON_HOVER } from "@workspace/ui/lib/shell";
import { cn } from "@workspace/ui/lib/utils";
import { useEffect, useId, useRef } from "react";

/** One marker for the whole scale, so a new default is seen to take it over. */
const DEFAULT_MARKER = "priority-default";

const DEFAULT_DELETE_HINT = "Make another level the default first";

/** A row's icon controls: revealed with the row, dimmed by colour when inert. */
const ROW_CONTROL = cn(
  REVEAL_ON_HOVER,
  "disabled:text-ink-faint aria-disabled:cursor-default aria-disabled:text-ink-faint"
);

export type PriorityLevelItemProps = {
  level: PriorityScaleLevel;
  projectId: number;
  /** The level's place in the list, bottom of the scale first. */
  index: number;
  /** How many levels the list holds. */
  count: number;
  canEdit: boolean;
  /** An order call is in flight: the arrows and the handle wait for it. */
  reorderLocked: boolean;
  onMove: (level: PriorityScaleLevel, direction: MoveDirection) => void;
  onMakeDefault: (level: PriorityScaleLevel) => void;
  onDelete: (level: PriorityScaleLevel) => void;
  /**
   * Which arrow of this level moved it, once, so that arrow takes focus back
   * after the move re-places the row; null when none did.
   */
  takeMoveFocus: (levelId: number) => MoveDirection | null;
};

/**
 * One level of the priorities editor: its chip, the default's marker, and for
 * an editor a drag handle, up and down arrows, "Make default", the pencil
 * that swaps the row for its form, and the bin. The handle is the pointer's
 * way to reorder; the arrows are the keyboard's and the finger's.
 */
export function PriorityLevelItem({
  level,
  projectId,
  index,
  count,
  canEdit,
  reorderLocked,
  onMove,
  onMakeDefault,
  onDelete,
  takeMoveFocus,
}: PriorityLevelItemProps) {
  const editor = useRowEditor();
  const {
    setNodeRef,
    setActivatorNodeRef,
    listeners,
    transform,
    transition,
    isDragging,
    isSorting,
  } = useSortable({
    id: level.id,
    disabled: !canEdit || reorderLocked || editor.editing,
  });
  const upRef = useRef<HTMLButtonElement>(null);
  const downRef = useRef<HTMLButtonElement>(null);
  const hintId = useId();

  const atBottom = index === 0;
  const atTop = index === count - 1;

  // A move re-places the row in the DOM, which drops the focus its arrow
  // held. The arrow takes it back, or its twin once the level reaches the end
  // of the list and that arrow is disabled.
  useEffect(() => {
    const direction = takeMoveFocus(level.id);
    if (direction === null) return;
    const upward = direction < 0 ? !atBottom : atTop;
    (upward ? upRef : downRef).current?.focus();
  });

  const arrow = (direction: MoveDirection) => ({
    "aria-label": `Move ${level.name} ${direction < 0 ? "up" : "down"}`,
    disabled: direction < 0 ? atBottom : atTop,
    // Not `disabled`: that would drop the focus a keyboard user is moving
    // the level with, halfway through a run of presses.
    "aria-disabled": reorderLocked || undefined,
    onClick: () => {
      if (!reorderLocked) onMove(level, direction);
    },
    className: ROW_CONTROL,
  });

  return (
    <m.li
      ref={setNodeRef}
      id={levelRowId(level.id)}
      // Where focus lands when a delete takes another row's rows here.
      tabIndex={-1}
      // The sort is dnd-kit's: the row follows the pointer and the rows it
      // passes slide under dnd-kit's transition, so `layout` is off for that
      // long. Otherwise an arrow's move travels on the layout animation.
      layout={isSorting ? false : "position"}
      style={
        isSorting
          ? { transform: CSS.Transform.toString(transform), transition }
          : undefined
      }
      data-dragging={isDragging || undefined}
      className="relative rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/30 data-dragging:z-10"
    >
      {editor.editing ? (
        <PriorityLevelForm
          mode="edit"
          projectId={projectId}
          level={level}
          onDone={editor.close}
        />
      ) : (
        <div
          className={cn(
            "group flex min-h-11 items-center gap-2 rounded-md px-2 py-1 motion-ink",
            "hover:bg-[color-mix(in_oklab,var(--ink)_4%,transparent)]",
            isDragging && "bg-paper-sunk"
          )}
        >
          {canEdit && (
            <span
              ref={setActivatorNodeRef}
              {...listeners}
              data-drag-handle
              aria-hidden
              className={cn(
                "relative grid size-6 shrink-0 touch-none place-items-center rounded-sm text-ink-faint motion-ink",
                "coarse:after:absolute coarse:after:-inset-2.5 coarse:after:content-['']",
                reorderLocked
                  ? "cursor-default"
                  : "cursor-grab hover:text-ink active:cursor-grabbing"
              )}
            >
              <IconGripVertical size={16} />
            </span>
          )}
          <span className="flex min-w-0 flex-1">
            <PriorityBadge level={level} />
          </span>
          {level.isDefault ? (
            <m.span
              layoutId={DEFAULT_MARKER}
              className={cn(LABEL, "shrink-0 text-ink-soft")}
            >
              Default
            </m.span>
          ) : (
            canEdit && (
              <button
                type="button"
                onClick={() => onMakeDefault(level)}
                // Leads with the words on the button, so a voice command
                // naming what is seen finds it.
                aria-label={`Make default, ${level.name}`}
                className={cn(
                  LABEL,
                  "relative shrink-0 cursor-pointer rounded-sm text-ink-soft hover:text-ink",
                  "focus-visible:ring-2 focus-visible:ring-art focus-visible:outline-none",
                  "coarse:after:absolute coarse:after:-inset-3 coarse:after:content-['']",
                  REVEAL_ON_HOVER
                )}
              >
                Make default
              </button>
            )
          )}
          {canEdit && (
            <span className="flex shrink-0 items-center">
              <IconButton ref={upRef} {...arrow(-1)}>
                <IconChevronUp />
              </IconButton>
              <IconButton ref={downRef} {...arrow(1)}>
                <IconChevronDown />
              </IconButton>
              <IconButton
                {...editor.opener}
                aria-label={`Edit ${level.name}`}
                className={ROW_CONTROL}
              >
                <IconPencil />
              </IconButton>
              {level.isDefault ? (
                <>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <IconButton
                        aria-label={`Delete ${level.name}`}
                        aria-disabled
                        aria-describedby={hintId}
                        className={ROW_CONTROL}
                      >
                        <IconTrash />
                      </IconButton>
                    </TooltipTrigger>
                    <TooltipContent>{DEFAULT_DELETE_HINT}</TooltipContent>
                  </Tooltip>
                  <span id={hintId} hidden>
                    {DEFAULT_DELETE_HINT}
                  </span>
                </>
              ) : (
                <IconButton
                  aria-label={`Delete ${level.name}`}
                  onClick={() => onDelete(level)}
                  className={ROW_CONTROL}
                >
                  <IconTrash />
                </IconButton>
              )}
            </span>
          )}
        </div>
      )}
    </m.li>
  );
}
