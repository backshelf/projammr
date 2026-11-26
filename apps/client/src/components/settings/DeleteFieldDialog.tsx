"use client";

import { ConfirmDeleteDialog } from "@workspace/ui/components/confirm-delete-dialog";
import { pluralizeCount } from "@workspace/session-diff/format";

/**
 * The confirm behind a field's bin: a field with values names how many are
 * lost; an empty one gets the plain confirm.
 */
export function DeleteFieldDialog({
  open,
  onOpenChange,
  name,
  valueCount,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  valueCount: number;
  onConfirm: () => void | Promise<void>;
}) {
  return (
    <ConfirmDeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Delete ${name}?`}
      description={
        valueCount > 0
          ? `${pluralizeCount(valueCount, "value")} will be lost.`
          : undefined
      }
      confirmLabel="Delete field"
      onConfirm={onConfirm}
    />
  );
}
