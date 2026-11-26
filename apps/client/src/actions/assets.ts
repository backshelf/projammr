"use server";

import { serverApi } from "@/lib/server-api";
import { written } from "@/lib/write-action";
import {
  toActionOutcome,
  toActionResult,
} from "@workspace/api/lib/action-result";
import type { ActionError, Asset, AssetsPage } from "@workspace/api/api";

export const attachAssetTo = async (
  assetId: number,
  parentKind: "project" | "collection" | "track" | "session",
  parentId: number
): Promise<Asset | ActionError> => {
  const res = await serverApi.POST(`/api/${parentKind}s/{id}/attachments`, {
    params: { path: { id: String(parentId) } },
    body: { assetId },
  });

  return written(toActionResult(res, "Failed to attach asset"));
};

/** One page of a project's files, `page` 1-based; `q` filters by name, `sort`
 *  is `<id|name|size|createdAt>`. */
export async function getAssetsForProject(
  projectId: number,
  query: { page?: number; q?: string; sort?: string }
): Promise<AssetsPage | ActionError> {
  const res = await serverApi.GET("/api/assets/project/{projectId}", {
    params: {
      path: { projectId: String(projectId) },
      query: { page: query.page, q: query.q, sort: query.sort },
    },
  });

  return toActionResult<AssetsPage>(res, "Failed to fetch assets");
}

export async function deleteAsset(
  id: number
): Promise<{ ok: true } | ActionError> {
  const res = await serverApi.DELETE("/api/assets/{id}", {
    params: { path: { id: String(id) } },
  });

  return written(
    toActionOutcome(res, "Failed to delete asset", { ok: true } as const)
  );
}
