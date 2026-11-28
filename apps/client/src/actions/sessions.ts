"use server";

import type { TableQuery } from "@/actions/projects";
import { isDawId } from "@/lib/daw";
import { serverApi } from "@/lib/server-api";
import { myMachines } from "@/lib/shared-reads";
import { written } from "@/lib/write-action";
import {
  isActionError,
  toActionResult,
} from "@workspace/api/lib/action-result";
import {
  ActionError,
  GetSession,
  Machine,
  MachinePresence,
  NewSession,
  Session,
  SessionCommit,
  SessionSave,
  SessionsPage,
  SessionsPageQuery,
  SessionSummary,
} from "@workspace/api/api";

/**
 * The DAW filter arrives as a raw query-string value; the server rejects
 * anything that isn't a well-formed module id, so a malformed one is dropped
 * before it reaches the request rather than turning into a 400.
 */
const dawFilter = (daw: string | undefined): string | undefined =>
  daw != null && isDawId(daw) ? daw : undefined;

export const getSessionsPageForProject = async (
  projectId: number,
  query: TableQuery & {
    daw?: string;
    track?: number;
    inDit?: string;
    unassigned?: string;
    archived?: SessionsPageQuery["archived"];
  }
): Promise<SessionsPage | ActionError> => {
  const res = await serverApi.GET("/api/projects/{id}/sessions/paginated", {
    params: {
      path: { id: String(projectId) },
      query: {
        page: query.page,
        pageSize: query.pageSize,
        sort: query.sort,
        q: query.q,
        groupBy: query.groupBy,
        priority: query.priority,
        daw: dawFilter(query.daw),
        track: query.track,
        inDit: query.inDit,
        unassigned: query.unassigned,
        archived: query.archived,
      },
    },
  });

  return toActionResult(res, "Failed to fetch sessions");
};

export const getSession = async (
  id: number
): Promise<GetSession | ActionError> => {
  const res = await serverApi.GET("/api/sessions/{id}", {
    params: { path: { id: String(id) } },
  });

  return toActionResult(res, "Failed to fetch session");
};

export const createSession = async (
  data: NewSession
): Promise<Session | ActionError> => {
  const res = await serverApi.POST("/api/sessions", { body: data });

  return written(toActionResult(res, "Failed to create session"));
};

export const setSessionMain = async (
  sessionId: number,
  main: boolean
): Promise<Session | ActionError> => {
  const res = await serverApi.PATCH("/api/sessions/{id}", {
    params: { path: { id: String(sessionId) } },
    body: { main },
  });

  return written(toActionResult(res, "Failed to update session"));
};

export const assignSessionToTrack = async (
  sessionId: number,
  trackId: number
): Promise<Session | ActionError> => {
  const res = await serverApi.PATCH("/api/sessions/{id}", {
    params: { path: { id: String(sessionId) } },
    body: { trackId },
  });

  return written(toActionResult(res, "Failed to assign session to track"));
};

/**
 * A session's save history — one row per recorded save, newest
 * first. `limit` defaults to the route's own default (100) when omitted.
 */
export const getSessionSaves = async (
  sessionId: number,
  limit?: number
): Promise<SessionSave[] | ActionError> => {
  const res = await serverApi.GET("/api/sessions/{id}/saves", {
    params: { path: { id: String(sessionId) }, query: { limit } },
  });

  return toActionResult(res, "Failed to fetch session saves");
};

/**
 * A session's dit commits on one branch, newest first, each with the saves it
 * covers. `limit` takes the route's default (100) when omitted and up to 500.
 */
export const getSessionCommits = async (
  sessionId: number,
  options: { branch?: string; limit?: number } = {}
): Promise<SessionCommit[] | ActionError> => {
  const res = await serverApi.GET("/api/sessions/{id}/commits", {
    params: {
      path: { id: String(sessionId) },
      query: { branch: options.branch, limit: options.limit },
    },
  });

  return toActionResult(res, "Failed to fetch session commits");
};

/**
 * Every session in the project as an id, name, DAW and track, most recently
 * updated first. The sidebar's recently-edited list reads this rather than the
 * paginated list, which hydrates each session with its track, attachments and
 * comments.
 */
export const getSessionSummaries = async (
  projectId: number
): Promise<SessionSummary[] | ActionError> => {
  const res = await serverApi.GET("/api/projects/{id}/sessions/summary", {
    params: { path: { id: String(projectId) } },
  });

  return toActionResult(res, "Failed to fetch sessions");
};

/**
 * Which of the caller's online machines track this session's repo, and which
 * one has it open. A failed read folds to no machines: the page then offers no
 * dit-backed action rather than failing.
 */
export const getSessionPresence = async (
  sessionId: number
): Promise<MachinePresence[]> => {
  const res = await serverApi.GET("/api/sessions/{id}/presence", {
    params: { path: { id: String(sessionId) } },
  });

  const result = await toActionResult<{ machines: MachinePresence[] }>(
    res,
    "Failed to fetch session presence"
  );
  return isActionError(result) ? [] : result.machines;
};

/** The caller's machines, online or not, with the repos each one has pushed; a failed read folds to none. */
export const getMachines = async (): Promise<Machine[]> => {
  const result = await myMachines(serverApi);
  return isActionError(result) ? [] : result.machines;
};
