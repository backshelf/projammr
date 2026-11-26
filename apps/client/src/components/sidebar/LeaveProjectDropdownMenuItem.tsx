"use client";
import { LeaveProjectDialog } from "@/components/project/LeaveProjectDialog";
import { DropdownMenuItem } from "@workspace/ui/components/dropdown-menu";
import { createContext, use, useMemo, useState, type ReactNode } from "react";

const OpenLeaveContext = createContext<(() => void) | null>(null);

/**
 * Holds the leave dialog beside the project menu rather than inside it: the
 * menu unmounts its content when it closes, and a dialog rendered there would
 * close with it. `LeaveProjectDropdownMenuItem` only opens this one.
 */
export function LeaveProjectScope({
  project,
  children,
}: {
  project?: { id: number; name: string };
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const openLeave = useMemo(
    () => (project ? () => setOpen(true) : null),
    [project]
  );

  return (
    <OpenLeaveContext value={openLeave}>
      {children}
      {project && (
        <LeaveProjectDialog
          projectId={project.id}
          projectName={project.name}
          open={open}
          onOpenChange={setOpen}
        />
      )}
    </OpenLeaveContext>
  );
}

/** Renders only inside a `LeaveProjectScope` that has a project. */
export default function LeaveProjectDropdownMenuItem() {
  const openLeave = use(OpenLeaveContext);
  if (!openLeave) return null;

  return (
    <DropdownMenuItem variant="destructive" onClick={openLeave}>
      Leave project
    </DropdownMenuItem>
  );
}
