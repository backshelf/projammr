"use server";

import { serverApi } from "@/lib/server-api";
import type { ActionError, ProjectStorage } from "@workspace/api/api";
import { toActionResult } from "@workspace/api/lib/action-result";

export async function getProjectStorage(
  projectId: number
): Promise<ProjectStorage | ActionError> {
  const res = await serverApi.GET("/api/projects/{id}/storage", {
    params: { path: { id: String(projectId) } },
  });

  return toActionResult(res, "Failed to read the project's storage");
}
