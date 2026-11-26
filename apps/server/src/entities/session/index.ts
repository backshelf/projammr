import { HTTPException } from "hono/http-exception";
import { db } from "../../db/index.js";
import { moveSessionToProject } from "../../db/queries/move.js";
import { sessionImagePathSql } from "../../db/queries/artwork.js";
import {
  assertInProject,
  projectScope,
} from "../../db/queries/authorization.js";
import {
  assertLevelsInProject,
  type DefaultableLevel,
} from "../../db/queries/priority-levels.js";
import { sessionAttachments } from "../../db/schema/attachments.js";
import {
  editSessionSchema,
  type NewSession,
  newSessionSchema,
  sessions,
  sessionSchema,
  type WithSamples,
} from "../../db/schema/sessions.js";
import { tracks } from "../../db/schema/tracks.js";
import { pathId, readBody, unscoped } from "../../middleware/request-refs.js";
import { projectsByTrackId } from "../track/queries.js";
import { defineEntity, defineList, projectIdOfScopedRow } from "../shared.js";
import type { AttachmentJoin, EntityModule } from "../types.js";
import { sessionFilterSchema } from "./filters.js";
import {
  bulkDeleteSessions,
  bulkUpdateSessions,
  createSession,
  deleteSession,
  getSession,
  getSessionRow,
  getSessionsPage,
  getSessionSummaries,
  listSessionSchema,
  projectsBySessionId,
  SESSION_ACTIVITY_IGNORED_FIELDS,
  selectSessionIds,
  sessionDetailSchema,
  sessionGroupColumns,
  sessionQuerySchema,
  sessionSortColumns,
  sessionSummarySchema,
  updateSession,
} from "./queries.js";

const attachments: AttachmentJoin = {
  table: sessionAttachments,
  entityColumn: sessionAttachments.sessionId,
  assetColumn: sessionAttachments.assetId,
  link: async (sessionId, assetId) => {
    const [row] = await db
      .insert(sessionAttachments)
      .values({ sessionId, assetId })
      .onConflictDoNothing()
      .returning();
    return row;
  },
};

/** The rows a session body names, before any of them are looked up. */
type SessionRefs = {
  projects: Set<number>;
  sessionIds: Set<number>;
  trackIds: Set<number>;
};

/**
 * Reads the `projectId` / `sessionId` / `trackId` of every element a session
 * body carries — the body itself, an array of sessions, or the `moves` and
 * `attachments` lists the bulk routes take.
 */
function sessionRefs(body: unknown): SessionRefs {
  const refs: SessionRefs = {
    projects: new Set(),
    sessionIds: new Set(),
    trackIds: new Set(),
  };

  const num = (value: unknown): number | null => {
    if (value == null) return null;
    const n = Number(value);
    return Number.isNaN(n) ? null : n;
  };

  const collect = (item: unknown) => {
    if (typeof item !== "object" || item === null) return;
    const r = item as Record<string, unknown>;
    const project = num(r.projectId);
    if (project != null) refs.projects.add(project);
    const session = num(r.sessionId);
    if (session != null) refs.sessionIds.add(session);
    const track = num(r.trackId);
    if (track != null) refs.trackIds.add(track);
  };

  if (Array.isArray(body)) {
    body.forEach(collect);
  } else if (typeof body === "object" && body !== null) {
    const b = body as Record<string, unknown>;
    collect(b);
    for (const key of ["moves", "attachments"]) {
      if (Array.isArray(b[key])) (b[key] as unknown[]).forEach(collect);
    }
  }

  return refs;
}

/**
 * The project of the earliest row the body names that actually exists, sessions
 * before tracks. One query per table, not per id.
 */
async function projectOfFirstNamedRow(
  refs: SessionRefs
): Promise<number | null> {
  const [bySession, byTrack] = await Promise.all([
    projectsBySessionId([...refs.sessionIds]),
    projectsByTrackId([...refs.trackIds]),
  ]);

  for (const [ids, projects] of [
    [refs.sessionIds, bySession],
    [refs.trackIds, byTrack],
  ] as const) {
    for (const id of ids) {
      const project = projects.get(id);
      if (project != null) return project;
    }
  }

  return null;
}

export const session: EntityModule = defineEntity({
  kind: "session",
  mountPath: "/sessions",
  label: "Session",
  table: sessions,
  projectColumn: sessions.projectId,
  nameColumn: sessions.name,
  labels: "session",
  // The scanner creates sessions from a DAW project on disk; MCP has no
  // `create_session` tool.
  mcpCreate: false,
  priorityLevel: true,
  move: moveSessionToProject,
  attachments,
  commentSearchImagePath: sessionImagePathSql(
    sessions.trackId,
    sessions.projectId
  ),
  activityIgnoredFields: SESSION_ACTIVITY_IGNORED_FIELDS,
  /**
   * `/sessions/:id` and `/sessions/:id/attachments` address a session
   * directly. Everything else names its rows in the body — a `projectId` on a
   * create, and whole arrays of sessions, moves or attachments on the bulk
   * routes.
   *
   * A request may only touch one project, and the caller's own numbers are
   * what that is judged on: a body carrying two different `projectId` values
   * is refused outright. The scanner posts one project per run, so nothing
   * legitimate names two.
   *
   * With no `projectId` of its own, the body is gated on the project of the
   * first row it names that exists — sessions before tracks. Every other id it
   * carries is left to the handler's own scope checks, which answer 404 for a
   * row in another project exactly as they do for one that is not there at
   * all; deciding it here instead would tell a caller that an id they cannot
   * reach exists somewhere. A body that names no row at all is left to its
   * validator, which is what reports a missing `projectId` on a create.
   */
  resolveRoute: async (c) => {
    const id = pathId(c);
    if (id != null) return projectScope(await session.projectIdFor(id));

    const body = await readBody(c);
    if (body == null) return unscoped;

    const refs = sessionRefs(body);
    if (refs.projects.size > 1) {
      throw new HTTPException(400, {
        message: "A request may only touch one project",
      });
    }

    const [named] = refs.projects;
    if (named != null) return { kind: "project", id: named };

    if (refs.sessionIds.size === 0 && refs.trackIds.size === 0) {
      return unscoped;
    }

    return projectScope(await projectOfFirstNamedRow(refs));
  },
  schemas: {
    row: sessionSchema,
    detail: sessionDetailSchema,
    create: newSessionSchema,
    edit: editSessionSchema.partial(),
  },
  load: getSession,
  row: getSessionRow,
  create: (data: WithSamples<DefaultableLevel<NewSession>>) =>
    createSession(data),
  update: (id, patch: WithSamples<Partial<NewSession>>) =>
    updateSession(id, patch),
  remove: deleteSession,
  projectIdOfRow: projectIdOfScopedRow,
  assertWritable: async (body, projectId) => {
    await assertInProject(tracks, [body.trackId], projectId, "Track");
    await assertLevelsInProject([body.priorityId], projectId);
  },
  list: defineList({
    querySchema: sessionQuerySchema,
    filterParams: Object.keys(sessionFilterSchema.shape),
    sortColumns: Object.keys(sessionSortColumns),
    groupColumns: sessionGroupColumns,
    rowSchema: listSessionSchema,
    summarySchema: sessionSummarySchema,
    // A bulk patch writes columns only; the sample rows are per session.
    patchSchema: editSessionSchema.omit({ samples: true }).partial(),
    page: getSessionsPage,
    summaries: getSessionSummaries,
    bulkUpdate: (projectId, selection, patch: Partial<NewSession>, actorId) =>
      bulkUpdateSessions(projectId, selection, patch, actorId),
    bulkDelete: bulkDeleteSessions,
    selectIds: selectSessionIds,
  }),
});
