"use client";

import { useEntityKey } from "@/components/commands/entity-surface";
import { archiveTracks, unarchiveTracks } from "@/entities/track/archive";
import { removeEntity } from "@/entities/mutations";
import { useDeleteGate } from "@/hooks/use-delete-gate";
import { toastActionResult } from "@/lib/action-toast";
import { applyMutation } from "@/lib/mutation";
import { useFeedbackPolicy } from "@/lib/policies/provider";
import { hrefFromParsedRoute } from "@/lib/utils";
import { isActionError } from "@workspace/api/lib/action-result";
import { ConfirmDeleteDialog } from "@workspace/ui/components/confirm-delete-dialog";
import { SectionAction } from "@workspace/ui/components/layout/empty-section";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

type TrackRef = { projectId: number; trackId: number; title: string };

/** Runs an archive command on one track and toasts its result, Undo included. */
function useArchiveCommand(
  command: typeof archiveTracks,
  { projectId, trackId, title }: TrackRef
) {
  const router = useRouter();
  const { undoWindowMs } = useFeedbackPolicy();
  const [pending, setPending] = useState(false);

  const run = async () => {
    setPending(true);
    try {
      toastActionResult(
        await command({
          projectId,
          selection: { ids: [trackId] },
          title,
          router,
        }),
        undoWindowMs
      );
    } finally {
      setPending(false);
    }
  };

  return { pending, run };
}

/**
 * The track's lifecycle actions at the foot of the rail: Archive then Delete
 * for a live track, Delete alone for an archived one, whose Unarchive sits
 * beside its flag in the byline instead.
 */
export function TrackRailActions({
  archived,
  ...track
}: TrackRef & { archived: boolean }) {
  const archive = useArchiveCommand(archiveTracks, track);
  const router = useRouter();

  // The deleted track's page has nothing left to render, so the route the
  // delete invalidates is the tracks list it lands on, never this one.
  const handleDelete = async () => {
    const tracksHref = hrefFromParsedRoute(
      { kind: "track-all" },
      track.projectId
    );
    const result = await applyMutation(removeEntity("track", track.trackId), {
      refresh: () => router.push(tracksHref),
    });
    if (isActionError(result)) {
      toast.error(`Could not delete ${track.title}: ${result.error}`);
      return;
    }
    toast.success(`Deleted ${track.title}`);
  };
  const deletion = useDeleteGate("track", handleDelete);
  useEntityKey("delete", () => deletion.request());

  return (
    <div className={"flex flex-col items-start gap-1.5"}>
      {!archived && (
        <SectionAction disabled={archive.pending} onClick={archive.run}>
          Archive track
        </SectionAction>
      )}
      <SectionAction
        className={"text-danger"}
        onClick={() => deletion.request()}
      >
        Delete track
      </SectionAction>
      <ConfirmDeleteDialog
        {...deletion.dialog}
        title={`Delete ${track.title}?`}
      />
    </div>
  );
}

/** The byline's way back for an archived track, beside its Archived flag. */
export function UnarchiveAction(track: TrackRef) {
  const unarchive = useArchiveCommand(unarchiveTracks, track);

  return (
    <SectionAction disabled={unarchive.pending} onClick={unarchive.run}>
      Unarchive
    </SectionAction>
  );
}
