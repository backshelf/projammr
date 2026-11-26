"use client";

import { browserApi } from "@/lib/browser-api";
import { storageLimitFailure, storageLimitMessage } from "@/lib/storage-limit";
import { imageUrl } from "@/lib/utils";
import { useFormat } from "@workspace/ui/components/format-provider";
import type { Formatters } from "@workspace/ui/lib/formatters";
import {
  tooBigMaximum,
  uploadInstanceImage,
} from "@/components/uploads/upload-client";
import {
  isActionError,
  type ActionError,
} from "@workspace/api/lib/action-result";
import { IMAGE_ACCEPT } from "@workspace/api/lib/upload";
import { Button } from "@workspace/ui/components/button";
import { useEffect, useRef, useState } from "react";
import { describedByOf, labelIdOf, type CustomSettingControl } from "../types";

/**
 * Why an upload was refused, in words: the storage cap, the upload limit, or
 * the validator's own reason (a type the instance does not take), before the
 * envelope's bare "Invalid request".
 */
function refusal(failure: ActionError, format: Formatters): string {
  const limit = storageLimitFailure(failure);
  if (limit) return storageLimitMessage(limit);
  const maximum = tooBigMaximum(failure);
  if (maximum !== null) {
    return `That image is over the ${format.bytes(maximum, 0)} upload limit`;
  }
  const issues = failure.details?.issues;
  const first = Array.isArray(issues) ? issues[0] : undefined;
  return typeof first?.message === "string" ? first.message : failure.error;
}

/**
 * What an image id resolves to: the stored key its bytes are served at, or
 * `null` once the image is gone. Absent while it is being read.
 */
function useImagePath(id: number | null): string | null | undefined {
  const [found, setFound] = useState<{ id: number; path: string | null }>();

  useEffect(() => {
    if (id === null) return;
    let current = true;
    void browserApi
      .GET("/api/images/{id}", { params: { path: { id: String(id) } } })
      .then(({ data, response }) => {
        if (!current) return;
        if (data) setFound({ id, path: data.assetPath });
        else if (response.status === 404) setFound({ id, path: null });
      });
    return () => {
      current = false;
    };
  }, [id]);

  return found?.id === id ? found.path : undefined;
}

/**
 * An image of the instance's own, held by id (the setting's schema: an id or
 * null): its thumbnail with Replace and Remove, or one Upload button while
 * none is set. A chosen file is uploaded as an instance image — an admin's to
 * add, anyone's to see — and the setting takes its id; Remove clears the
 * setting and leaves the image stored. An id whose image has been deleted
 * says so, since every reader falls back to the default for it.
 */
export const ImageControl: CustomSettingControl = ({
  definition,
  value,
  onChange,
  disabled,
  id,
}) => {
  const format = useFormat();
  const current = definition.schema.safeParse(value);
  const selected =
    current.success && typeof current.data === "number" ? current.data : null;
  const path = useImagePath(selected);
  const pickerRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const busy = disabled || progress !== null;
  const noun = definition.label.toLowerCase();

  const upload = async (file: File) => {
    setFailure(null);
    setProgress(0);
    try {
      const result = await uploadInstanceImage(file, setProgress);
      if (isActionError(result)) {
        setFailure(refusal(result, format));
        return;
      }
      onChange(result.id);
    } finally {
      setProgress(null);
    }
  };

  return (
    <div
      role="group"
      aria-labelledby={labelIdOf(id)}
      aria-describedby={describedByOf(id)}
      aria-busy={progress !== null || undefined}
      className="flex w-72 flex-col items-end gap-1.5"
    >
      <div className="flex items-center gap-3">
        {selected !== null && path && (
          // eslint-disable-next-line @next/next/no-img-element -- a stored image through the media proxy, as every cover is
          <img
            src={imageUrl(path, 256)}
            alt={`The current ${noun}`}
            className="size-12 rounded-sm border border-rule bg-paper-sunk object-contain"
          />
        )}
        <input
          ref={pickerRef}
          id={id}
          type="file"
          accept={IMAGE_ACCEPT}
          disabled={busy}
          className="sr-only"
          tabIndex={-1}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void upload(file);
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => pickerRef.current?.click()}
        >
          {progress !== null
            ? `Uploading… ${Math.round(progress * 100)}%`
            : selected === null
              ? "Upload an image"
              : "Replace"}
        </Button>
        {selected !== null && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            aria-label={`Remove the ${noun}`}
            onClick={() => onChange(null)}
          >
            Remove
          </Button>
        )}
      </div>
      {selected !== null && path === null && (
        <p className="max-w-[36ch] text-right text-small text-pretty text-ink-soft">
          This image has been deleted, so the default shows in its place. Upload
          another or remove it.
        </p>
      )}
      {failure !== null && (
        <p role="alert" className="text-right text-small text-danger">
          {failure}
        </p>
      )}
    </div>
  );
};
