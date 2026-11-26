"use server";

import { serverApi } from "@/lib/server-api";
import { written } from "@/lib/write-action";
import {
  toActionOutcome,
  toActionResult,
} from "@workspace/api/lib/action-result";
import type { ActionError, PriorityScaleLevel } from "@workspace/api/api";

/** A level as a write answers it: the scale's own fields, without the counts. */
type WrittenLevel = Omit<PriorityScaleLevel, "counts">;

/** A project's priority scale, bottom level first. */
export async function getPriorityLevels(
  projectId: number
): Promise<PriorityScaleLevel[] | ActionError> {
  const res = await serverApi.GET("/api/projects/{id}/priorities", {
    params: { path: { id: String(projectId) } },
  });

  return toActionResult(res, "Failed to fetch priority levels");
}

/** Adds a level at the top of the scale. A name the scale already has is a 409. */
export async function createPriorityLevel(
  projectId: number,
  data: { name: string; colour: string }
): Promise<WrittenLevel | ActionError> {
  const res = await serverApi.POST("/api/projects/{id}/priorities", {
    params: { path: { id: String(projectId) } },
    body: data,
  });

  return written(toActionResult(res, "Failed to create priority level"));
}

/**
 * Renames or recolours a level, or makes it the default, which takes the flag
 * off the old one. A name the scale already has is a 409.
 */
export async function updatePriorityLevel(
  projectId: number,
  levelId: number,
  data: { name?: string; colour?: string; isDefault?: true }
): Promise<WrittenLevel | ActionError> {
  const res = await serverApi.PATCH("/api/projects/{id}/priorities/{levelId}", {
    params: { path: { id: String(projectId), levelId: String(levelId) } },
    body: data,
  });

  return written(toActionResult(res, "Failed to update priority level"));
}

/** Puts the scale in the order `ids` gives: every level once, bottom first. */
export async function reorderPriorityLevels(
  projectId: number,
  ids: number[]
): Promise<PriorityScaleLevel[] | ActionError> {
  const res = await serverApi.PUT("/api/projects/{id}/priorities/order", {
    params: { path: { id: String(projectId) } },
    body: { ids },
  });

  return written(toActionResult(res, "Failed to reorder priority levels"));
}

/**
 * Deletes a level, moving its tracks, collections and sessions to
 * `replaceWith`, another level of the same project. The default cannot go.
 */
export async function deletePriorityLevel(
  projectId: number,
  levelId: number,
  replaceWith: number
): Promise<{ ok: true } | ActionError> {
  const res = await serverApi.DELETE(
    "/api/projects/{id}/priorities/{levelId}",
    {
      params: {
        path: { id: String(projectId), levelId: String(levelId) },
        query: { replaceWith },
      },
    }
  );

  return written(
    toActionOutcome(res, "Failed to delete priority level", {
      ok: true,
    } as const)
  );
}
