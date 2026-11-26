"use client";

import { linkNote } from "@/actions/notes";
import { getTrackSummaries } from "@/actions/tracks";
import type { PickerLoad } from "@/components/product-linking/EntityPicker";
import { LinkPickerDialog } from "@/components/product-linking/LinkPickerDialog";
import { TrackRow, trackMatches } from "@/components/product-linking/pickers";
import { clientGetMyProjects } from "@/lib/client-api";
import type { MyProject, TrackSummary } from "@workspace/api/api";
import { isActionError } from "@workspace/api/lib/action-result";
import { Label } from "@workspace/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

/**
 * Makes an open note a track's lyrics. Notes are not scoped to a project, so
 * the track has to be reached through one: a project first, then its tracks.
 */
export function LinkNoteDialog({
  open,
  onOpenChange,
  noteId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  noteId: number;
}) {
  const [projects, setProjects] = useState<MyProject[] | null>(null);
  const [projectId, setProjectId] = useState("");

  useEffect(() => {
    if (!open || projects !== null) return;

    let cancelled = false;
    void clientGetMyProjects().then((result) => {
      if (cancelled) return;
      if (isActionError(result)) toast.error(result.error);
      else setProjects(result);
    });

    return () => {
      cancelled = true;
    };
  }, [open, projects]);

  const load = useCallback<PickerLoad<TrackSummary>>(async () => {
    const result = await getTrackSummaries(Number(projectId));
    return isActionError(result) ? result : { items: result };
  }, [projectId]);

  return (
    <LinkPickerDialog
      open={open}
      onOpenChange={onOpenChange}
      title={"Link to a track"}
      description={
        <>
          The note becomes that track&rsquo;s lyrics, and everyone on the
          project can read it.
        </>
      }
      scope={
        <div className={"grid gap-1.5"}>
          <Label htmlFor={"link-note-project"}>Project</Label>
          <Select
            value={projectId}
            onValueChange={setProjectId}
            items={(projects ?? []).map((project) => ({
              value: String(project.id),
              label: project.name,
            }))}
          >
            <SelectTrigger id={"link-note-project"} className={"w-full"}>
              <SelectValue
                placeholder={
                  projects === null ? "Loading projects…" : "Choose a project"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {(projects ?? []).map((project) => (
                <SelectItem key={project.id} value={String(project.id)}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      }
      scopeKey={projectId}
      load={projectId ? load : null}
      matches={trackMatches}
      renderRow={(track) => <TrackRow track={track} />}
      placeholder={"Search by title, artist, key or BPM…"}
      emptyLabel={"No tracks in this project yet."}
      link={(track) => linkNote(noteId, track.id)}
      linkedLabel={(track) => `Linked to "${track.title}"`}
    />
  );
}
