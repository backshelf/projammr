"use server";

import { serverApi } from "@/lib/server-api";
import { myHeatmap, myProjects } from "@/lib/shared-reads";
import { toActionResult } from "@workspace/api/lib/action-result";
import { ActionError, Me, MyProject, UserHeatmapDay } from "@workspace/api/api";

export const getMyProjects = async (): Promise<MyProject[] | ActionError> =>
  myProjects(serverApi);

export async function getMe(): Promise<Me | ActionError> {
  const res = await serverApi.GET("/api/me");

  return toActionResult(res, "Failed to fetch your account");
}

/** The signed-in user's save activity across their projects over `[from, to)`. */
export const getMyHeatmap = async (range: {
  from: number;
  to: number;
  tz: string;
}): Promise<UserHeatmapDay[] | ActionError> => myHeatmap(serverApi, range);
