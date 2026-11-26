"use server";

import { serverApi } from "@/lib/server-api";
import { written } from "@/lib/write-action";
import {
  toActionOutcome,
  toActionResult,
} from "@workspace/api/lib/action-result";
import {
  ActionError,
  RankedRelationType,
  RelationTypeEntry,
} from "@workspace/api/api";

/** A project's relation types, in list order, each with its usage count. */
export async function getRelationTypes(
  projectId: number
): Promise<RelationTypeEntry[] | ActionError> {
  const res = await serverApi.GET("/api/projects/{id}/relation-types", {
    params: { path: { id: String(projectId) } },
  });

  return toActionResult(res, "Failed to fetch relation types");
}

/** Adds a type at the end of the project's list. A name it already has is a 409. */
export async function createRelationType(
  projectId: number,
  name: string
): Promise<RankedRelationType | ActionError> {
  const res = await serverApi.POST("/api/projects/{id}/relation-types", {
    params: { path: { id: String(projectId) } },
    body: { name },
  });

  return written(toActionResult(res, "Failed to create relation type"));
}

/** Renames a type. A name another type of the list has is a 409. */
export async function renameRelationType(
  projectId: number,
  typeId: number,
  name: string
): Promise<RankedRelationType | ActionError> {
  const res = await serverApi.PATCH(
    "/api/projects/{id}/relation-types/{typeId}",
    {
      params: { path: { id: String(projectId), typeId: String(typeId) } },
      body: { name },
    }
  );

  return written(toActionResult(res, "Failed to rename relation type"));
}

/** Puts the project's types in the order `ids` names, first first. */
export async function reorderRelationTypes(
  projectId: number,
  ids: number[]
): Promise<RelationTypeEntry[] | ActionError> {
  const res = await serverApi.PUT("/api/projects/{id}/relation-types/order", {
    params: { path: { id: String(projectId) } },
    body: { ids },
  });

  return written(toActionResult(res, "Failed to reorder relation types"));
}

/**
 * Deletes a type no relation uses. While any does, the server refuses with a
 * 409 carrying `details.inUse`.
 */
export async function deleteRelationType(
  projectId: number,
  typeId: number
): Promise<{ ok: true } | ActionError> {
  const res = await serverApi.DELETE(
    "/api/projects/{id}/relation-types/{typeId}",
    {
      params: { path: { id: String(projectId), typeId: String(typeId) } },
    }
  );

  return written(
    toActionOutcome(res, "Failed to delete relation type", {
      ok: true,
    } as const)
  );
}
