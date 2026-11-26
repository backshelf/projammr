import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  assertInProject,
  projectScope,
} from "../../db/queries/authorization.js";
import {
  cancelJobOrThrow,
  getJob,
  getProjectJobs,
  projectIdForJob,
} from "../../db/queries/jobs.js";
import { projectPolicy } from "../../db/queries/project-policy.js";
import {
  audioAuditSchema,
  auditProjectAudio,
  audioFindings,
  candidateAudioSchema,
  enqueueAudioAnalysis,
  enqueueAudioBackfill,
  getCandidateAudios,
  linkTrackAudios,
  linkTrackAudiosBodySchema,
  linkTrackAudiosResultSchema,
  projectIdForTrackAudio,
  setPrimaryTrackAudio,
  unlinkTrackAudio,
  type AudioAudit,
} from "../../db/queries/track-audios.js";
import { assets } from "../../db/schema/assets.js";
import { rawJobStatusEnum } from "../../db/schema/enums.js";
import { jobSchema } from "../../db/schema/jobs.js";
import {
  getMainSessionForTrack,
  mainSessionSchema,
} from "../../entities/session/queries.js";
import { messageSchema } from "../../lib/http.js";
import { spendToken } from "../../middleware/rate-limit.js";
import {
  requireEntity,
  requireProject,
  requireResolved,
} from "../authorize.js";
import { defineTool } from "../spec.js";

/** `auditProjectAudio` plus the findings it feeds, the one assembly both `audit_audio` and `get_track_audio_facts` share. */
export async function auditWithFindings(
  projectId: number,
  trackIds?: number[]
): Promise<AudioAudit> {
  const [facts, { audio }] = await Promise.all([
    auditProjectAudio(projectId, trackIds),
    projectPolicy(projectId),
  ]);
  return { ...facts, findings: audioFindings(facts, audio) };
}

const auditAudioInput = z.object({
  projectId: z.number(),
  trackIds: z
    .array(z.number())
    .optional()
    .describe(
      "Page the audit to these tracks. For a project over a few hundred tracks," +
        " page through list_tracks first and pass each page's ids here rather" +
        " than auditing the whole catalogue at once."
    ),
});

const trackAudioFactsInput = z.object({ trackId: z.number() });

/**
 * The one track's audit facts, plus its findings. Each version already
 * carries its scalar analysis (duration, LUFS, LRA, true peak and whether it
 * is current) from {@link auditProjectAudio}; there is nothing more to
 * assemble for a single track than to scope the audit read to it.
 */
const trackAudioFactsOutput = audioAuditSchema.shape.tracks.element.extend({
  findings: audioAuditSchema.shape.findings,
  mainSession: mainSessionSchema.nullable(),
});

const listCandidateAudiosOutput = z.object({
  candidates: z.array(candidateAudioSchema),
});

const linkAudioVersionsInput = linkTrackAudiosBodySchema.safeExtend({
  trackId: z.number(),
});

const trackAudioIdInput = z.object({ trackAudioId: z.number() });

const queueAnalysisInput = z.object({
  trackAudioIds: z.array(z.number()).min(1),
});

const queueBackfillInput = z.object({ projectId: z.number() });

const jobIdInput = z.object({ jobId: z.number() });

const listJobsInput = z.object({
  projectId: z.number(),
  status: z.array(z.enum(rawJobStatusEnum)).optional(),
  recentMs: z.number().int().nonnegative().optional(),
});

const listJobsOutput = z.object({ jobs: z.array(jobSchema) });

/**
 * The audio tools: the project and per-track audit, a track's candidate
 * audios, its audio versions, and the analysis jobs that measure them.
 */
export const AUDIO_TOOLS = [
  defineTool({
    name: "audit_audio",
    title: "Audit a project's audio",
    description:
      "Runs the audio audit over a project: every track's audio versions with" +
      " their asset facts, sessions and analysis, cross-track fingerprint" +
      " duplicates, and the findings the facts raise (missing files, stale" +
      " primaries, outstanding analysis, and more). For a project over a few" +
      " hundred tracks, page trackIds from list_tracks instead of auditing" +
      " the whole project in one call.",
    scope: "read",
    input: auditAudioInput,
    output: audioAuditSchema,
    run: async (actor, { projectId, trackIds }) => {
      await requireProject(actor, projectId, "viewer");
      return auditWithFindings(projectId, trackIds);
    },
  }),
  defineTool({
    name: "get_track_audio_facts",
    title: "Get one track's audio facts",
    description:
      "The audit's facts for a single track — its audio versions (each with" +
      " its scalar analysis: duration, LUFS, loudness range, true peak," +
      " silence, clipping, detected BPM and key with their confidences, and" +
      " whether it's current), its session attachments, its findings, and the" +
      " track's main session (its DAW project's own tempo and key, for" +
      " comparison against the detected values — the detectors are" +
      " heuristics, so that comparison is yours to make, not a finding code).",
    scope: "read",
    input: trackAudioFactsInput,
    output: trackAudioFactsOutput,
    run: async (actor, { trackId }) => {
      const gate = await requireEntity(actor, "track", trackId, "viewer");
      const [audit, mainSession] = await Promise.all([
        auditWithFindings(gate.projectId, [trackId]),
        getMainSessionForTrack(trackId),
      ]);
      // requireEntity already resolved trackId to a row in gate.projectId, and
      // auditProjectAudio carries every track in its scope whether or not it
      // has a version, so the track is always here; a miss means the two
      // reads disagree about the track's project, not that it has no audio.
      const track = audit.tracks.find((t) => t.trackId === trackId);
      if (!track) {
        throw new HTTPException(404, { message: "track not found" });
      }
      return {
        ...track,
        findings: audit.findings.filter((f) => f.trackId === trackId),
        mainSession,
      };
    },
  }),
  defineTool({
    name: "list_candidate_audios",
    title: "List a track's candidate audios",
    description:
      "Audio assets reachable through a track's own attachments or its" +
      " sessions' attachments, each carrying its link state (already a" +
      " version, or not).",
    scope: "read",
    input: trackAudioFactsInput,
    output: listCandidateAudiosOutput,
    run: async (actor, { trackId }) => {
      await requireEntity(actor, "track", trackId, "viewer");
      const candidates = await getCandidateAudios(trackId);
      return { candidates };
    },
  }),
  defineTool({
    name: "link_audio_versions",
    title: "Link assets to a track as audio versions",
    description:
      "Links assets to a track as audio versions. Idempotent; resequences" +
      " versions and optionally sets the primary. Asset ids that are not" +
      " audio files are ignored, so `audios` is what was actually linked." +
      " `primaryAssetId`, when given, must be one of `assetIds`." +
      " `analysisJobIds` carries the ids of the `audio_analysis` jobs queued" +
      " for the newly linked rows — poll them with get_job.",
    scope: "write",
    input: linkAudioVersionsInput,
    output: linkTrackAudiosResultSchema,
    run: async (actor, { trackId, assetIds, primaryAssetId }) => {
      const gate = await requireEntity(actor, "track", trackId, "editor");
      await assertInProject(
        assets,
        [...assetIds, primaryAssetId],
        gate.projectId,
        "Asset"
      );
      return linkTrackAudios(trackId, assetIds, primaryAssetId);
    },
  }),
  defineTool({
    name: "set_primary_audio",
    title: "Set a track's primary audio version",
    description: "Makes this track audio the track's primary version.",
    scope: "write",
    input: trackAudioIdInput,
    output: messageSchema,
    run: async (actor, { trackAudioId }) => {
      await requireResolved(
        actor,
        projectScope(await projectIdForTrackAudio(trackAudioId)),
        "track audio",
        "editor"
      );
      const result = await setPrimaryTrackAudio(trackAudioId);
      if (!result) {
        throw new HTTPException(404, { message: "track audio not found" });
      }
      return { message: "Primary set" };
    },
  }),
  defineTool({
    name: "unlink_audio_version",
    title: "Unlink an audio version",
    description: "Unlinks a track audio and resequences the track's versions.",
    scope: "write",
    destructive: true,
    input: trackAudioIdInput,
    output: messageSchema,
    run: async (actor, { trackAudioId }) => {
      await requireResolved(
        actor,
        projectScope(await projectIdForTrackAudio(trackAudioId)),
        "track audio",
        "editor"
      );
      const deleted = await unlinkTrackAudio(trackAudioId);
      if (!deleted) {
        throw new HTTPException(404, { message: "track audio not found" });
      }
      return { message: "Unlinked" };
    },
  }),
  defineTool({
    name: "queue_analysis",
    title: "Queue audio analysis",
    description:
      "Queues duration, waveform, loudness and spectrum analysis for these" +
      " track audios. A version whose analysis is already current is a" +
      " no-op. Poll the returned job ids with get_job until each reaches" +
      " done, failed or cancelled.",
    scope: "write",
    input: queueAnalysisInput,
    output: z.object({ jobIds: z.array(z.number()) }),
    run: async (actor, { trackAudioIds }) => {
      await Promise.all(
        trackAudioIds.map(async (id) =>
          requireResolved(
            actor,
            projectScope(await projectIdForTrackAudio(id)),
            "track audio",
            "editor"
          )
        )
      );
      const jobs = await enqueueAudioAnalysis(trackAudioIds);
      return { jobIds: jobs.map((job) => job.id) };
    },
  }),
  defineTool({
    name: "queue_backfill",
    title: "Queue an audio analysis backfill",
    description:
      "Fills in a project's outstanding analysis: every track audio whose" +
      " version has fallen behind the current analysis version, one job" +
      " for the whole project. Admin-only and rate-limited. Poll the" +
      " returned job with get_job until it reaches done, failed or" +
      " cancelled.",
    scope: "write",
    input: queueBackfillInput,
    output: jobSchema,
    run: async (actor, { projectId }) => {
      await requireProject(actor, projectId, "admin");
      spendToken("audio-backfill", actor.id);
      const job = await enqueueAudioBackfill(projectId, {
        createdBy: actor.id,
      });
      return getJob(job.id);
    },
  }),
  defineTool({
    name: "get_job",
    title: "Get a background job",
    description:
      "A background job's progress and result, by id. Poll this after" +
      " queue_analysis or queue_backfill until `status` is done, failed or" +
      " cancelled.",
    scope: "read",
    input: jobIdInput,
    output: jobSchema,
    run: async (actor, { jobId }) => {
      await requireResolved(
        actor,
        projectScope(await projectIdForJob(jobId)),
        "job",
        "viewer"
      );
      return getJob(jobId);
    },
  }),
  defineTool({
    name: "list_jobs",
    title: "List a project's background jobs",
    description:
      "The project's background jobs, newest first. `status` narrows to" +
      " those statuses. `recentMs` keeps done and cancelled jobs only if" +
      " they finished within that many milliseconds; failed jobs stay" +
      " until cleared.",
    scope: "read",
    input: listJobsInput,
    output: listJobsOutput,
    run: async (actor, { projectId, status, recentMs }) => {
      await requireProject(actor, projectId, "viewer");
      const jobs = await getProjectJobs(projectId, {
        statuses: status,
        recentMs,
      });
      return { jobs };
    },
  }),
  defineTool({
    name: "cancel_job",
    title: "Cancel a background job",
    description:
      "Cancels a job that has not finished. A queued job is cancelled at" +
      " once. A running job is asked to stop and reaches `cancelled` once" +
      " its run gives up.",
    scope: "write",
    input: jobIdInput,
    output: jobSchema,
    run: async (actor, { jobId }) => {
      await requireResolved(
        actor,
        projectScope(await projectIdForJob(jobId)),
        "job",
        "editor"
      );
      return cancelJobOrThrow(jobId);
    },
  }),
];
