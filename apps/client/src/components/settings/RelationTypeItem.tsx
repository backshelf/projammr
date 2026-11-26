"use client";

import { deleteRelationType } from "@/actions/relation-types";
import SettingsRelationTypeForm from "@/components/settings/SettingsRelationTypeForm";
import { useDeleteGate } from "@/hooks/use-delete-gate";
import {
  IconChevronDown,
  IconChevronUp,
  IconPencil,
  IconTrash,
} from "@tabler/icons-react";
import type { RelationTypeEntry } from "@workspace/api/api";
import { isActionError } from "@workspace/api/lib/action-result";
import { Button } from "@workspace/ui/components/button";
import { ConfirmDeleteDialog } from "@workspace/ui/components/confirm-delete-dialog";
import {
  Row,
  RowMain,
  RowMeta,
  RowTitle,
} from "@workspace/ui/components/layout/rows";
import { cn } from "@workspace/ui/lib/utils";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";

/* `REVEAL_ON_HOVER` (`@workspace/ui/lib/shell`) targets a bare `group-hover`,
   which a `Row` (`group/row`) never triggers; this is `SettingsMembers.tsx`'s
   own variant string for the same row shape. */
const REVEAL_ROW_ACTION =
  "fine:opacity-0 fine:motion-reveal fine:group-focus-within/row:opacity-100 fine:group-hover/row:opacity-100";

/* While a reorder is in flight the arrows are `aria-disabled`, not `disabled`:
   a disabled button cannot hold or take the focus a keyboard user is moving
   a type with. */
const MOVE_BUTTON =
  "shrink-0 text-ink-soft hover:text-ink disabled:opacity-30 aria-disabled:cursor-default aria-disabled:opacity-30";

/**
 * One row of the relation types list: its name, its usage count while any
 * relation still carries it, and — for an editor — the reorder, rename and
 * delete controls. Reorder buttons stay visible; rename and delete reveal on
 * row hover or focus.
 */
export function RelationTypeItem({
  type,
  projectId,
  canEdit,
  isFirst,
  isLast,
  movePending,
  onMoveUp,
  onMoveDown,
  takeMoveFocus,
}: {
  type: RelationTypeEntry;
  projectId: number;
  canEdit: boolean;
  isFirst: boolean;
  isLast: boolean;
  /** Disables every row's move buttons while a reorder call is in flight. */
  movePending: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  /**
   * Which arrow of this type moved it, once, so that arrow takes focus back
   * after the move re-places the row; null when none did.
   */
  takeMoveFocus: (typeId: number) => -1 | 1 | null;
}) {
  const metaId = useId();
  const upRef = useRef<HTMLButtonElement>(null);
  const downRef = useRef<HTMLButtonElement>(null);

  // A move re-places the row in the DOM, which drops the focus its arrow
  // held. The arrow takes it back, or its twin once the type reaches the end
  // of the list and that arrow is disabled.
  useEffect(() => {
    const direction = takeMoveFocus(type.id);
    if (direction === null) return;
    const upward = direction < 0 ? !isFirst : isLast;
    (upward ? upRef : downRef).current?.focus();
  });
  const [editing, setEditing] = useState(false);
  // Closing the form unmounts the field that held focus; the pencil that
  // opened it takes focus back when it remounts.
  const [refocusPencil, setRefocusPencil] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    const result = await deleteRelationType(projectId, type.id);
    if (isActionError(result)) {
      toast.error(result.error);
      setDeleting(false);
    } else {
      toast.success("Relation type deleted");
    }
  };
  const deletion = useDeleteGate("relationType", handleDelete);

  if (editing) {
    return (
      <li>
        <SettingsRelationTypeForm
          projectId={projectId}
          mode="edit"
          type={type}
          onDone={() => {
            setRefocusPencil(true);
            setEditing(false);
          }}
        />
      </li>
    );
  }

  return (
    <li>
      <Row>
        <RowMain>
          <RowTitle>{type.name}</RowTitle>
          {type.inUse > 0 && (
            <RowMeta id={metaId}>
              {type.inUse === 1
                ? "1 relation uses this type"
                : `${type.inUse} relations use this type`}
            </RowMeta>
          )}
        </RowMain>
        {canEdit && (
          <>
            <Button
              ref={upRef}
              type="button"
              variant="ghost"
              size="icon-sm"
              className={MOVE_BUTTON}
              disabled={isFirst}
              aria-disabled={movePending || undefined}
              aria-label={`Move ${type.name} up`}
              onClick={() => {
                if (!movePending) onMoveUp();
              }}
            >
              <IconChevronUp size={14} />
            </Button>
            <Button
              ref={downRef}
              type="button"
              variant="ghost"
              size="icon-sm"
              className={MOVE_BUTTON}
              disabled={isLast}
              aria-disabled={movePending || undefined}
              aria-label={`Move ${type.name} down`}
              onClick={() => {
                if (!movePending) onMoveDown();
              }}
            >
              <IconChevronDown size={14} />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              autoFocus={refocusPencil}
              className={cn(
                "shrink-0 text-ink-soft hover:text-ink",
                REVEAL_ROW_ACTION
              )}
              aria-label={`Edit ${type.name}`}
              onClick={() => {
                setRefocusPencil(false);
                setEditing(true);
              }}
            >
              <IconPencil size={14} />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className={cn(
                "shrink-0 text-ink-soft hover:text-danger",
                REVEAL_ROW_ACTION
              )}
              disabled={type.inUse > 0 || deleting}
              aria-describedby={type.inUse > 0 ? metaId : undefined}
              aria-label={`Delete ${type.name}`}
              onClick={() => deletion.request()}
            >
              <IconTrash size={14} />
            </Button>
          </>
        )}
      </Row>
      <ConfirmDeleteDialog
        {...deletion.dialog}
        title={`Delete “${type.name}”?`}
        description="No relation uses it, so nothing else changes."
        confirmLabel="Delete relation type"
      />
    </li>
  );
}
