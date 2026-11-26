import { db } from "../../db/index.js";
import { moveSessionToProject } from "../../db/queries/move.js";
import { sessionImagePathSql } from "../../db/queries/artwork.js";
import { assertInProject } from "../../db/queries/authorization.js";
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

export const session: EntityModule = defineEntity({
  kind: "session",
  mountPath: "/sessions",
  label: "Session",
  table: sessions,
  projectColumn: sessions.projectId,
  nameColumn: sessions.name,
  labels: "session",
  // dit creates sessions from a DAW project on disk; MCP has no
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
