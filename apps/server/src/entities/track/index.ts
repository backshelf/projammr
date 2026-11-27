import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/index.js";
import {
  withFieldValues,
  withFieldWrites,
} from "../../db/queries/custom-fields.js";
import { moveTrackToProject } from "../../db/queries/move.js";
import { trackImagePathSql } from "../../db/queries/artwork.js";
import { assertStatusUsable } from "../../db/queries/authorization.js";
import { assertLevelsInProject } from "../../db/queries/priority-levels.js";
import { getTrackAudios } from "../../db/queries/track-audios.js";
import { sessionSchema } from "../../db/schema/sessions.js";
import { trackAttachments } from "../../db/schema/attachments.js";
import {
  editTrackSchema,
  type NewTrack,
  newTrackSchema,
  trackAudios,
  tracks,
  trackSchema,
} from "../../db/schema/tracks.js";
import { defineEntity, defineList, projectIdOfScopedRow } from "../shared.js";
import type { AttachmentJoin } from "../types.js";
import { trackFilterSchema } from "./filters.js";
import {
  bulkDeleteTracks,
  bulkUpdateTracks,
  createTrack,
  deleteTrack,
  getTrack,
  getTrackRow,
  getTracksPage,
  getTrackSessions,
  getTrackSummaries,
  listTrackSchema,
  selectTrackIds,
  setTracksArchived,
  trackDetailSchema,
  trackGroupColumns,
  trackQuerySchema,
  trackSortKeys,
  trackSummarySchema,
  type TrackCreate,
  updateTrack,
  updateTrackStatus,
} from "./queries.js";

const attachments: AttachmentJoin = {
  table: trackAttachments,
  entityColumn: trackAttachments.trackId,
  assetColumn: trackAttachments.assetId,
  link: async (trackId, assetId) => {
    const [row] = await db
      .insert(trackAttachments)
      .values({ trackId, assetId })
      .onConflictDoNothing()
      .returning();
    return row;
  },
};

/** An audio file reaches its track through `track_audios`, not an attachment. */
const audios: AttachmentJoin = {
  table: trackAudios,
  entityColumn: trackAudios.trackId,
  assetColumn: trackAudios.assetId,
};

const audioVersionSummarySchema = z.object({
  id: z.number(),
  version: z.number(),
  isPrimary: z.boolean(),
  asset: z.object({ name: z.string() }),
  durationMs: z.number().nullable(),
});

/**
 * A session as `get_track` lists it for an MCP caller: enough to identify
 * and pick between a track's sessions, without its `notes` or
 * `structure` — `get_session` carries those for whichever session the
 * caller settles on.
 */
const trackMcpSessionSummarySchema = sessionSchema.pick({
  id: true,
  name: true,
  main: true,
  daw: true,
  tempo: true,
  timeSignature: true,
  rootNote: true,
  scale: true,
  localFilepath: true,
  localFileUpdatedAt: true,
  updatedAt: true,
});

const trackMcpDetailSchema = trackDetailSchema.omit({ sessions: true }).extend({
  sessions: z.array(trackMcpSessionSummarySchema),
  audioVersions: z.array(audioVersionSummarySchema),
});

export const track = defineEntity({
  kind: "track",
  mountPath: "/tracks",
  label: "Track",
  table: tracks,
  projectColumn: tracks.projectId,
  nameColumn: tracks.title,
  image: {
    set: async (id, assetPath) => {
      const [row] = await db
        .update(tracks)
        .set({ image: assetPath })
        .where(eq(tracks.id, id))
        .returning({ id: tracks.id });
      return row != null;
    },
  },
  labels: "track",
  customFields: "track",
  status: { set: (id, statusId) => updateTrackStatus(id, { statusId }) },
  priorityLevel: true,
  relationFilter: true,
  move: moveTrackToProject,
  archive: { set: setTracksArchived },
  attachments,
  assetSources: [attachments, audios],
  commentSearchImagePath: trackImagePathSql(
    tracks.image,
    tracks.id,
    tracks.projectId
  ),
  schemas: {
    row: withFieldValues(trackSchema).partial({ fields: true }),
    detail: trackDetailSchema,
    create: withFieldWrites(newTrackSchema),
    edit: withFieldWrites(editTrackSchema.partial()),
  },
  load: getTrack,
  row: getTrackRow,
  // `artists` is a jsonb array, so its members arrive as whatever JSON held.
  create: (data: TrackCreate) =>
    createTrack({ ...data, artists: data.artists?.map(String) }),
  update: (id, patch: Partial<NewTrack>) => updateTrack(id, patch),
  remove: deleteTrack,
  projectIdOfRow: projectIdOfScopedRow,
  assertWritable: async (body, projectId) => {
    await assertStatusUsable(body.statusId, projectId);
    await assertLevelsInProject([body.priorityId], projectId);
  },
  list: defineList({
    querySchema: trackQuerySchema,
    filterParams: Object.keys(trackFilterSchema.shape),
    sortColumns: trackSortKeys,
    groupColumns: trackGroupColumns,
    rowSchema: listTrackSchema,
    summarySchema: trackSummarySchema,
    patchSchema: withFieldWrites(editTrackSchema.partial()),
    page: getTracksPage,
    summaries: getTrackSummaries,
    bulkUpdate: (projectId, selection, patch: Partial<NewTrack>, actorId) =>
      bulkUpdateTracks(projectId, selection, patch, actorId),
    bulkDelete: bulkDeleteTracks,
    selectIds: selectTrackIds,
  }),
  mcpDetail: {
    schema: trackMcpDetailSchema,
    replaces: ["sessions"],
    read: async (id) => {
      const [audios, sessions] = await Promise.all([
        getTrackAudios(id),
        getTrackSessions(id),
      ]);
      return {
        audioVersions: audios.map((audio) => ({
          id: audio.id,
          version: audio.version,
          isPrimary: audio.isPrimary,
          asset: { name: audio.asset.name },
          durationMs: audio.durationMs,
        })),
        sessions: sessions.map((session) => ({
          id: session.id,
          name: session.name,
          main: session.main,
          daw: session.daw,
          tempo: session.tempo,
          timeSignature: session.timeSignature,
          rootNote: session.rootNote,
          scale: session.scale,
          localFilepath: session.localFilepath,
          localFileUpdatedAt: session.localFileUpdatedAt,
          updatedAt: session.updatedAt,
        })),
      };
    },
    description:
      "One track's detail: relations, labels, artwork and the rest of what the app shows for it. " +
      "Sessions are summaries (no sample paths or set structure) — use get_session for those.",
  },
});
