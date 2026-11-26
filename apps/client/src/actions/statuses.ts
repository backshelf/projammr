"use server";

import { serverApi } from "@/lib/server-api";
import { written } from "@/lib/write-action";
import {
  toActionOutcome,
  toActionResult,
} from "@workspace/api/lib/action-result";
import { ActionError, Status } from "@workspace/api/api";

export async function getStatuses(
  projectId: number
): Promise<Status[] | ActionError> {
  const res = await serverApi.GET("/api/projects/{id}/statuses", {
    params: { path: { id: String(projectId) } },
  });

  return toActionResult(res, "Failed to fetch statuses");
}

export type NewStatus = {
  name: string;
  percentage?: number;
  description?: string;
  colourHex?: string;
  projectId: number;
};

export type UpdateStatusData = {
  name?: string;
  percentage?: number;
  description?: string;
  colourHex?: string;
};

export async function createStatus(
  data: NewStatus
): Promise<Status | ActionError> {
  const res = await serverApi.POST("/api/statuses", { body: data });

  return written(toActionResult(res, "Failed to create status"));
}

export async function updateStatus(
  id: number,
  data: UpdateStatusData
): Promise<Status | ActionError> {
  const res = await serverApi.PATCH("/api/statuses/{id}", {
    params: { path: { id: String(id) } },
    body: data,
  });

  return written(toActionResult(res, "Failed to update status"));
}

export async function deleteStatus(
  id: number
): Promise<{ ok: true } | ActionError> {
  const res = await serverApi.DELETE("/api/statuses/{id}", {
    params: { path: { id: String(id) } },
  });

  return written(
    toActionOutcome(res, "Failed to delete status", { ok: true } as const)
  );
}
