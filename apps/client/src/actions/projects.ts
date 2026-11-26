"use server";

import { setProjectCookie } from "@/actions/cookie";
import type { CustomFieldParams } from "@/fields/custom-field";
import { serverApi } from "@/lib/server-api";
import { projectHeatmap } from "@/lib/shared-reads";
import { customFieldFilters } from "@/lib/table-params";
import {
  isActionError,
  toActionOutcome,
  toActionResult,
} from "@workspace/api/lib/action-result";
import {
  ActionError,
  CollectionsPage,
  CollectionSummary,
  HeatmapDay,
  NewProject,
  PluginSession,
  PluginUsage,
  Project,
  ProjectToday,
  SampleSession,
  SampleUsage,
  SessionDaw,
} from "@workspace/api/api";
import { cookies } from "next/headers";

/**
 * Query params for the paginated project list endpoints. `sort` is
 * `<column>.<asc|desc>`; the server whitelists the column ids.
 */
export type TableQuery = {
  page?: number;
  pageSize?: number;
  sort?: string;
  q?: string;
  /** A whitelisted grouping key (`status`, `priority`, `daw`, `track`). */
  groupBy?: string;
  /** Priority level ids, comma-separated: rows holding any of them. */
  priority?: string;
};

export const createProject = async (
  newProject: NewProject
): Promise<Project | ActionError> => {
  const res = await serverApi.POST("/api/projects", { body: newProject });

  return toActionResult(res, "Failed to create project");
};

/**
 * Deletes a project. Clears the `currentProject` cookie when it named the
 * deleted project, mirroring `leaveProject` (`actions/members.ts`) — the
 * caller's own next visit to `/` should never read a cookie the deletion just
 * invalidated.
 */
export const deleteProject = async (
  projectId: number
): Promise<{ deleted: true } | ActionError> => {
  const res = await serverApi.DELETE("/api/projects/{id}", {
    params: { path: { id: String(projectId) } },
  });

  const outcome = await toActionOutcome(res, "Failed to delete project", {
    deleted: true,
  } as const);
  if (isActionError(outcome)) return outcome;

  const cookieStore = await cookies();
  if (cookieStore.get("currentProject")?.value === String(projectId)) {
    await setProjectCookie(undefined);
  }
  return outcome;
};

export const getCollectionsPageForProject = async (
  projectId: number,
  query: TableQuery & CustomFieldParams & { status?: number }
): Promise<CollectionsPage | ActionError> => {
  const res = await serverApi.GET("/api/projects/{id}/collections/paginated", {
    params: {
      path: { id: String(projectId) },
      query: {
        page: query.page,
        pageSize: query.pageSize,
        sort: query.sort,
        q: query.q,
        groupBy: query.groupBy,
        status: query.status,
        priority: query.priority,
        ...customFieldFilters(query),
      },
    },
  });

  return toActionResult(res, "Failed to fetch collections");
};

export const getProject = async (
  projectId: number
): Promise<Project | ActionError> => {
  const res = await serverApi.GET("/api/projects/{id}", {
    params: { path: { id: String(projectId) } },
  });

  return toActionResult(res, "Failed to fetch project");
};

/**
 * Every collection in the project as an id, title, artwork and track count.
 * The sidebar and the pickers read this rather than the paginated list, which
 * hydrates each collection with its full track list, comments and attachments.
 */
export const getCollectionSummaries = async (
  projectId: number
): Promise<CollectionSummary[] | ActionError> => {
  const res = await serverApi.GET("/api/projects/{id}/collections/summary", {
    params: { path: { id: String(projectId) } },
  });

  return toActionResult(res, "Failed to fetch collections");
};

/**
 * Every device and plugin named by a session's parsed structure in the
 * project, most widely used first. Sessions scanned before the parser read
 * device chains contribute nothing.
 */
export const getProjectPlugins = async (
  projectId: number
): Promise<PluginUsage[] | ActionError> => {
  const res = await serverApi.GET("/api/projects/{id}/plugins", {
    params: { path: { id: String(projectId) } },
  });

  return toActionResult(res, "Failed to fetch plugins");
};

/**
 * Every session in the project whose structure carries a given device, most
 * recently saved first. A device no session carries any more (a stale link
 * from a renamed or removed plugin) answers an empty list rather than an
 * error.
 */
export const getPluginSessions = async (
  projectId: number,
  device: string
): Promise<PluginSession[] | ActionError> => {
  const res = await serverApi.GET("/api/projects/{id}/plugins/sessions", {
    params: {
      path: { id: String(projectId) },
      query: { device },
    },
  });

  return toActionResult(res, "Failed to fetch sessions for this device");
};

/**
 * Every audio file the project's sessions reference, most widely used first,
 * with whether the file is missing on disk.
 */
export const getProjectSamples = async (
  projectId: number
): Promise<SampleUsage[] | ActionError> => {
  const res = await serverApi.GET("/api/projects/{id}/samples", {
    params: { path: { id: String(projectId) } },
  });

  return toActionResult(res, "Failed to fetch samples");
};

/**
 * Every session in the project that references a given sample, most recently
 * saved first. A path no session references any more answers an empty list
 * rather than an error. The path goes to `openapi-fetch` raw, which encodes it
 * once.
 */
export const getSampleSessions = async (
  projectId: number,
  path: string
): Promise<SampleSession[] | ActionError> => {
  const res = await serverApi.GET("/api/projects/{id}/samples/sessions", {
    params: {
      path: { id: String(projectId) },
      query: { path },
    },
  });

  return toActionResult(res, "Failed to fetch sessions for this sample");
};

/**
 * Every DAW a project's sessions are tagged with, for the sessions table's
 * DAW filter and the manual session form's suggestions.
 */
export const getSessionDaws = async (
  projectId: number
): Promise<SessionDaw[] | ActionError> => {
  const res = await serverApi.GET("/api/projects/{id}/sessions/daws", {
    params: { path: { id: String(projectId) } },
  });

  return toActionResult(res, "Failed to fetch DAWs");
};

/**
 * Every artist credited on a project's tracks, most credited first, for a
 * track's artist picker.
 */
export const getProjectArtists = async (
  projectId: number
): Promise<string[] | ActionError> => {
  const res = await serverApi.GET("/api/projects/{id}/tracks/artists", {
    params: { path: { id: String(projectId) } },
  });

  return toActionResult(res, "Failed to fetch artists");
};

/**
 * What a project's home page reads: the renders and saves of the last day and
 * the tracks gone quiet.
 */
export const getProjectToday = async (
  projectId: number
): Promise<ProjectToday | ActionError> => {
  const res = await serverApi.GET("/api/projects/{id}/today", {
    params: { path: { id: String(projectId) } },
  });

  return toActionResult(res, "Failed to fetch today");
};

/** A project's save activity over `[from, to)`, unfiltered. */
export const getProjectHeatmap = async (
  projectId: number,
  range: { from: number; to: number; tz: string }
): Promise<HeatmapDay[] | ActionError> =>
  projectHeatmap(serverApi, projectId, range);
