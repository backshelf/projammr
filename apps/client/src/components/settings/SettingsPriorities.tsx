"use client";

import {
  reorderPriorityLevels,
  updatePriorityLevel,
} from "@/actions/priorities";
import { ColourList } from "@/components/settings/ColourList";
import {
  DeleteLevelDialog,
  useLevelDeletion,
} from "@/components/settings/DeleteLevelDialog";
import { PriorityLevelForm } from "@/components/settings/PriorityLevelForm";
import { PriorityLevelItem } from "@/components/settings/PriorityLevelItem";
import {
  fallbackLevel,
  levelUsage,
  reordered,
  withDefault,
  type MoveDirection,
  type ScaleChange,
} from "@/components/settings/priority-scale";
import { useDeleteGate } from "@/hooks/use-delete-gate";
import { useProjectRole } from "@/hooks/use-project-role";
import { toastActionResult } from "@/lib/action-toast";
import { useDragSensors } from "@/lib/drag-sensors";
import {
  closestCenter,
  DndContext,
  type Announcements,
  type DragEndEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { PriorityScaleLevel } from "@workspace/api/api";
import { isActionError } from "@workspace/api/lib/action-result";
import { useRouter } from "next/navigation";
import { useId, useOptimistic, useRef, useState, useTransition } from "react";

/**
 * The Priorities pane's editor: the project's scale, bottom level first, in
 * the statuses and labels panes' list shape. An editor adds, renames and
 * recolours levels, reorders them by dragging or with the arrows, makes one
 * the default and deletes one by naming where its rows go; a viewer reads
 * the list.
 *
 * A reorder or a new default shows at once and holds until the server's scale
 * replaces it as the route re-renders; a failed one falls back to what the
 * server has, reloaded, since a refusal usually means this copy of the scale
 * is stale (a level added or deleted elsewhere). One order call runs at a time.
 */
export function SettingsPriorities({
  projectId,
  levels,
}: {
  projectId: number;
  levels: PriorityScaleLevel[];
}) {
  const canEdit = useProjectRole()?.can("editor") ?? false;
  const router = useRouter();
  const [scale, change] = useOptimistic(
    levels,
    (current: PriorityScaleLevel[], apply: ScaleChange) => apply(current)
  );
  const [reordering, startReorder] = useTransition();
  const [, startDefault] = useTransition();
  const [announcement, setAnnouncement] = useState("");
  const deletion = useLevelDeletion(projectId);
  // A level nothing holds has no rows to place, so its delete is the plain
  // confirm the viewer's policy asks for; one that is held always asks where
  // its rows go, whatever the policy says.
  const unused = useDeleteGate<PriorityScaleLevel>("priorityLevel", (level) =>
    deletion.remove(level, fallbackLevel(scale, level))
  );
  // The held level whose delete is being confirmed. It outlives the dialog's
  // close, so the dialog still has its words while it leaves; `opening`
  // counts the openings, so each one starts again from the default.
  const [deleting, setDeleting] = useState<{
    level: PriorityScaleLevel;
    open: boolean;
    opening: number;
  } | null>(null);
  const moveFocusRef = useRef<{ levelId: number; direction: MoveDirection }>(
    null
  );
  const sensors = useDragSensors();
  const dndId = useId();

  const reorder = (ids: number[]) =>
    startReorder(async () => {
      change(reordered(ids));
      const result = await reorderPriorityLevels(projectId, ids);
      if (isActionError(result)) {
        toastActionResult({ ok: false, message: result.error });
        router.refresh();
      }
    });

  const move = (level: PriorityScaleLevel, direction: MoveDirection) => {
    const from = scale.findIndex(({ id }) => id === level.id);
    const passed = scale[from + direction];
    if (reordering || from < 0 || !passed) return;
    moveFocusRef.current = { levelId: level.id, direction };
    setAnnouncement(
      `${level.name} moved ${direction < 0 ? "above" : "below"} ${passed.name}`
    );
    reorder(arrayMove(scale, from, from + direction).map(({ id }) => id));
  };

  const takeMoveFocus = (levelId: number) => {
    const request = moveFocusRef.current;
    if (request?.levelId !== levelId) return null;
    moveFocusRef.current = null;
    return request.direction;
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (reordering || !over || active.id === over.id) return;
    const ids = scale.map(({ id }) => id);
    reorder(
      arrayMove(
        ids,
        ids.indexOf(Number(active.id)),
        ids.indexOf(Number(over.id))
      )
    );
  };

  const makeDefault = (level: PriorityScaleLevel) =>
    startDefault(async () => {
      change(withDefault(level.id));
      const result = await updatePriorityLevel(projectId, level.id, {
        isDefault: true,
      });
      if (isActionError(result)) router.refresh();
      toastActionResult(
        isActionError(result)
          ? { ok: false, message: result.error }
          : { ok: true, message: `${level.name} is now the default` }
      );
    });

  // dnd-kit speaks a drag by its item ids; these name the levels instead.
  const nameOf = (id: UniqueIdentifier) =>
    scale.find((level) => level.id === id)?.name ?? "";
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${nameOf(active.id)}.`,
    onDragOver: ({ active, over }) =>
      over ? `${nameOf(active.id)} is over ${nameOf(over.id)}.` : undefined,
    onDragEnd: ({ active, over }) =>
      over
        ? `${nameOf(active.id)} dropped at ${nameOf(over.id)}.`
        : `${nameOf(active.id)} dropped.`,
    onDragCancel: ({ active }) => `${nameOf(active.id)} put back where it was.`,
  };

  const topColour = scale.at(-1)?.colour ?? "";

  return (
    <>
      <ColourList
        heading="PRIORITIES"
        noun="priority level"
        canEdit={canEdit}
        empty={scale.length === 0}
        renderAddForm={(close) => (
          <PriorityLevelForm
            mode="create"
            projectId={projectId}
            colour={topColour}
            onDone={close}
          />
        )}
      >
        <DndContext
          id={dndId}
          accessibility={{ announcements }}
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          <SortableContext
            items={scale.map(({ id }) => id)}
            strategy={verticalListSortingStrategy}
          >
            {scale.map((level, index) => (
              <PriorityLevelItem
                key={level.id}
                level={level}
                projectId={projectId}
                index={index}
                count={scale.length}
                canEdit={canEdit}
                reorderLocked={reordering}
                onMove={move}
                onMakeDefault={makeDefault}
                onDelete={(level) =>
                  levelUsage(level.counts).total === 0
                    ? unused.request(level)
                    : setDeleting((previous) => ({
                        level,
                        open: true,
                        opening: (previous?.opening ?? 0) + 1,
                      }))
                }
                takeMoveFocus={takeMoveFocus}
              />
            ))}
          </SortableContext>
        </DndContext>
      </ColourList>
      <p role="status" className="sr-only">
        {announcement}
      </p>
      {deleting && (
        <DeleteLevelDialog
          // A fresh dialog per opening, so its pick starts at the default.
          key={`${deleting.level.id}-${deleting.opening}`}
          level={deleting.level}
          levels={scale}
          open={deleting.open}
          onOpenChange={(open) => setDeleting({ ...deleting, open })}
          onConfirm={(replacement) =>
            deletion.remove(deleting.level, replacement)
          }
          finalFocus={deletion.finalFocus}
        />
      )}
      {unused.pending && (
        <DeleteLevelDialog
          level={unused.pending}
          levels={scale}
          {...unused.dialog}
          finalFocus={deletion.finalFocus}
        />
      )}
    </>
  );
}
