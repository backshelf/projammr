"use client";

import { leaveProject } from "@/actions/members";
import { isActionError } from "@workspace/api/lib/action-result";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog";
import { useState, type MouseEvent } from "react";

/**
 * Confirms that the caller leaves a project. A refusal (the last owner has to
 * transfer first) is shown in the dialog, which stays open; on success the
 * action itself drops the project cookie and redirects home.
 */
export function LeaveProjectDialog({
  projectId,
  projectName,
  open,
  onOpenChange,
}: {
  projectId: number;
  projectName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOpenChange = (next: boolean) => {
    if (leaving) return;
    if (!next) setError(null);
    onOpenChange(next);
  };

  const handleLeave = async (event: MouseEvent) => {
    event.preventDefault();
    setLeaving(true);
    setError(null);
    try {
      // Returns only a refusal; success redirects before it can return.
      const result = await leaveProject(projectId);
      if (isActionError(result)) setError(result.error);
    } finally {
      setLeaving(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Leave {projectName}?</AlertDialogTitle>
          <AlertDialogDescription>
            You lose access to this project until someone invites you back.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p role="alert" className="text-small text-danger">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={leaving}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={leaving}
            onClick={handleLeave}
          >
            Leave project
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
