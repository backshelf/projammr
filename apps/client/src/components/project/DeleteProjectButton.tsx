"use client";

import { deleteProject } from "@/actions/projects";
import { useDeleteGate } from "@/hooks/use-delete-gate";
import { isActionError } from "@workspace/api/lib/action-result";
import { ConfirmDeleteDialog } from "@workspace/ui/components/confirm-delete-dialog";
import { Button } from "@workspace/ui/components/button";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { projectDeletionLossSentence } from "./project-deletion";

/**
 * Deleting a project takes its collections, tracks and sessions with it, so
 * the confirmation names the project rather than asking a generic question.
 * Typing the project name back guards against a slip on an action this
 * large.
 */
export function DeleteProjectButton({
  projectId,
  projectName,
}: {
  projectId: number;
  projectName: string;
}) {
  const router = useRouter();

  const handleDelete = async () => {
    const result = await deleteProject(projectId);

    if (isActionError(result)) {
      toast.error(`Failed to delete project: ${result.error}`);
      return;
    }

    toast.success("Project deleted");
    router.push("/");
  };
  const deletion = useDeleteGate("project", handleDelete);

  return (
    <>
      <Button
        variant={"destructive"}
        size={"sm"}
        className={"w-full"}
        onClick={() => deletion.request()}
      >
        Delete project
      </Button>
      <ConfirmDeleteDialog
        {...deletion.dialog}
        title={`Delete ${projectName}?`}
        description={projectDeletionLossSentence(projectName)}
        confirmText={projectName}
      />
    </>
  );
}
