"use client";

import { attachAssetTo } from "@/actions/assets";
import {
  TILE,
  TILE_KIND,
  TILE_NAME,
} from "@/components/attachments/AppAttachment";
import { useProject, useProjectRole } from "@/hooks/use-project-role";
import { storageLimitFailure, storageLimitMessage } from "@/lib/storage-limit";
import { attachmentStateFor } from "@/components/uploads/attachment-state";
import { AttachTo, dropPromptFor } from "@/components/uploads/drop-prompt";
import { useTrackedJob } from "@/components/uploads/use-tracked-job";
import { uploadAsset } from "@/components/uploads/upload-client";
import {
  type TransferStatus,
  uploadRowPhase,
  uploadRowShouldClose,
  uploadRowText,
} from "@/components/uploads/upload-row";
import { useUploadLimit } from "@/components/uploads/use-upload-limit";
import { useFormat } from "@workspace/ui/components/format-provider";
import {
  IconAlertCircle,
  IconCheck,
  IconLoader2,
  IconUpload,
} from "@tabler/icons-react";
import { isActionError } from "@workspace/api/lib/action-result";
import { DropZone, dropZoneLabel } from "@workspace/ui/components/drop-zone";
import { Meter } from "@workspace/ui/components/table";
import { AnimatePresence, m, OPTICAL } from "@workspace/ui/lib/motion";
import { LABEL } from "@workspace/ui/lib/shell";
import { cn } from "@workspace/ui/lib/utils";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

type UploadItem = {
  id: number;
  name: string;
  /** Fraction sent, 0–1. */
  progress: number;
  status: TransferStatus;
  /** The background job to follow once the transfer completes, if
   *  `onUploaded` queued one. */
  jobId?: number;
};

let nextUploadId = 1;

/**
 * Drop box for attachments. Each file is uploaded, then either handed to
 * `onUploaded`, attached to the parent entity (which refreshes the route
 * itself), or — with no parent to attach to — refreshed here so the new
 * file shows up. A row stays after the transfer completes: silent once it
 * is simply attached, or following whatever job `onUploaded` queued for it
 * until that job lingers out of the project's job map.
 */
export function FileUploader({
  attachTo,
  parentId,
  accept,
  prompt,
  onUploaded,
}: {
  attachTo?: AttachTo;
  parentId?: number;
  accept?: string;
  /** Overrides the drop prompt `attachTo` would choose. */
  prompt?: string;
  /** Returns the id of a job the caller queued for this asset, so the row
   *  can follow it — `undefined` when there is nothing to follow. */
  onUploaded?: (asset: {
    id: number;
    name: string;
  }) => Promise<number | undefined>;
}) {
  const format = useFormat();
  const { id: projectId } = useProject();
  const canEdit = useProjectRole()?.can?.("editor") ?? true;
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const maxBytes = useUploadLimit();
  const router = useRouter();

  const patch = (id: number, changes: Partial<UploadItem>) =>
    setUploads((prev) =>
      prev.map((u) => (u.id === id ? { ...u, ...changes } : u))
    );
  // Stable across renders, so a row's own settle effect only fires once.
  const closeUpload = useCallback(
    (id: number) => setUploads((prev) => prev.filter((u) => u.id !== id)),
    []
  );

  if (!canEdit) return null;

  const uploadFile = async (file: File) => {
    const id = nextUploadId++;
    setUploads((prev) => [
      ...prev,
      { id, name: file.name, progress: 0, status: "uploading" },
    ]);

    const result = await uploadAsset(file, projectId, (fraction) =>
      patch(id, { progress: fraction })
    );

    if (isActionError(result)) {
      patch(id, { status: "error", progress: 0 });
      const limit = storageLimitFailure(result);
      toast.error(
        limit
          ? storageLimitMessage(limit)
          : `Failed to upload ${file.name}: ${result.error}`
      );
      return;
    }

    patch(id, { status: "completed", progress: 1 });

    if (onUploaded) {
      const jobId = await onUploaded({ id: result.id, name: result.name });
      if (jobId != null) patch(id, { jobId });
      return;
    }
    if (attachTo && parentId) {
      const attached = await attachAssetTo(result.id, attachTo, parentId);
      if (isActionError(attached)) {
        patch(id, { status: "error", progress: 0 });
        toast.error(`Failed to attach: ${attached.error}`);
      }
      return;
    }
    router.refresh();
  };

  const uploadAll = async (files: File[]) => {
    for (const file of files) await uploadFile(file);
  };

  return (
    <DropZone
      onFiles={(files) => void uploadAll(files)}
      accept={accept}
      multiple
      className="p-6 text-center text-small"
    >
      <span className={cn(dropZoneLabel, "mb-1.5 block")}>
        <IconUpload className="mr-1 inline size-4 align-[-2px]" />
        {prompt ?? dropPromptFor(attachTo)}
      </span>
      or click to browse
      {maxBytes != null && (
        <span className="mt-1.5 block text-micro text-ink-soft">
          Up to {format.bytes(maxBytes)} per file
        </span>
      )}
      {uploads.length > 0 && (
        <div
          className="mt-3 flex flex-col gap-1.5"
          onClick={(e) => e.stopPropagation()}
        >
          <AnimatePresence initial={false}>
            {uploads.map((u) => (
              <m.div
                key={u.id}
                variants={OPTICAL}
                initial={"hidden"}
                animate={"shown"}
                exit={"leaving"}
              >
                <UploadRow item={u} onSettled={closeUpload} />
              </m.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </DropZone>
  );
}

/**
 * One upload's row, isolated so that following its job re-renders only this
 * row rather than the whole drop zone: `useTrackedJob` subscribes to the
 * project's job map, and every other upload sits still while one of them
 * ticks. Removes itself from the drop zone once a job it followed has
 * lingered out — a plain upload with nothing to follow stays, its finished
 * row its own silent confirmation.
 */
function UploadRow({
  item,
  onSettled,
}: {
  item: UploadItem;
  onSettled: (id: number) => void;
}) {
  const { job, hasTrackedJob } = useTrackedJob(item.jobId);
  // The uploader's caption never reads a job's elapsed time, so a clock
  // frozen at mount reads exactly as well as a fresh one.
  const [now] = useState(() => Date.now());
  const phase = uploadRowPhase({
    status: item.status,
    jobId: item.jobId,
    job,
    hasTrackedJob,
  });
  const text = uploadRowText({ phase, progress: item.progress, job, now });
  const shouldClose = uploadRowShouldClose({
    phase,
    jobId: item.jobId,
    hasTrackedJob,
  });

  useEffect(() => {
    if (shouldClose) onSettled(item.id);
  }, [shouldClose, item.id, onSettled]);

  const state = attachmentStateFor(phase);
  const busy = state === "uploading" || state === "processing";
  const failed = state === "error";

  return (
    <div
      className={cn(TILE, "w-full text-left")}
      data-state={state}
      aria-busy={busy || undefined}
    >
      <div className={cn(TILE_KIND, failed && "text-danger")}>
        {failed ? (
          <IconAlertCircle aria-hidden />
        ) : phase === "done" ? (
          <IconCheck aria-hidden />
        ) : text.percent != null ? (
          <Meter value={text.percent} showValue={phase === "following"} />
        ) : (
          <IconLoader2 className="animate-spin" aria-hidden />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <p className={cn(TILE_NAME, busy && "shimmer")}>{item.name}</p>
        {text.caption && (
          <p
            className={cn(
              LABEL,
              "min-w-0 [overflow-wrap:anywhere]",
              failed ? "text-danger" : "text-ink-soft"
            )}
          >
            {text.caption}
          </p>
        )}
        {text.stepLine && (
          <p
            className={cn(
              "min-w-0 text-micro [overflow-wrap:anywhere] text-ink-soft"
            )}
          >
            {text.stepLine}
          </p>
        )}
      </div>
    </div>
  );
}
