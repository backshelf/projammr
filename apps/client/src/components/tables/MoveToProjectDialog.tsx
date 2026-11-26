"use client";

import type { BulkSelection } from "@/entities/api";
import { clientGetMyProjects, clientPreviewMove } from "@/lib/client-api";
import { moveEntity } from "@/entities/mutations";
import { useMutate } from "@/hooks/use-mutate";
import { pluralizeCount } from "@workspace/session-diff/format";
import type {
  DroppedField,
  MoveReport,
  MyProject,
  TableEntityKind,
} from "@workspace/api/api";
import { isActionError } from "@workspace/api/lib/action-result";
import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Label } from "@workspace/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { Spinner } from "@workspace/ui/components/spinner";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { priorityFallbackNote } from "./move-report";
import { movableTargets } from "./move-targets";

/** What the dialog moves: one named row, or a bulk selection with a count. */
export type MoveDialogTarget =
  { id: number; name: string } | { selection: BulkSelection; count: number };

/**
 * The rule line under a selection's confirm: what stays behind and what moves
 * with the rows, worded the same as the single-row description below it but
 * for the whole batch. Keyed on `TableEntityKind` so a kind with no rule
 * (there is none today) falls back to nothing rather than throwing.
 */
const SELECTION_RULES: Record<TableEntityKind, string> = {
  track: "Sessions and audio only these tracks use move with them.",
  collection:
    "Tracks only in this collection move; shared tracks stay and leave the collection.",
  session: "Track links are cleared; attachments only these sessions use move.",
};

/** What the server said a move to one destination would drop, or that it is still asking. */
type MovePreviewState = { targetId: string } & (
  | { state: "checking" }
  | { state: "unknown" }
  | { state: "ready"; droppedFields: DroppedField[] }
);

/**
 * The custom field values a move would leave behind, one line per field with
 * how many values it loses, shown before the mover confirms. Nothing when every
 * value carries over; a quiet line while the server is asked, or when it could
 * not say.
 */
function DroppedFieldsNote({
  preview,
  destination,
}: {
  preview: MovePreviewState;
  destination: string;
}) {
  if (preview.state !== "ready") {
    return (
      <p role="status" className="text-small text-ink-soft">
        {preview.state === "checking"
          ? "Checking which custom field values move…"
          : "Could not check which custom field values move."}
      </p>
    );
  }
  if (preview.droppedFields.length === 0) return null;
  return (
    <div
      role="status"
      className="grid gap-2 rounded-md border border-rule px-3 py-2.5"
    >
      <p className="text-small text-warn">These field values will be dropped</p>
      <ul className="grid gap-1 text-small">
        {preview.droppedFields.map((field) => (
          <li
            key={field.fieldId}
            className="flex items-baseline justify-between gap-3"
          >
            <span className="truncate text-ink">{field.name}</span>
            <span className="shrink-0 text-ink-soft tabular-nums">
              {pluralizeCount(field.count, "value")}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-micro text-pretty text-ink-soft">
        {destination} has no field of the same name and type for them, or no
        option of the same label.
      </p>
    </div>
  );
}

/**
 * Sends a row or a bulk selection to another project. The destination list is
 * loaded the first time the dialog opens, because most sessions never move
 * anything.
 *
 * `onMoved` is handed the destination so the caller can follow a moved row
 * there; a selection never navigates, since its rows leave this project's
 * table and the caller's own invalidation already refreshes it.
 */
export function MoveToProjectDialog({
  open,
  onOpenChange,
  entityKind,
  entityLabel,
  target,
  currentProjectId,
  onBulkMove,
  onMoved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityKind: TableEntityKind;
  entityLabel: string;
  target: MoveDialogTarget;
  currentProjectId: number;
  onBulkMove?: (
    selection: BulkSelection,
    targetProjectId: number
  ) => Promise<{ ok: boolean; count?: number } & Partial<MoveReport>>;
  onMoved: (projectId: number) => void;
}) {
  const [projects, setProjects] = useState<MyProject[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [targetId, setTargetId] = useState<string>("");
  const [preview, setPreview] = useState<MovePreviewState | null>(null);
  const [moving, setMoving] = useState(false);
  const mutate = useMutate();

  // What the move would drop is asked as soon as a destination is picked, and
  // the answer kept only while that destination is still the one picked.
  const chooseTarget = (next: string) => {
    setTargetId(next);
    setPreview({ targetId: next, state: "checking" });
    void clientPreviewMove(
      entityKind,
      target,
      currentProjectId,
      Number(next)
    ).then((result) =>
      setPreview((current) =>
        current?.targetId !== next
          ? current
          : isActionError(result)
            ? { targetId: next, state: "unknown" }
            : {
                targetId: next,
                state: "ready",
                droppedFields: result.droppedFields,
              }
      )
    );
  };
  const checking =
    preview?.targetId === targetId && preview.state === "checking";

  useEffect(() => {
    if (!open || projects !== null) return;

    let cancelled = false;
    void clientGetMyProjects().then((result) => {
      if (cancelled) return;
      if (isActionError(result)) setLoadError(result.error);
      else setProjects(result);
    });

    return () => {
      cancelled = true;
    };
  }, [open, projects]);

  const targets = useMemo(
    () => movableTargets(projects ?? [], currentProjectId),
    [projects, currentProjectId]
  );
  const selectedProjectName = targets.find(
    (project) => String(project.id) === targetId
  )?.name;

  const move = async () => {
    const projectId = Number(targetId);
    if (!projectId) return;

    setMoving(true);

    if ("selection" in target) {
      const result = onBulkMove
        ? await onBulkMove(target.selection, projectId)
        : { ok: false as const };
      setMoving(false);

      if (!result.ok) {
        toast.error(
          `Could not move ${pluralizeCount(target.count, entityLabel)}`
        );
        return;
      }
      toast.success(
        `Moved ${pluralizeCount(result.count ?? target.count, entityLabel)}`,
        { description: priorityFallbackNote(result.priorityFallbacks) }
      );
    } else {
      const result = await mutate(moveEntity(entityKind, target.id, projectId));
      setMoving(false);

      if (isActionError(result)) {
        toast.error(result.error);
        return;
      }
      toast.success(`Moved ${target.name}`, {
        description: priorityFallbackNote(result.priorityFallbacks),
      });
    }

    onOpenChange(false);
    onMoved(projectId);
  };

  return (
    <Dialog open={open} onOpenChange={moving ? undefined : onOpenChange}>
      <DialogContent className="bg-paper">
        <DialogHeader>
          <DialogTitle>
            {"selection" in target
              ? `Move ${pluralizeCount(target.count, entityLabel)} to ${
                  selectedProjectName ?? "…"
                }?`
              : `Move ${target.name}`}
          </DialogTitle>
          <DialogDescription>
            {"selection" in target
              ? SELECTION_RULES[entityKind]
              : `Files and attachments this ${entityKind} shares with anything else in this project stay behind, a status the destination project does not have is cleared, and a priority it has no level of the same name for takes its default.`}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-1.5">
          <Label htmlFor="move-target-project">Destination project</Label>
          <Select
            value={targetId}
            onValueChange={(next) => chooseTarget(String(next))}
            disabled={moving || targets.length === 0}
            items={targets.map((project) => ({
              value: String(project.id),
              label: project.name,
            }))}
          >
            <SelectTrigger id="move-target-project" className="w-full">
              <SelectValue
                placeholder={
                  projects === null && loadError === null
                    ? "Loading projects…"
                    : "Choose a project"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {targets.map((project) => (
                <SelectItem key={project.id} value={String(project.id)}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-small text-ink-soft" aria-live="polite">
            {loadError ??
              (projects !== null && targets.length === 0
                ? "You are not in another project to move this to."
                : "")}
          </p>
        </div>

        {preview?.targetId === targetId && (
          <DroppedFieldsNote
            preview={preview}
            destination={selectedProjectName ?? "The destination"}
          />
        )}

        <DialogFooter showCloseButton>
          <Button onClick={move} disabled={!targetId || moving || checking}>
            {moving && <Spinner />}
            Move
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
