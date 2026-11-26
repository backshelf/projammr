"use server";

import { serverApi } from "@/lib/server-api";
import { toActionResult } from "@workspace/api/lib/action-result";
import { ActionError, Activity } from "@workspace/api/api";

export async function getProjectActivity(
  projectId: number,
  opts: {
    entityType?: "project" | "collection" | "track" | "session";
    entityId?: number;
    limit?: number;
  } = {}
): Promise<Activity[] | ActionError> {
  const res = await serverApi.GET("/api/projects/{id}/activity", {
    params: {
      path: { id: String(projectId) },
      query: {
        entityType: opts.entityType,
        entityId: opts.entityId,
        limit: opts.limit,
      },
    },
  });

  return toActionResult(res, "Failed to fetch activity");
}
