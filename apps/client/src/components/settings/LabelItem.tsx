"use client";

import { deleteLabel } from "@/actions/labels";
import { ColourItem, ColourRowAction } from "@/components/settings/ColourItem";
import SettingsLabelForm from "@/components/settings/SettingsLabelForm";
import { useDeleteGate } from "@/hooks/use-delete-gate";
import { IconTrash } from "@tabler/icons-react";
import type { Label } from "@workspace/api/api";
import { isActionError } from "@workspace/api/lib/action-result";
import { ConfirmDeleteDialog } from "@workspace/ui/components/confirm-delete-dialog";
import { useState } from "react";
import { toast } from "sonner";

export function LabelItem({
  label,
  projectId,
  canEdit,
}: {
  label: Label;
  projectId: number;
  canEdit: boolean;
}) {
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    const result = await deleteLabel(projectId, label.id);
    if (isActionError(result)) {
      toast.error(result.error);
      setDeleting(false);
    } else {
      toast.success("Label deleted");
    }
  };
  const deletion = useDeleteGate("label", handleDelete);

  return (
    <ColourItem
      name={label.name}
      colour={label.colourHex}
      title={label.name}
      canEdit={canEdit}
      remove={
        <>
          <ColourRowAction
            onClick={() => deletion.request()}
            disabled={deleting}
            aria-label={`Delete ${label.name}`}
          >
            <IconTrash size={16} />
          </ColourRowAction>
          <ConfirmDeleteDialog
            {...deletion.dialog}
            title={`Delete “${label.name}”?`}
            description="The label comes off every track, collection and session it is on."
            confirmLabel="Delete label"
          />
        </>
      }
      renderForm={(close) => (
        <SettingsLabelForm
          projectId={projectId}
          mode="edit"
          label={label}
          onDone={close}
        />
      )}
    />
  );
}
