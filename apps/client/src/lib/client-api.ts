"use client";

import {
  type BulkSelection,
  ENTITY_API,
  type MovePreview,
} from "@/entities/api";
import { browserApi } from "@/lib/browser-api";
import type { VersionToPlay } from "@/lib/policies/playback";
import {
  type HeatmapFilters,
  myHeatmap,
  myMachines,
  myProjects,
  projectHeatmap,
} from "@/lib/shared-reads";
import {
  isActionError,
  toActionResult,
} from "@workspace/api/lib/action-result";
import {
  ActionError,
  Asset,
  CollectionPrimaryAudios,
  CollectionTrackSummary,
  HeatmapDay,
  Job,
  MachineList,
  MyProject,
  PlayableTrackAudio,
  ProjectSave,
  Session,
  TableEntityKind,
  TrackAudioDiff,
  UserHeatmapDay,
} from "@workspace/api/api";
import type { MeasureName } from "@workspace/api/lib/enums";

export type { HeatmapFilters };

/*
 * Reads issued from the browser during an interaction — expanding a row,
 * opening a disclosure, drawing a waveform. They go straight to the API rather
 * than through a server action so the response is one hop, not a round trip
 * through the Next server that re-renders the tree.
 */

/**
 * A track's full session rows, fetched when its sub-rows are expanded. The
 * track listing carries only the session fields it renders, so the table has
 * no file paths, counts or timestamps to show until this resolves.
 */
export const clientGetTrackSessions = async (
  trackId: number
): Promise<Session[] | ActionError> => {
  const res = await browserApi.GET("/api/tracks/{id}/sessions", {
    params: { path: { id: String(trackId) } },
  });

  return toActionResult(res, "Failed to load sessions");
};

export const clientGetTrackAttachments = async (
  trackId: number
): Promise<Asset[] | ActionError> => {
  const res = await browserApi.GET("/api/tracks/{id}/attachments", {
    params: { path: { id: String(trackId) } },
  });

  return toActionResult(res, "Failed to load attachments");
};

/** One file by id, or null once it is gone. */
export const clientGetAsset = async (
  assetId: number
): Promise<Asset | null | ActionError> => {
  const res = await browserApi.GET("/api/assets/{id}", {
    params: { path: { id: String(assetId) } },
  });

  if (res.response.status === 404) return null;

  return toActionResult(res, "Failed to load file");
};

export const clientGetTrackAudios = async (
  trackId: number
): Promise<PlayableTrackAudio[] | ActionError> => {
  const res = await browserApi.GET("/api/tracks/{id}/audios", {
    params: { path: { id: String(trackId) } },
  });

  return toActionResult(res, "Failed to load track audio");
};

/**
 * One of a track audio's lazily-served measures, by name — waveform peaks, a
 * stored spectrum, or any other entry in the server's measure registry — or
 * null while the server has none yet: it answers that with a 404 and queues
 * the analysis that will produce it. `T` is the caller's own knowledge of
 * which shape `measure` answers with; the route's schema is a union across
 * every registered measure, so nothing narrower connects the two here.
 */
export const clientGetTrackAudioMeasure = async <T>(
  trackAudioId: number,
  measure: MeasureName
): Promise<T | null | ActionError> => {
  const res = await browserApi.GET(
    "/api/track-audios/{id}/measures/{measure}",
    {
      params: { path: { id: String(trackAudioId), measure } },
    }
  );

  if (res.response.status === 404) return null;

  const result = await toActionResult<{ value: T }>(
    res,
    "Failed to load measure"
  );

  return isActionError(result) ? result : result.value;
};

/** The stored comparison between two versions of the same track, or null when
 *  none has been computed. Unlike a measure, a missing diff is a permanent
 *  answer rather than a queued job, so this is a plain, unretried read. */
export const clientGetTrackAudioDiff = async (
  trackAudioId: number,
  otherId: number
): Promise<TrackAudioDiff | null | ActionError> => {
  const res = await browserApi.GET("/api/track-audios/{id}/diff/{otherId}", {
    params: { path: { id: String(trackAudioId), otherId: String(otherId) } },
  });

  if (res.response.status === 404) return null;

  return toActionResult(res, "Failed to load diff");
};

/** One audio per track of a collection: the `version` each track plays. */
export const clientGetCollectionPrimaryAudios = async (
  collectionId: number,
  version: VersionToPlay
): Promise<CollectionPrimaryAudios | ActionError> => {
  const res = await browserApi.GET("/api/collections/{id}/audios/primary", {
    params: { path: { id: String(collectionId) }, query: { version } },
  });

  return toActionResult(res, "Failed to load collection audio");
};

/**
 * The tracks under one collection, fetched when the sidebar's collection is
 * first expanded. Loading them lazily keeps a project's whole track list off
 * the critical path of every page render.
 */
export const clientGetCollectionTrackSummaries = async (
  collectionId: number
): Promise<CollectionTrackSummary[] | ActionError> => {
  const res = await browserApi.GET("/api/collections/{id}/tracks/summary", {
    params: { path: { id: String(collectionId) } },
  });

  return toActionResult(res, "Failed to load tracks");
};

/**
 * The projects the signed-in user belongs to, read in the browser when a
 * picker needs somewhere to move a row to.
 */
export const clientGetMyProjects = async (): Promise<
  MyProject[] | ActionError
> => myProjects(browserApi);

/**
 * The signed-in user's machines and shared "Not a bounce" files, read again
 * while the Machines section is on screen.
 */
export const clientGetMyMachines = async (): Promise<
  MachineList | ActionError
> => myMachines(browserApi);

/**
 * The custom field values moving `target` into `targetProjectId` would drop,
 * asked while the mover is still choosing: one row's, or a selection's in
 * `projectId`.
 */
export const clientPreviewMove = (
  kind: TableEntityKind,
  target: { id: number } | { selection: BulkSelection },
  projectId: number,
  targetProjectId: number
): Promise<MovePreview | ActionError> =>
  "selection" in target
    ? ENTITY_API[kind].bulkMovePreview(
        browserApi,
        projectId,
        target.selection,
        targetProjectId
      )
    : ENTITY_API[kind].movePreview(browserApi, target.id, targetProjectId);

/**
 * One collapsed read of the project's jobs: whatever is queued or running,
 * every failed row, and whatever finished within `recentMs`. `JobsProvider`
 * reads this as the stream's fallback while the event source is down, and it
 * is the same shape the stream's own `snapshot` event carries.
 */
export const clientGetProjectJobs = async (
  projectId: number,
  recentMs: number
): Promise<Job[] | ActionError> => {
  const res = await browserApi.GET("/api/projects/{id}/jobs", {
    params: { path: { id: String(projectId) }, query: { recentMs } },
  });

  return toActionResult<Job[]>(res, "Failed to load jobs");
};

/**
 * One job's current row, read directly rather than off the project's live
 * map: the fallback `useTrackedJob` reaches for once the map has loaded and
 * still does not carry the id it was handed — a job the server reused
 * already done, or one whose whole life fell between two fallback polls.
 */
export const clientGetJob = async (
  jobId: number
): Promise<Job | ActionError> => {
  const res = await browserApi.GET("/api/jobs/{id}", {
    params: { path: { id: String(jobId) } },
  });

  return toActionResult<Job>(res, "Failed to load the job");
};

/** Puts a failed job back on the queue with a clean attempt count. */
export const clientRetryJob = async (
  jobId: number
): Promise<Job | ActionError> => {
  const res = await browserApi.POST("/api/jobs/{id}/retry", {
    params: { path: { id: String(jobId) } },
  });

  return toActionResult<Job>(res, "Failed to retry the job");
};

/**
 * Cancels a job that has not finished. `null` for one that already had (a
 * 409): the event stream delivers its final row regardless, so there is
 * nothing left to apply here.
 */
export const clientCancelJob = async (
  jobId: number
): Promise<Job | ActionError | null> => {
  const res = await browserApi.POST("/api/jobs/{id}/cancel", {
    params: { path: { id: String(jobId) } },
  });

  if (res.response.status === 409) return null;

  return toActionResult<Job>(res, "Failed to cancel the job");
};

/** Deletes the project's failed jobs; queued, running and done ones stay. */
export const clientClearFailedJobs = async (
  projectId: number
): Promise<{ deleted: number } | ActionError> => {
  const res = await browserApi.DELETE("/api/projects/{id}/jobs/failed", {
    params: { path: { id: String(projectId) } },
  });

  return toActionResult<{ deleted: number }>(res, "Failed to clear jobs");
};

/**
 * A project's save-activity grid over `[from, to)`. Filters combine (all
 * optional) — the project page exposes collection/label/DAW, the track rail
 * pins `trackId`.
 */
export const clientGetProjectHeatmap = async (
  projectId: number,
  range: { from: number; to: number; tz: string },
  filters: HeatmapFilters = {}
): Promise<HeatmapDay[] | ActionError> =>
  projectHeatmap(browserApi, projectId, range, filters);

/**
 * A project's most recent saves, newest first, narrowed by the same filters
 * the heatmap takes so a grid and a feed drawn side by side describe the same
 * set of saves. `day` (a `YYYY-MM-DD` local date, read against `tz`) pins the
 * feed to one calendar day.
 */
export const clientGetProjectSaves = async (
  projectId: number,
  range: { limit: number; tz: string; day?: string },
  filters: HeatmapFilters = {}
): Promise<ProjectSave[] | ActionError> => {
  const res = await browserApi.GET("/api/projects/{id}/saves", {
    params: {
      path: { id: String(projectId) },
      query: { ...range, ...filters },
    },
  });

  return toActionResult(res, "Failed to load saves");
};

/**
 * The signed-in user's save activity across every project they belong to,
 * over `[from, to)`. Unlike the project-scoped heatmap, each row also carries
 * how many distinct projects contributed to that day.
 */
export const clientGetMyHeatmap = async (range: {
  from: number;
  to: number;
  tz: string;
}): Promise<UserHeatmapDay[] | ActionError> => myHeatmap(browserApi, range);
