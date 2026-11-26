"use client";

import { browserApi } from "@/lib/browser-api";
import { toActionResult } from "@workspace/api/lib/action-result";
import type {
  ActionError,
  AssetsPage,
  DuplicateAudio,
} from "@workspace/api/api";

/**
 * One page of a project's files, read from the browser — the twin of
 * `getAssetsForProject` (`actions/assets.ts`) for `AssetsTable`'s
 * `serverPage.load`, which runs client-side past the server-rendered first
 * page. `page` 1-based; `q` filters by name, `sort` is
 * `<id|name|size|createdAt>`.
 */
export async function getAssetsPage(
  projectId: number,
  query: { page: number; q?: string; sort?: string }
): Promise<AssetsPage | ActionError> {
  const res = await browserApi.GET("/api/assets/project/{projectId}", {
    params: {
      path: { projectId: String(projectId) },
      query: { page: query.page, q: query.q, sort: query.sort },
    },
  });

  return toActionResult<AssetsPage>(res, "Failed to fetch assets");
}

/** The project's duplicate audio: what an audit would keep, remove and skip. */
export async function getDuplicateAudio(
  projectId: number
): Promise<DuplicateAudio | ActionError> {
  const res = await browserApi.GET(
    "/api/assets/project/{projectId}/duplicates",
    { params: { path: { projectId: String(projectId) } } }
  );

  return toActionResult<DuplicateAudio>(res, "Failed to find duplicate audio");
}
