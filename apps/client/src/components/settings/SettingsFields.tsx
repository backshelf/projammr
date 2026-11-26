"use client";

import { reorderCustomFields } from "@/actions/custom-fields";
import { ColourList } from "@/components/settings/ColourList";
import { CustomFieldItem } from "@/components/settings/CustomFieldItem";
import CustomFieldForm from "@/components/settings/CustomFieldForm";
import { useProjectRole } from "@/hooks/use-project-role";
import { useDragSensors } from "@/lib/drag-sensors";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  useSensor,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { CustomField, CustomFieldKind } from "@workspace/api/api";
import { isActionError } from "@workspace/api/lib/action-result";
import { useId, useState } from "react";
import { toast } from "sonner";

/**
 * One kind's list of custom fields. A reorder shows at once from a local
 * order kept against the `fields` it was made from; `written()` refreshes the
 * route on success, and the fresh `fields` prop replaces it. A failed reorder
 * goes back to `fields` by hand, since nothing refreshes on an error.
 */
function FieldKindList({
  kind,
  heading,
  projectId,
  fields,
  canEdit,
}: {
  kind: CustomFieldKind;
  heading: string;
  projectId: number;
  fields: CustomField[];
  canEdit: boolean;
}) {
  const dndId = useId();
  const [local, setLocal] = useState({ source: fields, items: fields });
  const items = local.source === fields ? local.items : fields;
  const setItems = (next: CustomField[]) =>
    setLocal({ source: fields, items: next });

  const sensors = useDragSensors(
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const commit = async (next: CustomField[]) => {
    setItems(next);
    const result = await reorderCustomFields(
      projectId,
      next.map((field) => field.id)
    );
    if (isActionError(result)) {
      toast.error(result.error);
      // Back to the server's order, not the one this move started from:
      // with two moves in flight that was the first move's unsaved order.
      setItems(fields);
    }
  };

  const onMove = (id: number, delta: -1 | 1) => {
    const index = items.findIndex((field) => field.id === id);
    const target = index + delta;
    if (index === -1 || target < 0 || target >= items.length) return;
    const next = items.slice();
    [next[index], next[target]] = [next[target]!, next[index]!];
    void commit(next);
  };

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = items.findIndex((field) => field.id === active.id);
    const to = items.findIndex((field) => field.id === over.id);
    if (from === -1 || to === -1) return;
    const next = items.slice();
    next.splice(to, 0, next.splice(from, 1)[0]!);
    void commit(next);
  };

  return (
    <ColourList
      heading={heading}
      noun="field"
      canEdit={canEdit}
      empty={items.length === 0}
      renderAddForm={(close) => (
        <CustomFieldForm
          projectId={projectId}
          kind={kind}
          mode="create"
          onDone={close}
        />
      )}
    >
      {/* dnd-kit numbers its describedby ids from a module counter, which
          differs between the server render and the client; a React id keeps
          them the same. */}
      <DndContext
        id={dndId}
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        <SortableContext
          items={items.map((field) => field.id)}
          strategy={verticalListSortingStrategy}
        >
          {items.map((field, index) => (
            <CustomFieldItem
              key={field.id}
              field={field}
              projectId={projectId}
              canEdit={canEdit}
              canMoveUp={index > 0}
              canMoveDown={index < items.length - 1}
              onMove={(delta) => onMove(field.id, delta)}
            />
          ))}
        </SortableContext>
      </DndContext>
    </ColourList>
  );
}

/** The project's custom fields, one list per kind. */
export function SettingsFields({
  projectId,
  trackFields,
  collectionFields,
}: {
  projectId: number;
  trackFields: CustomField[];
  collectionFields: CustomField[];
}) {
  const canEdit = useProjectRole()?.can("editor") ?? false;

  return (
    <>
      <FieldKindList
        kind="track"
        heading="TRACKS"
        projectId={projectId}
        fields={trackFields}
        canEdit={canEdit}
      />
      <FieldKindList
        kind="collection"
        heading="COLLECTIONS"
        projectId={projectId}
        fields={collectionFields}
        canEdit={canEdit}
      />
    </>
  );
}
