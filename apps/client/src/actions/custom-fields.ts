"use server";

import { serverApi } from "@/lib/server-api";
import { written } from "@/lib/write-action";
import {
  toActionOutcome,
  toActionResult,
} from "@workspace/api/lib/action-result";
import type {
  ActionError,
  CustomField,
  CustomFieldEdit,
  CustomFieldKind,
  NewCustomField,
} from "@workspace/api/api";

/**
 * A project's custom fields: `kind`'s in their order, or every kind's, kind by
 * kind, when it is absent.
 */
export async function getCustomFields(
  projectId: number,
  kind?: CustomFieldKind
): Promise<CustomField[] | ActionError> {
  const res = await serverApi.GET("/api/projects/{id}/fields", {
    params: { path: { id: String(projectId) }, query: { kind } },
  });

  return toActionResult(res, "Failed to fetch custom fields");
}

export async function createCustomField(
  projectId: number,
  data: NewCustomField
): Promise<CustomField | ActionError> {
  const res = await serverApi.POST("/api/projects/{id}/fields", {
    params: { path: { id: String(projectId) } },
    body: data,
  });

  return written(toActionResult(res, "Failed to create field"));
}

export async function updateCustomField(
  projectId: number,
  fieldId: number,
  /** `options` is the full list: an existing option keeps its `id`. */
  data: CustomFieldEdit
): Promise<CustomField | ActionError> {
  const res = await serverApi.PATCH("/api/projects/{id}/fields/{fieldId}", {
    params: { path: { id: String(projectId), fieldId: String(fieldId) } },
    body: data,
  });

  return written(toActionResult(res, "Failed to update field"));
}

/** Orders one kind's fields: `ids` lists every field of that kind once. */
export async function reorderCustomFields(
  projectId: number,
  ids: number[]
): Promise<CustomField[] | ActionError> {
  const res = await serverApi.PUT("/api/projects/{id}/fields/order", {
    params: { path: { id: String(projectId) } },
    body: { ids },
  });

  return written(toActionResult(res, "Failed to reorder fields"));
}

export async function deleteCustomField(
  projectId: number,
  fieldId: number
): Promise<{ ok: true } | ActionError> {
  const res = await serverApi.DELETE("/api/projects/{id}/fields/{fieldId}", {
    params: { path: { id: String(projectId), fieldId: String(fieldId) } },
  });

  return written(
    toActionOutcome(res, "Failed to delete field", { ok: true } as const)
  );
}
