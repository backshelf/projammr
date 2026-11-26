"use client";

import { reorderRelationTypes } from "@/actions/relation-types";
import { ColourList } from "@/components/settings/ColourList";
import { RelationTypeItem } from "@/components/settings/RelationTypeItem";
import SettingsRelationTypeForm from "@/components/settings/SettingsRelationTypeForm";
import type { RelationTypeEntry } from "@workspace/api/api";
import { isActionError } from "@workspace/api/lib/action-result";
import { useOptimistic, useRef, useTransition } from "react";
import { toast } from "sonner";

/**
 * A project's relation types, editable in place: add at the end, rename,
 * reorder and delete. `ColourList` supplies the section head, the Add
 * control and the empty state; it has no colour of its own to draw, so the
 * rows are plain `Row`s rather than `ColourItem`s.
 */
export function SettingsRelationTypes({
  projectId,
  relationTypes,
  canEdit,
}: {
  projectId: number;
  relationTypes: RelationTypeEntry[];
  canEdit: boolean;
}) {
  // Shows the swap the moment it is clicked; `written()` refreshes the route
  // on success, so the optimistic order holds until the server's own order
  // replaces it instead of flicking back in between.
  const [types, setOptimisticTypes] = useOptimistic(relationTypes);
  const [movePending, startMove] = useTransition();
  const moveFocusRef = useRef<{ typeId: number; direction: -1 | 1 }>(null);

  const takeMoveFocus = (typeId: number) => {
    const request = moveFocusRef.current;
    if (request?.typeId !== typeId) return null;
    moveFocusRef.current = null;
    return request.direction;
  };

  const move = (index: number, direction: -1 | 1) => {
    const otherIndex = index + direction;
    moveFocusRef.current = {
      typeId: (types[index] as RelationTypeEntry).id,
      direction,
    };
    // The caller only reaches here through a move button, which is disabled
    // past either end, so both indexes are always in range.
    const swapped = types.map((type, i) => {
      if (i === index) return types[otherIndex] as RelationTypeEntry;
      if (i === otherIndex) return types[index] as RelationTypeEntry;
      return type;
    });

    startMove(async () => {
      setOptimisticTypes(swapped);
      const result = await reorderRelationTypes(
        projectId,
        swapped.map((type) => type.id)
      );
      if (isActionError(result)) toast.error(result.error);
    });
  };

  return (
    <ColourList
      heading="RELATION TYPES"
      noun="relation type"
      canEdit={canEdit}
      empty={types.length === 0}
      renderAddForm={(close) => (
        <SettingsRelationTypeForm
          projectId={projectId}
          mode="create"
          onDone={close}
        />
      )}
    >
      {types.map((type, index) => (
        <RelationTypeItem
          key={type.id}
          type={type}
          projectId={projectId}
          canEdit={canEdit}
          isFirst={index === 0}
          isLast={index === types.length - 1}
          movePending={movePending}
          onMoveUp={() => move(index, -1)}
          onMoveDown={() => move(index, 1)}
          takeMoveFocus={takeMoveFocus}
        />
      ))}
    </ColourList>
  );
}
