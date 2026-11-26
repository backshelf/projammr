"use client";

import { deleteStatus } from "@/actions/statuses";
import { ColourItem, ColourRowAction } from "@/components/settings/ColourItem";
import SettingsStatusForm from "@/components/settings/SettingsStatusForm";
import { useDeleteGate } from "@/hooks/use-delete-gate";
import { IconTrash } from "@tabler/icons-react";
import type { Status } from "@workspace/api/api";
import { isActionError } from "@workspace/api/lib/action-result";
import { ConfirmDeleteDialog } from "@workspace/ui/components/confirm-delete-dialog";
import { useState } from "react";
import { toast } from "sonner";

export function StatusItem({
  status,
  projectId,
  canEdit,
}: {
  status: Status;
  projectId: number;
  canEdit: boolean;
}) {
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    const result = await deleteStatus(status.id);
    if (isActionError(result)) {
      toast.error(result.error);
      setDeleting(false);
    } else {
      toast.success("Status deleted");
    }
  };
  const deletion = useDeleteGate("status", handleDelete);

  return (
    <ColourItem
      name={status.name}
      colour={status.colourHex}
      percentage={status.percentage}
      title={status.name.toUpperCase()}
      meta={status.description}
      trailing={`${status.percentage}%`}
      canEdit={canEdit}
      // A shared status belongs to every project, so none of them deletes it.
      remove={
        status.projectId != null && (
          <>
            <ColourRowAction
              onClick={() => deletion.request()}
              disabled={deleting}
              aria-label={`Delete ${status.name}`}
            >
              <IconTrash size={16} />
            </ColourRowAction>
            <ConfirmDeleteDialog
              {...deletion.dialog}
              title={`Delete “${status.name}”?`}
              description="Every track and collection at this status moves to the default status."
              confirmLabel="Delete status"
            />
          </>
        )
      }
      renderForm={(close) => (
        <SettingsStatusForm
          projectId={projectId}
          mode="edit"
          status={status}
          onDone={close}
        />
      )}
    />
  );
}
