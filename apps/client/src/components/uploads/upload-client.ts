"use client";

import { browserApi } from "@/lib/browser-api";
import type { ActionError, Asset, ImageUploadResult } from "@workspace/api/api";
import {
  isActionError,
  toActionResult,
} from "@workspace/api/lib/action-result";
import { uploadMultipart } from "@workspace/api/lib/authed-client";

/*
 * Uploads post to the API's multipart routes rather than a server action,
 * which would cap the request body at Next's 1MB server-action limit. The
 * bytes still pass through the Next server, which forwards `/api/*` on to the
 * API — that is what keeps them same-origin and carrying the session cookie.
 */

export type UploadProgress = (fraction: number) => void;

export function uploadAsset(
  file: File,
  projectId: number,
  onProgress?: UploadProgress
): Promise<Asset | ActionError> {
  return uploadMultipart<Asset>(
    "/api/assets/upload",
    file,
    { projectId },
    onProgress
  );
}

/** Uploads an image; without a `projectId` it is a user image (an avatar). */
export function uploadImage(
  file: File,
  projectId?: number,
  onProgress?: UploadProgress
): Promise<ImageUploadResult | ActionError> {
  return uploadMultipart<ImageUploadResult>(
    "/api/images/upload",
    file,
    { projectId },
    onProgress
  );
}

/**
 * Uploads an image of the instance's own (a logo, an app icon): an instance
 * admin's alone, and readable by anyone once stored.
 */
export function uploadInstanceImage(
  file: File,
  onProgress?: UploadProgress
): Promise<ImageUploadResult | ActionError> {
  return uploadMultipart<ImageUploadResult>(
    "/api/images/instance",
    file,
    {},
    onProgress
  );
}

/** The largest file, in bytes, the upload routes accept. */
export async function uploadLimit(): Promise<number | ActionError> {
  const result = await toActionResult<{ maxBytes: number }>(
    await browserApi.GET("/api/uploads/limits"),
    "Could not read the upload limit"
  );
  return isActionError(result) ? result : result.maxBytes;
}

/**
 * The byte cap an upload was refused for being over, or null for any other
 * failure. The upload routes answer a file over the instance's upload limit —
 * caught by the body's declared length or by the route's validator — with a
 * 400 whose `details.issues` lists a `too_big` issue carrying the `maximum`,
 * which `uploadMultipart` hands back as the failure's `details`.
 */
export function tooBigMaximum(failure: ActionError): number | null {
  const issues = failure.details?.issues;
  if (!Array.isArray(issues)) return null;
  const issue = issues.find(
    (i): i is { code: "too_big"; maximum: number } =>
      typeof i === "object" &&
      i !== null &&
      i.code === "too_big" &&
      typeof i.maximum === "number"
  );
  return issue?.maximum ?? null;
}
