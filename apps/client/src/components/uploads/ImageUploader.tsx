"use client";

import {
  type ParentKind,
  removeImageFromParent,
  setImageOnParent,
} from "@/actions/images";
import { AUDIO_PILL } from "@/components/track-audio/audio-ui";
import { storageLimitFailure, storageLimitMessage } from "@/lib/storage-limit";
import { uploadImage } from "@/components/uploads/upload-client";
import { useTrackedJob } from "@/components/uploads/use-tracked-job";
import { useUploadLimit } from "@/components/uploads/use-upload-limit";
import { uploadRowPhase, uploadRowText } from "@/components/uploads/upload-row";
import { useProject, useProjectRole } from "@/hooks/use-project-role";
import { imageUrl } from "@/lib/utils";
import { useFormat } from "@workspace/ui/components/format-provider";
import { IconLoader2, IconPhoto, IconX } from "@tabler/icons-react";
import { isActionError } from "@workspace/api/lib/action-result";
import { IMAGE_ACCEPT } from "@workspace/api/lib/upload";
import { ConfirmDeleteDialog } from "@workspace/ui/components/confirm-delete-dialog";
import { DropZone, dropZoneLabel } from "@workspace/ui/components/drop-zone";
import { useCoarsePointer } from "@workspace/ui/hooks/use-coarse-pointer";
import { useFileDrop } from "@workspace/ui/hooks/use-file-drop";
import { cn } from "@workspace/ui/lib/utils";
import Image from "next/image";
import type React from "react";
import { useState } from "react";
import { toast } from "sonner";

/**
 * The square cover slot. On a fine pointer it is the dashed drop box, empty
 * or holding the image, with Replace and Remove on hover and keyboard focus.
 * On a coarse pointer there is no drop target: an empty slot is one "Add
 * cover" pill, and a filled one is a plain framed image with a "Change" pill
 * and a 44px remove button, both always visible. The slot stays busy past
 * the byte transfer while it follows the resize job the upload queued, until
 * that job lingers out of the project's job map.
 */
export function ImageUploader({
  kind,
  parentId,
  currentImage,
}: {
  kind: ParentKind;
  parentId: number;
  currentImage?: string | null;
}) {
  const { id: projectId } = useProject();
  const canEdit = useProjectRole()?.can?.("editor") ?? true;
  const [progress, setProgress] = useState<number | null>(null);
  const [jobId, setJobId] = useState<number | undefined>(undefined);
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false);
  const coarsePointer = useCoarsePointer();
  const maxBytes = useUploadLimit();
  const format = useFormat();
  const formatsHint =
    maxBytes == null
      ? "JPG, PNG, GIF, WEBP"
      : `JPG, PNG, GIF, WEBP · max ${format.bytes(maxBytes)}`;

  const { job, hasTrackedJob } = useTrackedJob(jobId);
  // Neither branch below reads a job's elapsed time, so a clock frozen at
  // mount reads exactly as well as a fresh one.
  const [now] = useState(() => Date.now());
  const phase = uploadRowPhase({
    status: progress === null ? "completed" : "uploading",
    jobId,
    job,
    hasTrackedJob,
  });
  const uploading = phase === "uploading" || phase === "following";
  // The byte phase keeps its own percent; once following, the job's current
  // step names the wait instead.
  const label =
    phase === "following"
      ? uploadRowText({ phase, progress: 1, job, now }).caption
      : `Uploading… ${Math.round((progress ?? 0) * 100)}%`;

  const handleUpload = async (file: File) => {
    setProgress(0);
    setJobId(undefined);
    try {
      // The upload only stores the image row; it never touches the parent's
      // `image` field, so the parent is pointed at it in a second call.
      const result = await uploadImage(file, projectId, setProgress);
      if (isActionError(result)) {
        const limit = storageLimitFailure(result);
        toast.error(
          limit
            ? storageLimitMessage(limit)
            : `Failed to upload image: ${result.error}`
        );
        return;
      }

      const setResult = await setImageOnParent(result.id, kind, parentId);
      if (setResult && isActionError(setResult)) {
        toast.error(`Failed to set image: ${setResult.error}`);
        return;
      }

      if (result.variantsJobId != null) setJobId(result.variantsJobId);
    } finally {
      setProgress(null);
    }
  };

  const removeCover = async () => {
    const result = await removeImageFromParent(kind, parentId);
    if (result && isActionError(result)) {
      toast.error(`Failed to remove image: ${result.error}`);
    }
  };

  const handleRemove = (event: React.MouseEvent) => {
    event.stopPropagation();
    void removeCover();
  };

  const { dragging, open, rootProps, inputProps } = useFileDrop({
    onFiles: ([file]) => file && void handleUpload(file),
    disabled: uploading,
  });

  if (!canEdit) {
    if (!currentImage) return null;
    return (
      <div className="relative aspect-square w-full max-w-56 overflow-hidden rounded-lg">
        <Image
          src={imageUrl(currentImage, 1024)}
          alt={`${kind} image`}
          fill
          sizes="14rem"
          style={{ objectFit: "cover" }}
          priority
        />
      </div>
    );
  }

  if (coarsePointer && currentImage) {
    return (
      <div
        className="flex flex-col items-center gap-2"
        data-state={uploading ? "uploading" : undefined}
      >
        <div
          className={cn(
            "relative aspect-square w-full max-w-56 overflow-hidden rounded-lg",
            "data-[state=uploading]:shimmer-surface"
          )}
          data-state={uploading ? "uploading" : undefined}
        >
          <Image
            src={imageUrl(currentImage, 1024)}
            alt={`${kind} image`}
            fill
            sizes="14rem"
            style={{ objectFit: "cover" }}
            priority
          />
          {uploading && (
            <div className="absolute inset-0 z-1 flex items-center justify-center bg-[color-mix(in_oklab,var(--ink)_55%,transparent)] text-paper">
              <IconLoader2 className="size-5 animate-spin" />
            </div>
          )}
          {!uploading && (
            <button
              type="button"
              className={cn(
                "absolute top-1.5 right-1.5 z-2 flex size-11 items-center justify-center rounded-full",
                "bg-[color-mix(in_oklab,var(--ink)_45%,transparent)] text-paper",
                "outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
              )}
              onClick={(event) => {
                event.stopPropagation();
                setConfirmRemoveOpen(true);
              }}
              aria-label="Remove image"
            >
              <IconX className="size-4" />
            </button>
          )}
        </div>
        {!uploading && (
          <button type="button" className={AUDIO_PILL} onClick={open}>
            Change
          </button>
        )}
        <input {...inputProps} accept={IMAGE_ACCEPT} />
        <ConfirmDeleteDialog
          open={confirmRemoveOpen}
          onOpenChange={setConfirmRemoveOpen}
          title={`Remove ${kind} cover?`}
          description="The artwork will be unlinked from this page."
          confirmLabel="Remove"
          onConfirm={removeCover}
        />
      </div>
    );
  }

  if (coarsePointer) {
    return (
      <div className="flex flex-col items-center gap-2">
        <button
          type="button"
          className={AUDIO_PILL}
          onClick={open}
          disabled={uploading}
        >
          {uploading ? (
            <>
              <IconLoader2 className="size-3.5 animate-spin" />
              {label}
            </>
          ) : (
            "Add cover"
          )}
        </button>
        {!uploading && (
          <span className="text-micro text-ink-soft">{formatsHint}</span>
        )}
        <input {...inputProps} accept={IMAGE_ACCEPT} />
      </div>
    );
  }

  if (currentImage) {
    return (
      <div
        data-state={uploading ? "uploading" : undefined}
        data-drag={dragging || undefined}
        onDragOver={rootProps.onDragOver}
        onDragLeave={rootProps.onDragLeave}
        onDrop={rootProps.onDrop}
        className={cn(
          "group/art relative aspect-square w-full max-w-56 overflow-hidden rounded-lg border border-dashed border-rule-strong text-ink-soft motion-ink",
          "hover:border-[color-mix(in_oklab,var(--art)_55%,var(--rule-strong))]",
          "data-[drag]:border-[color-mix(in_oklab,var(--art)_55%,var(--rule-strong))]",
          "data-[state=uploading]:shimmer-surface"
        )}
      >
        <button
          type="button"
          onClick={open}
          disabled={uploading}
          aria-label={
            uploading
              ? (label ?? `Uploading ${kind} image`)
              : `Replace ${kind} image`
          }
          className="group/replace relative block size-full cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-default"
        >
          <Image
            src={imageUrl(currentImage, 1024)}
            alt={`${kind} image`}
            fill
            sizes="14rem"
            style={{ objectFit: "cover" }}
            priority
          />
          <span
            className={cn(
              "absolute inset-0 z-1 flex items-center justify-center opacity-0 motion-reveal",
              "bg-[color-mix(in_oklab,var(--ink)_55%,transparent)] text-paper",
              "font-sub text-small tracking-[0.1em] uppercase",
              "group-hover/art:opacity-100 group-focus-visible/replace:opacity-100 group-data-[drag]/art:opacity-100",
              uploading && "opacity-100"
            )}
          >
            {uploading ? (
              <IconLoader2 className="size-5 animate-spin" />
            ) : (
              <span>Replace</span>
            )}
          </span>
        </button>
        {!uploading && (
          <button
            type="button"
            className={cn(
              "absolute top-1.5 right-1.5 z-2 flex size-6 items-center justify-center rounded-full",
              "bg-[color-mix(in_oklab,var(--ink)_45%,transparent)] text-paper opacity-0 motion-reveal",
              "hover:bg-[color-mix(in_oklab,var(--ink)_65%,transparent)]",
              "outline-none focus-visible:ring-2 focus-visible:ring-ring/30",
              "group-focus-within/art:opacity-100 group-hover/art:opacity-100"
            )}
            onClick={handleRemove}
            aria-label="Remove image"
          >
            <IconX className="size-3.5" aria-hidden />
          </button>
        )}
        <input {...inputProps} accept={IMAGE_ACCEPT} />
      </div>
    );
  }

  return (
    <DropZone
      onFiles={([file]) => file && void handleUpload(file)}
      accept={IMAGE_ACCEPT}
      disabled={uploading}
      data-state={uploading ? "uploading" : undefined}
      className={cn(
        "group/art relative flex aspect-square w-full max-w-56 flex-col items-center justify-center gap-2 overflow-hidden p-4 text-center",
        "data-[state=uploading]:shimmer-surface"
      )}
    >
      {uploading ? (
        <>
          <IconLoader2 className="size-5 animate-spin" />
          <span className={dropZoneLabel}>{label}</span>
        </>
      ) : (
        <>
          <IconPhoto className="size-5" />
          <span className={dropZoneLabel}>Drop an image</span>
          <span className="text-micro text-ink-soft">{formatsHint}</span>
        </>
      )}
    </DropZone>
  );
}
