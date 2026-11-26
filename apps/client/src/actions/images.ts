"use server";

import { serverApi } from "@/lib/server-api";
import { written } from "@/lib/write-action";
import {
  toActionOutcome,
  toActionResult,
} from "@workspace/api/lib/action-result";
import { ActionError, ImagesPage } from "@workspace/api/api";

export type ParentKind = "project" | "collection" | "track";

/** One page of a project's images, `page` 1-based. */
export async function getImagesForProject(
  projectId: number,
  page?: number
): Promise<ImagesPage | ActionError> {
  const res = await serverApi.GET("/api/images/project/{projectId}", {
    params: {
      path: { projectId: String(projectId) },
      query: { page },
    },
  });

  return toActionResult<ImagesPage>(res, "Failed to fetch images");
}

export const setImageOnParent = async (
  imageId: number,
  kind: ParentKind,
  parentId: number
): Promise<{ success: boolean } | ActionError> => {
  const res = await serverApi.PUT("/api/images/parent/{kind}/{parentId}", {
    params: { path: { kind, parentId: String(parentId) } },
    body: { imageId },
  });

  return written(
    toActionOutcome(res, "Failed to set image", { success: true })
  );
};

export const removeImageFromParent = async (
  kind: ParentKind,
  parentId: number
): Promise<{ success: boolean } | ActionError> => {
  const res = await serverApi.DELETE("/api/images/parent/{kind}/{parentId}", {
    params: { path: { kind, parentId: String(parentId) } },
  });

  return written(
    toActionOutcome(res, "Failed to remove image", { success: true })
  );
};
