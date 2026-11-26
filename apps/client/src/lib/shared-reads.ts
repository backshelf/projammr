import { toActionResult } from "@workspace/api/lib/action-result";
import type { ActionError } from "@workspace/api/lib/action-result";
import type { ApiClient } from "@workspace/api/lib/authed-client";
import type {
  HeatmapDay,
  MachineList,
  MyProject,
  UserHeatmapDay,
} from "@workspace/api/api";

/*
 * Reads that genuinely have callers on both transports — a server-rendered
 * page and an interactive component both need the same request. Defined once
 * here, taking the `ApiClient` as an argument, and bound by each transport's
 * own wrapper (`actions/me.ts` and `actions/projects.ts` over `serverApi`,
 * `lib/client-api.ts` over `browserApi`). A read with callers on only one
 * transport stays a wrapper in that transport's own file.
 */

/**
 * The signed-in user's machines, each with the set open on it, the repos it
 * has pushed and its "Never here" folders, and the "Not a bounce" files they
 * all share.
 */
export const myMachines = async (
  api: ApiClient
): Promise<MachineList | ActionError> => {
  const res = await api.GET("/api/machines");

  return toActionResult(res, "Failed to load your machines");
};

export type HeatmapFilters = {
  trackId?: number;
  collectionId?: number;
  labelId?: number;
  daw?: string;
};

/** The projects the signed-in user belongs to. */
export const myProjects = async (
  api: ApiClient
): Promise<MyProject[] | ActionError> => {
  const res = await api.GET("/api/me/projects");

  return toActionResult(res, "Failed to load projects");
};

/** The signed-in user's save activity across their projects over `[from, to)`. */
export const myHeatmap = async (
  api: ApiClient,
  query: { from: number; to: number; tz: string }
): Promise<UserHeatmapDay[] | ActionError> => {
  const res = await api.GET("/api/me/heatmap", { params: { query } });

  return toActionResult(res, "Failed to load heatmap");
};

/**
 * A project's save-activity grid over `[from, to)`. Filters combine (all
 * optional) — the project page exposes collection/label/DAW, the track rail
 * pins `trackId`.
 */
export const projectHeatmap = async (
  api: ApiClient,
  projectId: number,
  query: { from: number; to: number; tz: string },
  filters: HeatmapFilters = {}
): Promise<HeatmapDay[] | ActionError> => {
  const res = await api.GET("/api/projects/{id}/heatmap", {
    params: {
      path: { id: String(projectId) },
      query: { ...query, ...filters },
    },
  });

  return toActionResult(res, "Failed to load heatmap");
};
