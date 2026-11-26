"use client";

import type { RowData } from "@tanstack/react-table";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";

import { useDataTable } from "../data-table-context";

// The dialog is mounted only once a row or a selection asks to move, so its
// code loads then and not with the table.
const MoveToProjectDialog = dynamic(
  () => import("../MoveToProjectDialog").then((m) => m.MoveToProjectDialog),
  { ssr: false }
);

/**
 * The move-to-project dialog for the row a row action chose, or the bulk
 * bar's selection — the selection branch renders only when `onBulkMove` is
 * present, since a viewer never gets a selection target.
 */
export function Move() {
  const {
    moveToProject,
    moveTarget,
    setMoveTarget,
    onBulkMove,
    clearSelection,
    entityLabel,
    peekId,
    setPeekId,
  } = useDataTable<RowData>();
  const router = useRouter();

  if (!moveToProject || !moveTarget) return null;

  if ("selection" in moveTarget) {
    if (!onBulkMove) return null;

    return (
      <MoveToProjectDialog
        open
        onOpenChange={(open) => !open && setMoveTarget(null)}
        entityKind={moveToProject.kind}
        entityLabel={entityLabel}
        target={moveTarget}
        currentProjectId={moveToProject.projectId}
        onBulkMove={onBulkMove}
        onMoved={() => {
          setMoveTarget(null);
          clearSelection();
          const ids = moveTarget.selection.all
            ? undefined
            : moveTarget.selection.ids;
          if (peekId !== null && (ids === undefined || ids.includes(peekId))) {
            setPeekId(null);
          }
        }}
      />
    );
  }

  return (
    <MoveToProjectDialog
      open
      onOpenChange={(open) => !open && setMoveTarget(null)}
      entityKind={moveToProject.kind}
      entityLabel={entityLabel}
      target={moveTarget}
      currentProjectId={moveToProject.projectId}
      onMoved={(projectId) => {
        setMoveTarget(null);
        router.push(moveToProject.hrefInProject(moveTarget.row, projectId));
      }}
    />
  );
}
