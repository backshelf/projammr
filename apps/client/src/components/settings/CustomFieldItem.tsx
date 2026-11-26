"use client";

import { deleteCustomField } from "@/actions/custom-fields";
import { ColourItem, ColourRowAction } from "@/components/settings/ColourItem";
import CustomFieldForm, {
  FIELD_TYPE_LABELS,
} from "@/components/settings/CustomFieldForm";
import { DeleteFieldDialog } from "@/components/settings/DeleteFieldDialog";
import { useDeleteGate } from "@/hooks/use-delete-gate";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  IconChevronDown,
  IconChevronUp,
  IconGripVertical,
  IconTrash,
} from "@tabler/icons-react";
import type { CustomField } from "@workspace/api/api";
import { isActionError } from "@workspace/api/lib/action-result";
import { pluralizeCount } from "@workspace/session-diff/format";
import { useState } from "react";
import { toast } from "sonner";

/** A field has no colour of its own (only a select's options do), so its row
 *  sits on the sunk paper surface in the theme's own ink. */
const FIELD_ROW_COLOUR = "var(--paper-sunk)";
const FIELD_ROW_INK = "var(--ink)";

export function CustomFieldItem({
  field,
  projectId,
  canEdit,
  canMoveUp,
  canMoveDown,
  onMove,
}: {
  field: CustomField;
  projectId: number;
  canEdit: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (delta: -1 | 1) => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: field.id, disabled: !canEdit });

  const handleDelete = async () => {
    setDeleting(true);
    const result = await deleteCustomField(projectId, field.id);
    if (isActionError(result)) {
      toast.error(result.error);
      setDeleting(false);
    } else {
      toast.success("Field deleted");
    }
  };
  const deletion = useDeleteGate("field", handleDelete);

  const meta = [
    FIELD_TYPE_LABELS[field.type],
    field.type === "select" && pluralizeCount(field.options.length, "option"),
    pluralizeCount(field.valueCount, "value"),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <ColourItem
      name={field.name}
      colour={FIELD_ROW_COLOUR}
      ink={FIELD_ROW_INK}
      title={field.name}
      meta={meta}
      canEdit={canEdit}
      liProps={{
        ref: setNodeRef,
        style: { transform: CSS.Transform.toString(transform), transition },
      }}
      leading={
        canEdit && (
          <span
            {...attributes}
            {...listeners}
            aria-label={`Reorder ${field.name}`}
            role="button"
            tabIndex={0}
            className="shrink-0 cursor-grab touch-none text-ink-soft hover:text-ink"
          >
            <IconGripVertical size={16} />
          </span>
        )
      }
      actions={
        <>
          <button
            type="button"
            aria-label={`Move ${field.name} up`}
            disabled={!canMoveUp}
            onClick={() => onMove(-1)}
            className="text-ink-soft hover:text-ink disabled:opacity-30"
          >
            <IconChevronUp size={14} />
          </button>
          <button
            type="button"
            aria-label={`Move ${field.name} down`}
            disabled={!canMoveDown}
            onClick={() => onMove(1)}
            className="text-ink-soft hover:text-ink disabled:opacity-30"
          >
            <IconChevronDown size={14} />
          </button>
        </>
      }
      remove={
        <>
          <ColourRowAction
            onClick={() => deletion.request()}
            disabled={deleting}
            aria-label={`Delete ${field.name}`}
          >
            <IconTrash size={16} />
          </ColourRowAction>
          <DeleteFieldDialog
            {...deletion.dialog}
            name={field.name}
            valueCount={field.valueCount}
          />
        </>
      }
      renderForm={(close) => (
        <CustomFieldForm
          projectId={projectId}
          kind={field.kind}
          mode="edit"
          field={field}
          onDone={close}
        />
      )}
    />
  );
}
