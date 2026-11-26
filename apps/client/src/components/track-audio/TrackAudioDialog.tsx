"use client";

import { attachAssetTo, deleteAsset } from "@/actions/assets";
import {
  getCandidateAudios,
  linkTrackAudios,
  unlinkTrackAudio,
} from "@/actions/track-audios";
import { FileUploader } from "@/components/uploads/FileUploader";
import { VersionBadge } from "@/components/track-audio/VersionBadge";
import { useDeleteGate } from "@/hooks/use-delete-gate";
import { useProjectRole } from "@/hooks/use-project-role";
import { useFormat } from "@workspace/ui/components/format-provider";
import {
  IconSquare,
  IconSquareCheckFilled,
  IconTrash,
} from "@tabler/icons-react";
import type { CandidateAudio } from "@workspace/api/api";
import { isActionError } from "@workspace/api/lib/action-result";
import { AUDIO_ACCEPT } from "@workspace/api/lib/upload";
import { Button } from "@workspace/ui/components/button";
import { ConfirmDeleteDialog } from "@workspace/ui/components/confirm-delete-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Input } from "@workspace/ui/components/input";
import { Separator } from "@workspace/ui/components/separator";
import { Spinner } from "@workspace/ui/components/spinner";
import { cn } from "@workspace/ui/lib/utils";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

/**
 * When the file came from a scanned folder its own creation date is what the
 * musician recognises; the asset row's date is just when it reached the app.
 */
const audioDate = (asset: CandidateAudio) =>
  new Date(asset.localFileCreatedAt ?? asset.createdAt);

export function TrackAudioDialog({
  trackId,
  open,
  onOpenChange,
}: {
  trackId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const projectRole = useProjectRole();
  const canEdit = projectRole ? projectRole.can("editor") : true;
  const format = useFormat();
  const [candidates, setCandidates] = useState<CandidateAudio[]>([]);
  const [checked, setChecked] = useState<Set<number>>(() => new Set());
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await getCandidateAudios(trackId);
    if (isActionError(result)) {
      toast.error(`Couldn't load audio files: ${result.error}`);
      setLoading(false);
      return;
    }

    const byNewest = [...result].sort(
      (a, b) => audioDate(b).getTime() - audioDate(a).getTime()
    );
    setCandidates(byNewest);
    setChecked(new Set(byNewest.filter((c) => c.trackAudio).map((c) => c.id)));
    setLoading(false);
  }, [trackId]);

  useEffect(() => {
    // Opening the dialog starts the fetch; the synchronous part is the loading
    // flag the dialog renders while it is in flight.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open && canEdit) load();
  }, [open, canEdit, load]);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter((c) => c.name.toLowerCase().includes(q));
  }, [candidates, filter]);

  const toggle = (assetId: number) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(assetId)) next.delete(assetId);
      else next.add(assetId);
      return next;
    });

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) setFilter("");
    onOpenChange(isOpen);
  };

  const remove = async (candidate: CandidateAudio) => {
    setDeletingId(candidate.id);
    const result = await deleteAsset(candidate.id);
    if (isActionError(result)) {
      toast.error(`Couldn't delete ${candidate.name}: ${result.error}`);
      setDeletingId(null);
      return;
    }
    setDeletingId(null);
    await load();
  };
  const deletion = useDeleteGate<CandidateAudio>("audioVersion", remove);

  const save = async () => {
    setSaving(true);

    const unlinked = candidates.filter(
      (c) => c.trackAudio && !checked.has(c.id)
    );
    const toLink = candidates
      .filter((c) => checked.has(c.id) && !c.trackAudio)
      .map((c) => c.id);

    for (const candidate of unlinked) {
      const result = await unlinkTrackAudio(candidate.trackAudio!.id);
      if (isActionError(result)) {
        toast.error(`Couldn't remove ${candidate.name}: ${result.error}`);
        setSaving(false);
        return;
      }
    }

    if (toLink.length > 0) {
      const result = await linkTrackAudios(trackId, toLink);
      if (isActionError(result)) {
        toast.error(`Couldn't add versions: ${result.error}`);
        setSaving(false);
        return;
      }
    }

    setSaving(false);
    handleOpenChange(false);
  };

  const linkedCount = checked.size;
  if (!canEdit) return null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[80vh] flex-col bg-paper sm:max-w-2xl">
        <DialogTitle>Track audios</DialogTitle>
        <DialogDescription>
          Every audio file on this track and its sessions. Check the ones that
          are versions of this track.
        </DialogDescription>

        <Input
          placeholder="Filter by filename"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          autoFocus
        />

        <div className="-mx-2 min-h-40 flex-1 overflow-y-auto px-2">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Spinner />
            </div>
          ) : visible.length === 0 ? (
            <p className="py-10 text-center text-body text-ink-soft">
              {candidates.length === 0
                ? "No audio files on this track or its sessions yet. Upload one below."
                : `No filenames match "${filter}".`}
            </p>
          ) : (
            <ul>
              {visible.map((candidate) => {
                const isChecked = checked.has(candidate.id);
                return (
                  <li
                    key={candidate.id}
                    className={cn(
                      "flex items-center border-l-2 motion-ink",
                      isChecked ? "border-l-foreground" : "border-l-transparent"
                    )}
                  >
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={isChecked}
                      onClick={() => toggle(candidate.id)}
                      className={cn(
                        "flex min-w-0 flex-1 items-center gap-3 py-2 pr-2 pl-3 text-left motion-ink",
                        "hover:bg-ink/4 focus-visible:ring-2 focus-visible:ring-art focus-visible:outline-none"
                      )}
                    >
                      {isChecked ? (
                        <IconSquareCheckFilled className="size-4 shrink-0" />
                      ) : (
                        <IconSquare className="size-4 shrink-0 text-ink-soft" />
                      )}
                      <VersionBadge
                        version={candidate.trackAudio?.version ?? null}
                      />
                      <span className="min-w-0 flex-1 truncate text-body">
                        {candidate.name}
                      </span>
                      <span className="shrink-0 font-mono text-small text-ink-soft">
                        {format.bytes(candidate.size)} ·{" "}
                        {format.date(audioDate(candidate))}
                      </span>
                    </button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="mr-1 shrink-0 text-ink-soft hover:text-danger"
                      aria-label={`Delete ${candidate.name}`}
                      disabled={deletingId !== null}
                      onClick={() => deletion.request(candidate)}
                    >
                      {deletingId === candidate.id ? (
                        <Spinner />
                      ) : (
                        <IconTrash />
                      )}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <Separator />

        <FileUploader
          attachTo="track"
          parentId={trackId}
          accept={AUDIO_ACCEPT}
          prompt="Drop a bounce"
          onUploaded={async (asset) => {
            const attached = await attachAssetTo(asset.id, "track", trackId);
            if (isActionError(attached)) {
              toast.error(`Couldn't attach ${asset.name}: ${attached.error}`);
              return undefined;
            }

            const result = await linkTrackAudios(trackId, [asset.id]);
            if (isActionError(result)) {
              toast.error(`Couldn't add ${asset.name}: ${result.error}`);
              return undefined;
            }
            await load();
            return result.analysisJobIds[0];
          }}
        />

        <DialogFooter showCloseButton>
          <Button onClick={save} disabled={loading || saving}>
            {saving
              ? "Saving…"
              : `Save ${linkedCount} version${linkedCount === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
        {/* Inside the popup, so the confirm nests in this dialog rather than
            reading as a press outside it. */}
        <ConfirmDeleteDialog
          {...deletion.dialog}
          title={`Delete ${deletion.pending?.name ?? "this file"}?`}
          description={
            deletion.pending?.trackAudio
              ? `The file comes off everything it is attached to, and version ${deletion.pending.trackAudio.version} of this track goes with it.`
              : "The file comes off everything it is attached to."
          }
          confirmLabel="Delete file"
        />
      </DialogContent>
    </Dialog>
  );
}
