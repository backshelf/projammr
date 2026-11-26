"use server";

import { serverApi } from "@/lib/server-api";
import { written } from "@/lib/write-action";
import {
  toActionOutcome,
  toActionResult,
} from "@workspace/api/lib/action-result";
import { ActionError, Label } from "@workspace/api/api";

export async function getLabels(
  projectId: number
): Promise<Label[] | ActionError> {
  const res = await serverApi.GET("/api/projects/{id}/labels", {
    params: { path: { id: String(projectId) } },
  });

  return toActionResult(res, "Failed to fetch labels");
}

export type UpdateLabelData = {
  name?: string;
  colourHex?: string;
};

export async function createLabel(
  projectId: number,
  data: UpdateLabelData & { name: string }
): Promise<Label | ActionError> {
  const res = await serverApi.POST("/api/projects/{id}/labels", {
    params: { path: { id: String(projectId) } },
    body: data,
  });

  return written(toActionResult(res, "Failed to create label"));
}

export async function updateLabel(
  projectId: number,
  labelId: number,
  data: UpdateLabelData
): Promise<Label | ActionError> {
  const res = await serverApi.PATCH("/api/projects/{id}/labels/{labelId}", {
    params: { path: { id: String(projectId), labelId: String(labelId) } },
    body: data,
  });

  return written(toActionResult(res, "Failed to update label"));
}

export async function deleteLabel(
  projectId: number,
  labelId: number
): Promise<{ ok: true } | ActionError> {
  const res = await serverApi.DELETE("/api/projects/{id}/labels/{labelId}", {
    params: { path: { id: String(projectId), labelId: String(labelId) } },
  });

  return written(
    toActionOutcome(res, "Failed to delete label", { ok: true } as const)
  );
}
