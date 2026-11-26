"use client";

import { browserApi } from "@/lib/browser-api";
import { defineMutation } from "@/lib/mutation";
import { toActionResult } from "@workspace/api/lib/action-result";

/**
 * Deletes a project's files in one request. The server skips an id that names
 * no file, or one in another project, so `deleted` can be lower than
 * `ids.length`.
 */
export const bulkDeleteAssets = (projectId: number, ids: number[]) =>
  defineMutation(async () => {
    const res = await browserApi.DELETE("/api/assets/bulk", {
      body: { projectId, ids },
    });

    return toActionResult<{ deleted: number }>(res, "Failed to delete files");
  }, ["route"]);

/**
 * Deletes the duplicate audio the audit listed as removable. The server skips
 * an id the audit no longer lists there, so `deleted` can be lower than
 * `ids.length`.
 */
export const removeDuplicateAudio = (projectId: number, ids: number[]) =>
  defineMutation(async () => {
    const res = await browserApi.POST(
      "/api/assets/project/{projectId}/duplicates/remove",
      { params: { path: { projectId: String(projectId) } }, body: { ids } }
    );

    return toActionResult<{ deleted: number }>(
      res,
      "Failed to remove duplicate audio"
    );
  }, ["route"]);
