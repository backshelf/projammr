"use server";

import { serverApi } from "@/lib/server-api";
import { toActionResult } from "@workspace/api/lib/action-result";
import { ActionError, SavedView, SavedViewKind } from "@workspace/api/api";

export async function getSavedViews(
  projectId: number,
  kind: SavedViewKind
): Promise<SavedView[] | ActionError> {
  const res = await serverApi.GET("/api/projects/{id}/saved-views", {
    params: { path: { id: String(projectId) }, query: { kind } },
  });

  return toActionResult(res, "Failed to fetch saved views");
}
