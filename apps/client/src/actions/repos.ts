"use server";

import { serverApi } from "@/lib/server-api";
import type { ActionError, Repo } from "@workspace/api/api";
import { written } from "@/lib/write-action";
import { toActionResult } from "@workspace/api/lib/action-result";

export async function getRepo(repoId: number): Promise<Repo | ActionError> {
  const res = await serverApi.GET("/api/repos/{id}", {
    params: { path: { id: String(repoId) } },
  });

  return toActionResult(res, "Failed to read the repository");
}

export async function getProjectRepos(
  projectId: number
): Promise<Repo[] | ActionError> {
  const res = await serverApi.GET("/api/projects/{id}/repos", {
    params: { path: { id: String(projectId) } },
  });

  return toActionResult(res, "Failed to read the project's repositories");
}

export async function getTrackRepos(
  trackId: number
): Promise<Repo[] | ActionError> {
  const res = await serverApi.GET("/api/tracks/{id}/repos", {
    params: { path: { id: String(trackId) } },
  });

  return toActionResult(res, "Failed to read the track's repositories");
}

export async function getCollectionRepos(
  collectionId: number
): Promise<Repo[] | ActionError> {
  const res = await serverApi.GET("/api/collections/{id}/repos", {
    params: { path: { id: String(collectionId) } },
  });

  return toActionResult(res, "Failed to read the collection's repositories");
}

export async function setRepoPushSamples(
  repoId: number,
  pushSamples: boolean
): Promise<Repo | ActionError> {
  const res = await serverApi.PATCH("/api/repos/{id}", {
    params: { path: { id: String(repoId) } },
    body: { pushSamples },
  });

  return written(toActionResult(res, "Failed to update the repository"));
}
