import { type Context, Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import type { AuthedEnv } from "../../auth.js";
import {
  activityWithUserSchema,
  recordActivity,
} from "../../db/queries/activity.js";
import {
  activityQuerySchema,
  getProjectActivity,
} from "../../db/queries/activity-feed.js";
import {
  changeMembership,
  getProjectMembers,
  projectMemberSchema,
  transferOwnership,
  updateMemberRoleSchema,
} from "../../db/queries/authorization.js";
import {
  getProjectSaves,
  getSaveHeatmap,
  heatmapDaySchema,
  projectSaveSchema,
} from "../../db/queries/saves.js";
import {
  createInvite,
  createInviteSchema,
  inviteWithInviterSchema,
  listInvites,
} from "../../db/queries/invites.js";
import { clearFailedJobs, getProjectJobs } from "../../db/queries/jobs.js";
import { bulkDeletedSchema } from "../../db/queries/pagination.js";
import {
  createPriorityLevel,
  deletePriorityLevel,
  deletePriorityLevelQuerySchema,
  getPriorityLevels,
  newPriorityLevelSchema,
  priorityOrderSchema,
  reorderPriorityLevels,
  scaleEntrySchema,
  updatePriorityLevel,
  updatePriorityLevelSchema,
} from "../../db/queries/priority-levels.js";
import {
  createLabel,
  deleteLabel,
  getLabelsInProject,
  newLabelSchema,
  updateLabel,
  updateLabelSchema,
} from "../../db/queries/labels.js";
import {
  createSavedView,
  deleteSavedView,
  editSavedViewSchema,
  getSavedViews,
  newSavedViewSchema,
  savedViewKindSchema,
  savedViewSchema,
  savedViewWithOwnerSchema,
  updateSavedView,
} from "../../db/queries/saved-views.js";
import {
  ALL_SEARCH_TYPES,
  DEFAULT_SEARCH_LIMIT,
  MAX_SEARCH_LIMIT,
  MAX_SEARCH_QUERY_LENGTH,
  searchProject,
  searchResultSchema,
  type SearchType,
} from "../../db/queries/search.js";
import {
  getProjectSamples,
  getSessionsBySample,
  sampleSessionSchema,
  sampleUsageSchema,
} from "../../db/queries/session-samples.js";
import { getStatusesInProject } from "../../db/queries/statuses.js";
import {
  projectScope,
  repoBytes,
  reportFor,
} from "../../db/queries/storage-usage.js";
import { enqueueAudioBackfill } from "../../db/queries/track-audios.js";
import {
  createRelationType,
  deleteRelationType,
  getRelationTypes,
  relationTypeEntrySchema,
  relationTypeNameSchema,
  relationTypeOrderSchema,
  renameRelationType,
  reorderRelationTypes,
} from "../../db/queries/track-relation-types.js";
import { rawJobStatusEnum } from "../../db/schema/enums.js";
import { dawIdSchema } from "../../db/schema/sessions.js";
import {
  type DescribedJob,
  jobSchema,
  queuedJobSchema,
} from "../../db/schema/jobs.js";
import { labelSchema } from "../../db/schema/labels.js";
import { scaleLevelSchema } from "../../db/schema/priority-levels.js";
import { rankedRelationTypeSchema } from "../../db/schema/track-relation-types.js";
import { statusSchema } from "../../db/schema/statuses.js";
import { projectStorageReportSchema } from "../../db/schema/storage-usage.js";
import { IDLE_TIMEOUT_SECONDS, shutdownSignal } from "../../lib/connections.js";
import {
  describer,
  idParam,
  idParams,
  idValue,
  params,
  respond,
  validator,
} from "../../lib/http.js";
import customFieldRoutes from "../../routes/custom-fields.js";
import { subscribeProject } from "../../lib/job-events.js";
import { isSupportedTimeZone } from "../../lib/timezone.js";
import { gatedRole } from "../../middleware/authorize-project.js";
import { rateLimit } from "../../middleware/rate-limit.js";
import {
  ditCandidateSchema,
  getDitCandidates,
  getProjectPlugins,
  getSessionDaws,
  getSessionsByDevice,
  getSessionsInProject,
  pluginSessionSchema,
  pluginUsageSchema,
  projectSessionSchema,
  sessionDawSchema,
} from "../session/queries.js";
import { entityTag } from "../shared.js";
import { getProjectArtists } from "../track/queries.js";
import { project } from "./index.js";
import { getProjectToday, projectTodaySchema } from "./queries.js";

const { describe, describeRaw } = describer(entityTag(project));

const app = new Hono<AuthedEnv>();

const searchResultsSchema = z.array(searchResultSchema);
const activitySchema = z.array(activityWithUserSchema);
const statusesSchema = z.array(statusSchema);
const labelsSchema = z.array(labelSchema);
const scaleEntriesSchema = z.array(scaleEntrySchema);
const relationTypeEntriesSchema = z.array(relationTypeEntrySchema);
const jobsSchema = z.array(jobSchema);
const projectSessionsSchema = z.array(projectSessionSchema);
const membersSchema = z.array(projectMemberSchema);
const memberResultSchema = projectMemberSchema.partial();
const invitesSchema = z.array(inviteWithInviterSchema);
const inviteResultSchema = inviteWithInviterSchema.partial();
const savedViewsSchema = z.array(savedViewWithOwnerSchema);

/** The caller a saved-view query acts for: whose views, at what rank. */
function savedViewActor(c: Context<AuthedEnv>) {
  return { id: c.get("user").id, role: gatedRole(c) };
}

/** A member is keyed by the better-auth user id, which is not an integer. */
const memberParams = params({ id: idValue, userId: z.string().min(1) });
const transferOwnershipSchema = z.object({ userId: z.string().min(1) });

const searchQuerySchema = z.object({
  q: z.string().trim().max(MAX_SEARCH_QUERY_LENGTH).default(""),
  types: z
    .string()
    .optional()
    .transform((raw): SearchType[] => {
      if (!raw) return ALL_SEARCH_TYPES;
      return raw
        .split(",")
        .map((t) => t.trim())
        .filter((t): t is SearchType =>
          (ALL_SEARCH_TYPES as string[]).includes(t)
        );
    }),
  // A caller asking for more than the search gives (the palette's result cap
  // is the viewer's to set) gets the most it gives, not an error.
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .default(DEFAULT_SEARCH_LIMIT)
    .transform((limit) => Math.min(limit, MAX_SEARCH_LIMIT)),
});

app.get(
  "/:id/search",
  describe(
    "Search a project. Matches tracks, collections, sessions and assets, " +
      "plus comments (surfaced as their parent entity). Ranked by trigram " +
      "similarity with title/recency boosts.",
    {
      schema: searchResultsSchema,
      description: "Search results fetched successfully",
    },
    400
  ),
  idParam(),
  validator("query", searchQuerySchema),
  async (c) => {
    const { q, types, limit } = c.req.valid("query");
    if (!q) return respond(c, searchResultsSchema, []);
    return respond(
      c,
      searchResultsSchema,
      await searchProject(c.req.valid("param").id, q, types, limit)
    );
  }
);

const heatmapSchema = z.array(heatmapDaySchema);

/** The saves filters shared by the heatmap and the project's saves feed. */
const saveFiltersQuerySchema = z.object({
  trackId: z.coerce.number().int().positive().optional(),
  collectionId: z.coerce.number().int().positive().optional(),
  labelId: z.coerce.number().int().positive().optional(),
  daw: dawIdSchema.optional(),
});

const heatmapQuerySchema = saveFiltersQuerySchema.extend({
  from: z.coerce.number().int(),
  to: z.coerce.number().int(),
  tz: z.string().default("UTC"),
});

app.get(
  "/:id/heatmap",
  describe(
    "Session-save activity in a project, by day. Bucketed by local " +
      "calendar day in the caller's IANA time zone. `from`/`to` are epoch " +
      "milliseconds. `trackId`, `collectionId`, `labelId` and `daw` each " +
      "narrow which sessions are counted, and combine.",
    { schema: heatmapSchema, description: "Heatmap fetched successfully" },
    400
  ),
  idParam(),
  validator("query", heatmapQuerySchema),
  async (c) => {
    const { from, to, tz, ...filters } = c.req.valid("query");
    if (!isSupportedTimeZone(tz)) {
      throw new HTTPException(400, { message: `Unknown time zone: ${tz}` });
    }

    const rows = await getSaveHeatmap(
      { kind: "project", projectId: c.req.valid("param").id, ...filters },
      { from: new Date(from), to: new Date(to), tz }
    );

    return respond(c, heatmapSchema, rows);
  }
);

const DEFAULT_PROJECT_SAVES_LIMIT = 10;
const MAX_PROJECT_SAVES_LIMIT = 100;

const projectSavesSchema = z.array(projectSaveSchema);

const projectSavesQuerySchema = saveFiltersQuerySchema.extend({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_PROJECT_SAVES_LIMIT)
    .default(DEFAULT_PROJECT_SAVES_LIMIT),
  day: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "day must be YYYY-MM-DD")
    .optional(),
  tz: z.string().default("UTC"),
});

app.get(
  "/:id/saves",
  describe(
    "A project's saves, newest first. Each carries the previous save's " +
      "metadata so a client can word the change without a second round " +
      "trip. `day` (`YYYY-MM-DD`, read in `tz`) narrows to one local " +
      "calendar day; without it, the answer is simply the most recent " +
      "saves. `trackId`, `collectionId`, `labelId` and `daw` narrow which " +
      "sessions are counted, matching the heatmap.",
    {
      schema: projectSavesSchema,
      description: "Saves fetched successfully",
    },
    400
  ),
  idParam(),
  validator("query", projectSavesQuerySchema),
  async (c) => {
    const { limit, day, tz, ...filters } = c.req.valid("query");
    if (!isSupportedTimeZone(tz)) {
      throw new HTTPException(400, { message: `Unknown time zone: ${tz}` });
    }

    const { saves } = await getProjectSaves(c.req.valid("param").id, {
      limit,
      day,
      tz,
      ...filters,
    });

    return respond(c, projectSavesSchema, saves);
  }
);

const sessionDawsSchema = z.array(sessionDawSchema);

app.get(
  "/:id/sessions/daws",
  describe(
    "Every DAW the project's sessions are tagged with: dit's DAW module id " +
      "and, where known, its display name. Feeds the sessions table's DAW " +
      "filter and the manual session form's suggestions.",
    { schema: sessionDawsSchema, description: "DAWs fetched successfully" },
    400
  ),
  idParam(),
  async (c) =>
    respond(c, sessionDawsSchema, await getSessionDaws(c.req.valid("param").id))
);

const ditCandidatesSchema = z.object({ sessions: z.array(ditCandidateSchema) });

app.get(
  "/:id/sessions/dit-candidates",
  describe(
    "List the sessions a dit set on disk can be bound to. These are the " +
      "project's Ableton sessions that no dit repo holds, each with its " +
      "track, the path and machine it was last scanned at, every " +
      "fingerprint it has recorded and its newest save's time. The dit " +
      "backfill matches the sets it finds against these before it binds " +
      "one to a session.",
    {
      schema: ditCandidatesSchema,
      description: "Candidates fetched successfully",
    },
    400
  ),
  idParam(),
  async (c) =>
    respond(c, ditCandidatesSchema, {
      sessions: await getDitCandidates(c.req.valid("param").id),
    })
);

const projectArtistsSchema = z.array(z.string());

app.get(
  "/:id/tracks/artists",
  describe(
    "Every artist credited on the project's tracks. Archived tracks " +
      "count too, and the most credited come first. Feeds a track's " +
      "artist picker.",
    {
      schema: projectArtistsSchema,
      description: "Artists fetched successfully",
    },
    400
  ),
  idParam(),
  async (c) =>
    respond(
      c,
      projectArtistsSchema,
      await getProjectArtists(c.req.valid("param").id)
    )
);

app.get(
  "/:id/today",
  describe(
    "What landed in the last day and what has gone quiet. Renders " +
      "linked and saves made in the last 24 hours, newest first, and the " +
      "live tracks untouched for 30 days with their total. Feeds the " +
      "project home page.",
    { schema: projectTodaySchema, description: "Today fetched successfully" },
    400
  ),
  idParam(),
  async (c) =>
    respond(
      c,
      projectTodaySchema,
      await getProjectToday(c.req.valid("param").id)
    )
);

const pluginsSchema = z.array(pluginUsageSchema);

app.get(
  "/:id/plugins",
  describe(
    "Every device and plugin a project's sessions use. Named by a " +
      "session's structure, most widely used first. A DAW's own built-in devices are " +
      "counted alongside third-party plugins.",
    { schema: pluginsSchema, description: "Plugins fetched successfully" },
    400
  ),
  idParam(),
  async (c) =>
    respond(c, pluginsSchema, await getProjectPlugins(c.req.valid("param").id))
);

const pluginSessionsSchema = z.array(pluginSessionSchema);

const pluginSessionsQuerySchema = z.object({
  device: z.string().min(1),
});

app.get(
  "/:id/plugins/sessions",
  describe(
    "The sessions in a project that use one device. Every session whose " +
      "structure names it, most recently saved first, with the tracks that " +
      "carry it. A device no " +
      "session carries answers an empty list rather than 404.",
    {
      schema: pluginSessionsSchema,
      description: "Sessions fetched successfully",
    },
    400
  ),
  idParam(),
  validator("query", pluginSessionsQuerySchema),
  async (c) =>
    respond(
      c,
      pluginSessionsSchema,
      await getSessionsByDevice(
        c.req.valid("param").id,
        c.req.valid("query").device
      )
    )
);

const samplesSchema = z.array(sampleUsageSchema);

app.get(
  "/:id/samples",
  describe(
    "Every sample path a project's sessions reference. Grouped by path, most " +
      "widely shared first, with the ids of the sessions that reference each " +
      "and whether any of them reports the file missing.",
    { schema: samplesSchema, description: "Samples fetched successfully" },
    400
  ),
  idParam(),
  async (c) =>
    respond(c, samplesSchema, await getProjectSamples(c.req.valid("param").id))
);

const sampleSessionsSchema = z.array(sampleSessionSchema);

const sampleSessionsQuerySchema = z.object({
  path: z.string().min(1),
});

app.get(
  "/:id/samples/sessions",
  describe(
    "The sessions in a project that reference one sample path. Most " +
      "recently saved first, with each session's status for the path. A path " +
      "no session carries answers an empty list rather than 404.",
    {
      schema: sampleSessionsSchema,
      description: "Sessions fetched successfully",
    },
    400
  ),
  idParam(),
  validator("query", sampleSessionsQuerySchema),
  async (c) =>
    respond(
      c,
      sampleSessionsSchema,
      await getSessionsBySample(
        c.req.valid("param").id,
        c.req.valid("query").path
      )
    )
);

app.get(
  "/:id/activity",
  describe(
    "Recent activity in a project, newest first. Pass `entityType` + " +
      "`entityId` to scope it to one entity.",
    { schema: activitySchema, description: "Activity fetched successfully" },
    400
  ),
  idParam(),
  validator("query", activityQuerySchema),
  async (c) =>
    respond(
      c,
      activitySchema,
      await getProjectActivity(c.req.valid("param").id, c.req.valid("query"))
    )
);

app.get(
  "/:id/storage",
  describe(
    "How much storage a project is using. Also how much of that is the " +
      "objects its repos hold, and the cap it is measured against, where " +
      "the instance sets one.",
    { schema: projectStorageReportSchema, description: "Storage usage" },
    400
  ),
  idParam(),
  async (c) => {
    const { id } = c.req.valid("param");
    return respond(c, projectStorageReportSchema, {
      ...(await reportFor(projectScope(id))),
      repositoryBytes: await repoBytes(id),
    });
  }
);

app.get(
  "/:id/statuses",
  describe(
    "Get statuses in a project",
    { schema: statusesSchema, description: "Statuses fetched successfully" },
    400
  ),
  idParam(),
  async (c) =>
    respond(
      c,
      statusesSchema,
      await getStatusesInProject(c.req.valid("param").id)
    )
);

app.get(
  "/:id/labels",
  describe(
    "Get the label vocabulary for a project",
    { schema: labelsSchema, description: "Labels fetched successfully" },
    400
  ),
  idParam(),
  async (c) =>
    respond(c, labelsSchema, await getLabelsInProject(c.req.valid("param").id))
);

app.post(
  "/:id/labels",
  describe(
    "Create a label in a project. A name the project already has is a 409.",
    { status: 201, schema: labelSchema, description: "Label created" },
    400,
    409
  ),
  idParam(),
  validator("json", newLabelSchema),
  async (c) =>
    respond(
      c,
      labelSchema,
      await createLabel(
        c.req.valid("param").id,
        c.req.valid("json"),
        c.get("user").id
      ),
      201
    )
);

app.on("POST", "/:id/audio-backfill", rateLimit("audio-backfill"));

app.post(
  "/:id/audio-backfill",
  describe(
    "Queue audio analysis for a project. Duration, waveform, loudness and " +
      "spectrum analysis for every one of the project's audio files whose " +
      "analysis is outstanding. Responds " +
      "with the job id as soon as the work is queued; poll GET /jobs/:id " +
      "for its progress.",
    {
      status: 202,
      schema: queuedJobSchema,
      description: "Backfill queued",
    },
    400
  ),
  idParam(),
  async (c) => {
    const job = await enqueueAudioBackfill(c.req.valid("param").id, {
      createdBy: c.get("user").id,
    });

    return respond(c, queuedJobSchema, { jobId: job.id }, 202);
  }
);

const jobsQuerySchema = z.object({
  status: z
    .string()
    .optional()
    .transform((raw) => raw?.split(",").map((status) => status.trim()))
    .pipe(z.array(z.enum(rawJobStatusEnum)).optional()),
  recentMs: z.coerce.number().int().nonnegative().optional(),
});

app.get(
  "/:id/jobs",
  describe(
    "The project's background jobs, newest first. `status` narrows to a " +
      "comma-separated list of statuses. `recentMs` keeps done and cancelled " +
      "jobs only if they finished within that many milliseconds; failed jobs " +
      "stay until cleared.",
    { schema: jobsSchema, description: "Jobs for the project" },
    400
  ),
  idParam(),
  validator("query", jobsQuerySchema),
  async (c) => {
    const { status, recentMs } = c.req.valid("query");
    return respond(
      c,
      jobsSchema,
      await getProjectJobs(c.req.valid("param").id, {
        statuses: status,
        recentMs,
      })
    );
  }
);

/** How long a finished job stays in a new watcher's snapshot. */
const JOB_EVENTS_RECENT_MS = 10_000;

/**
 * Half the server's idle timeout, so a project whose jobs do not change never
 * leaves the stream quiet long enough for `Bun.serve` to close it.
 */
const JOB_EVENTS_PING_MS = (IDLE_TIMEOUT_SECONDS * 1000) / 2;

app.get(
  "/:id/jobs/events",
  describeRaw(
    "A server-sent event stream of the project's jobs. It opens with a " +
      "`snapshot` event whose data is the jobs a watcher shows: queued, " +
      "running and failed jobs, and done or cancelled jobs that finished in " +
      "the last 10 s. Every change to one of the project's jobs follows as a " +
      "`job` event carrying the row, and a `ping` event arrives every " +
      `${JOB_EVENTS_PING_MS / 1000} s.`,
    {
      description: "`text/event-stream` of `snapshot`, `job` and `ping` events",
    },
    400
  ),
  idParam(),
  (c) => {
    const projectId = c.req.valid("param").id;
    const ends = [c.req.raw.signal, shutdownSignal];

    const response = streamSSE(c, async (stream) => {
      // A disconnect arrives as the request's signal or as the response body
      // being cancelled, and a server shutdown as `shutdownSignal`; each ends
      // the stream the same way.
      const closed = new Promise<void>((resolve) => stream.onAbort(resolve));
      const disconnect = () => stream.abort();
      for (const signal of ends) {
        signal.addEventListener("abort", disconnect, { once: true });
      }
      if (ends.some((signal) => signal.aborted)) disconnect();

      const send = (job: DescribedJob) =>
        void stream.writeSSE({
          event: "job",
          id: String(job.id),
          data: JSON.stringify(job),
        });

      // Changes that land while the snapshot is read wait for it, so a watcher
      // applies them on top of the snapshot rather than under it.
      const early: DescribedJob[] = [];
      let snapshotSent = false;
      const unsubscribe = subscribeProject(projectId, (job) =>
        snapshotSent ? send(job) : early.push(job)
      );
      const ping = setInterval(
        () => void stream.writeSSE({ event: "ping", data: "" }),
        JOB_EVENTS_PING_MS
      );

      try {
        const snapshot = await getProjectJobs(projectId, {
          recentMs: JOB_EVENTS_RECENT_MS,
        });
        await stream.writeSSE({
          event: "snapshot",
          data: JSON.stringify(snapshot),
        });
        snapshotSent = true;
        for (const job of early.splice(0)) send(job);

        await closed;
      } finally {
        clearInterval(ping);
        unsubscribe();
        for (const signal of ends) {
          signal.removeEventListener("abort", disconnect);
        }
      }
    });

    // `streamSSE` sets `no-cache` on the context, and the response takes the
    // context's headers once the handler returns, so this overrides it.
    // Without `no-transform`, the client's `/api` rewrite gzips the stream and
    // holds every event until the compressor's buffer fills.
    c.header("Cache-Control", "no-cache, no-transform");
    return response;
  }
);

app.delete(
  "/:id/jobs/failed",
  describe(
    "Delete the project's failed jobs. Queued, running and finished jobs are left alone.",
    { schema: bulkDeletedSchema, description: "Failed jobs deleted" },
    400
  ),
  idParam(),
  async (c) => {
    const cleared = await clearFailedJobs(c.req.valid("param").id);
    return respond(c, bulkDeletedSchema, { deleted: cleared });
  }
);

app.patch(
  "/:id/labels/:labelId",
  describe(
    "Rename and/or recolour a label in a project",
    { schema: labelSchema, description: "Label updated" },
    400,
    404,
    409
  ),
  idParams("id", "labelId"),
  validator("json", updateLabelSchema),
  async (c) => {
    const { id, labelId } = c.req.valid("param");
    return respond(
      c,
      labelSchema,
      await updateLabel(id, labelId, c.req.valid("json"), c.get("user").id)
    );
  }
);

app.delete(
  "/:id/labels/:labelId",
  describeRaw(
    "Delete a label from a project. Its links to entities are removed too.",
    { status: 204, description: "Label deleted" },
    400,
    404
  ),
  idParams("id", "labelId"),
  async (c) => {
    const { id, labelId } = c.req.valid("param");
    await deleteLabel(id, labelId, c.get("user").id);
    return c.body(null, 204);
  }
);

app.get(
  "/:id/priorities",
  describe(
    "Get a project's priority scale, bottom level first. Each level carries " +
      "how many tracks, collections and sessions hold it.",
    {
      schema: scaleEntriesSchema,
      description: "Priority levels fetched successfully",
    },
    400
  ),
  idParam(),
  async (c) =>
    respond(
      c,
      scaleEntriesSchema,
      await getPriorityLevels(c.req.valid("param").id)
    )
);

app.post(
  "/:id/priorities",
  describe(
    "Add a priority level at the top of a project's scale. A name the " +
      "scale already has is a 409.",
    {
      status: 201,
      schema: scaleLevelSchema,
      description: "Priority level created",
    },
    400,
    409
  ),
  idParam(),
  validator("json", newPriorityLevelSchema),
  async (c) =>
    respond(
      c,
      scaleLevelSchema,
      await createPriorityLevel(
        c.req.valid("param").id,
        c.req.valid("json"),
        c.get("user").id
      ),
      201
    )
);

app.put(
  "/:id/priorities/order",
  describe(
    "Reorder a project's priority scale. `ids` names every level of the " +
      "project exactly once, bottom level first.",
    { schema: scaleEntriesSchema, description: "Priority scale reordered" },
    400
  ),
  idParam(),
  validator("json", priorityOrderSchema),
  async (c) =>
    respond(
      c,
      scaleEntriesSchema,
      await reorderPriorityLevels(
        c.req.valid("param").id,
        c.req.valid("json").ids
      )
    )
);

app.patch(
  "/:id/priorities/:levelId",
  describe(
    "Update a priority level. Rename or recolour it, or make it the " +
      "project's default: `isDefault: true` moves the flag off the old " +
      "default. A name the scale already has is a 409.",
    { schema: scaleLevelSchema, description: "Priority level updated" },
    400,
    404,
    409
  ),
  idParams("id", "levelId"),
  validator("json", updatePriorityLevelSchema),
  async (c) => {
    const { id, levelId } = c.req.valid("param");
    return respond(
      c,
      scaleLevelSchema,
      await updatePriorityLevel(
        id,
        levelId,
        c.req.valid("json"),
        c.get("user").id
      )
    );
  }
);

app.delete(
  "/:id/priorities/:levelId",
  describeRaw(
    "Delete a priority level. Its tracks, collections and sessions move to " +
      "the level `replaceWith` names, in the same transaction. The default " +
      "level cannot be deleted, and the replacement must be another level of " +
      "the same project; either is a 400.",
    { status: 204, description: "Priority level deleted" },
    400,
    404
  ),
  idParams("id", "levelId"),
  validator("query", deletePriorityLevelQuerySchema),
  async (c) => {
    const { id, levelId } = c.req.valid("param");
    await deletePriorityLevel(
      id,
      levelId,
      c.req.valid("query").replaceWith,
      c.get("user").id
    );
    return c.body(null, 204);
  }
);

app.get(
  "/:id/relation-types",
  describe(
    "Get a project's relation types in list order. Each type carries how " +
      "many track relations use it (`inUse`).",
    {
      schema: relationTypeEntriesSchema,
      description: "Relation types fetched successfully",
    },
    400
  ),
  idParam(),
  async (c) =>
    respond(
      c,
      relationTypeEntriesSchema,
      await getRelationTypes(c.req.valid("param").id)
    )
);

app.post(
  "/:id/relation-types",
  describe(
    "Add a relation type at the end of a project's list. A name the list " +
      "already has is a 409.",
    {
      status: 201,
      schema: rankedRelationTypeSchema,
      description: "Relation type created",
    },
    400,
    409
  ),
  idParam(),
  validator("json", relationTypeNameSchema),
  async (c) =>
    respond(
      c,
      rankedRelationTypeSchema,
      await createRelationType(
        c.req.valid("param").id,
        c.req.valid("json"),
        c.get("user").id
      ),
      201
    )
);

app.put(
  "/:id/relation-types/order",
  describe(
    "Reorder a project's relation types. `ids` names every type of the " +
      "project exactly once, first type first.",
    {
      schema: relationTypeEntriesSchema,
      description: "Relation types reordered",
    },
    400
  ),
  idParam(),
  validator("json", relationTypeOrderSchema),
  async (c) =>
    respond(
      c,
      relationTypeEntriesSchema,
      await reorderRelationTypes(
        c.req.valid("param").id,
        c.req.valid("json").ids
      )
    )
);

app.patch(
  "/:id/relation-types/:typeId",
  describe(
    "Rename a relation type. A name another type of the list has is a 409.",
    { schema: rankedRelationTypeSchema, description: "Relation type renamed" },
    400,
    404,
    409
  ),
  idParams("id", "typeId"),
  validator("json", relationTypeNameSchema),
  async (c) => {
    const { id, typeId } = c.req.valid("param");
    return respond(
      c,
      rankedRelationTypeSchema,
      await renameRelationType(
        id,
        typeId,
        c.req.valid("json"),
        c.get("user").id
      )
    );
  }
);

app.delete(
  "/:id/relation-types/:typeId",
  describeRaw(
    "Delete a relation type no track relation uses. While any does, the " +
      "delete is a 409 with code `relation_type_in_use` and how many in " +
      "`details.inUse`.",
    { status: 204, description: "Relation type deleted" },
    400,
    404,
    409
  ),
  idParams("id", "typeId"),
  async (c) => {
    const { id, typeId } = c.req.valid("param");
    await deleteRelationType(id, typeId, c.get("user").id);
    return c.body(null, 204);
  }
);

app.get(
  "/:id/sessions",
  describe(
    "Get sessions in a project",
    {
      schema: projectSessionsSchema,
      description: "Sessions fetched successfully",
    },
    400
  ),
  idParam(),
  async (c) =>
    respond(
      c,
      projectSessionsSchema,
      await getSessionsInProject(c.req.valid("param").id)
    )
);

app.get(
  "/:id/members",
  describe(
    "List a project's members with their user details",
    { schema: membersSchema, description: "Members fetched successfully" },
    400
  ),
  idParam(),
  async (c) =>
    respond(c, membersSchema, await getProjectMembers(c.req.valid("param").id))
);

app.patch(
  "/:id/members/:userId",
  describe(
    "Change a member's role. Requires admin, and a role no higher than the caller's own; owner is granted only by transfer.",
    { schema: memberResultSchema, description: "Role updated successfully" },
    400,
    403,
    404,
    409
  ),
  memberParams,
  validator("json", updateMemberRoleSchema),
  async (c) => {
    const { id, userId } = c.req.valid("param");
    const { role } = c.req.valid("json");
    return respond(
      c,
      memberResultSchema,
      await changeMembership(id, c.get("user").id, userId, {
        kind: "role",
        role,
      })
    );
  }
);

app.delete(
  "/:id/members/:userId",
  describeRaw(
    "Remove a member from a project. Requires admin, and the member must not outrank the caller.",
    { status: 204, description: "Member removed" },
    400,
    403,
    404,
    409
  ),
  memberParams,
  async (c) => {
    const { id, userId } = c.req.valid("param");
    await changeMembership(id, c.get("user").id, userId, { kind: "remove" });
    return c.body(null, 204);
  }
);

app.post(
  "/:id/leave",
  describe(
    "Leave a project. Any member may leave their own membership; the last owner must hand ownership on first.",
    { schema: memberResultSchema, description: "Membership ended" },
    400,
    404,
    409
  ),
  idParam(),
  async (c) => {
    const { id } = c.req.valid("param");
    // Actor and target are the same person, so the rank rule passes for any
    // role while the last-owner check still holds.
    const userId = c.get("user").id;
    return respond(
      c,
      memberResultSchema,
      await changeMembership(id, userId, userId, { kind: "remove" })
    );
  }
);

app.post(
  "/:id/transfer-ownership",
  describe(
    "Transfer project ownership to another member. Requires owner; the caller becomes admin and the target becomes owner.",
    { schema: memberResultSchema, description: "Ownership transferred" },
    400,
    403,
    404
  ),
  idParam(),
  validator("json", transferOwnershipSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const { userId: toUserId } = c.req.valid("json");
    const fromUserId = c.get("user").id;
    const previous = await transferOwnership(id, fromUserId, toUserId);
    await recordActivity({
      projectId: id,
      entityType: "project",
      entityId: id,
      userId: fromUserId,
      action: "updated",
      before: { owner: fromUserId },
      after: { owner: toUserId },
    });
    return respond(c, memberResultSchema, previous);
  }
);

app.get(
  "/:id/invites",
  describe(
    "List a project's pending invites. Requires admin.",
    { schema: invitesSchema, description: "Invites fetched successfully" },
    400
  ),
  idParam(),
  async (c) =>
    respond(c, invitesSchema, await listInvites(c.req.valid("param").id))
);

app.post(
  "/:id/invites",
  describe(
    "Invite someone to a project by email. Requires the role the project lets invite (admin unless it says otherwise; 403 `forbidden` below it), and a role no higher than the caller's own. An omitted role is the project's default invite role.",
    { status: 201, schema: inviteResultSchema, description: "Invite created" },
    400,
    403,
    409
  ),
  idParam(),
  validator("json", createInviteSchema),
  async (c) => {
    const { email, role } = c.req.valid("json");
    return respond(
      c,
      inviteResultSchema,
      await createInvite(
        c.req.valid("param").id,
        { id: c.get("user").id, name: c.get("user").name, role: gatedRole(c) },
        email,
        role
      ),
      201
    );
  }
);

app.get(
  "/:id/saved-views",
  describe(
    "List a project's saved table views. The caller's own and every shared one, optionally filtered to one kind.",
    { schema: savedViewsSchema, description: "Saved views fetched" },
    400
  ),
  idParam(),
  validator("query", z.object({ kind: savedViewKindSchema.optional() })),
  async (c) =>
    respond(
      c,
      savedViewsSchema,
      await getSavedViews(
        c.req.valid("param").id,
        savedViewActor(c),
        c.req.valid("query").kind
      )
    )
);

app.post(
  "/:id/saved-views",
  describe(
    "Save a table view. Creates a private view owned by the caller, or overwrites the caller's own view with the same name and kind.",
    { status: 201, schema: savedViewSchema, description: "Saved view created" },
    400
  ),
  idParam(),
  validator("json", newSavedViewSchema),
  async (c) =>
    respond(
      c,
      savedViewSchema,
      await createSavedView(
        c.req.valid("param").id,
        savedViewActor(c),
        c.req.valid("json")
      ),
      201
    )
);

app.patch(
  "/:id/saved-views/:viewId",
  describe(
    "Update a saved table view. Requires its owner, or admin; only the owner may change `shared`.",
    { schema: savedViewSchema, description: "Saved view updated" },
    400,
    403,
    404
  ),
  idParams("id", "viewId"),
  validator("json", editSavedViewSchema),
  async (c) => {
    const { id, viewId } = c.req.valid("param");
    return respond(
      c,
      savedViewSchema,
      await updateSavedView(id, viewId, savedViewActor(c), c.req.valid("json"))
    );
  }
);

app.delete(
  "/:id/saved-views/:viewId",
  describeRaw(
    "Delete a saved table view. Requires its owner, or admin.",
    { status: 204, description: "Saved view deleted" },
    400,
    404
  ),
  idParams("id", "viewId"),
  async (c) => {
    const { id, viewId } = c.req.valid("param");
    await deleteSavedView(id, viewId, savedViewActor(c));
    return c.body(null, 204);
  }
);

app.route("/", customFieldRoutes);

export default app;
