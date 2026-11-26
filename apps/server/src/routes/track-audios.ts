import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { AuthedEnv } from "../auth.js";
import {
  enqueueAudioAnalysis,
  getTrackAudioDiff,
  getTrackAudioMeasure,
  setPrimaryTrackAudio,
  unlinkTrackAudio,
  unpinPrimaryTrackAudio,
} from "../db/queries/track-audios.js";
import { queuedJobSchema } from "../db/schema/jobs.js";
import { trackAudioDiffSchema } from "../db/schema/track-audio-analysis.js";
import {
  MEASURE_NAMES,
  type MeasureName,
  TRACK_AUDIO_MEASURES,
} from "../entities/track-audio/measures.js";
import {
  describer,
  idParam,
  idParams,
  idValue,
  messageSchema,
  params,
  respond,
  respondMessage,
} from "../lib/http.js";

const { describe, describeRaw } = describer("Audio versions");

const app = new Hono<AuthedEnv>();

const measureNameSchema = z.enum(
  MEASURE_NAMES as [MeasureName, ...MeasureName[]]
);

/**
 * The union of every measure's value shape, for the OpenAPI document; a given
 * response is checked against its own measure's schema instead (below), so an
 * individual measure route stays exactly typed.
 */
const measureValueSchema = z.union(
  Object.values(TRACK_AUDIO_MEASURES).map(
    (measure) => measure.schema
  ) as unknown as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]
);
const measureResponseSchema = z.object({ value: measureValueSchema });

app.patch(
  "/:id/primary",
  describe(
    "Make this track audio the track's primary version and pin it",
    { schema: messageSchema, description: "Primary set" },
    400,
    404
  ),
  idParam(),
  async (c) => {
    const result = await setPrimaryTrackAudio(c.req.valid("param").id);
    if (!result) throw new HTTPException(404);
    return respondMessage(c, "Primary set");
  }
);

app.delete(
  "/:id/primary",
  describe(
    "Unpin the track's primary version so it resumes following the latest bounce",
    { schema: messageSchema, description: "Primary unpinned" },
    400,
    404
  ),
  idParam(),
  async (c) => {
    const result = await unpinPrimaryTrackAudio(c.req.valid("param").id);
    if (!result) throw new HTTPException(404);
    return respondMessage(c, "Primary unpinned");
  }
);

app.delete(
  "/:id",
  describeRaw(
    "Unlink a track audio and resequence the track's versions",
    { status: 204, description: "Track audio unlinked" },
    400,
    404
  ),
  idParam(),
  async (c) => {
    const deleted = await unlinkTrackAudio(c.req.valid("param").id);
    if (!deleted) throw new HTTPException(404);
    return c.body(null, 204);
  }
);

app.post(
  "/:id/analysis",
  describe(
    "Queue this version's analysis now. Duration, waveform, loudness, " +
      "spectrum, tempo and key, whether or not the project analyses " +
      "automatically; a version already current finishes at once. Responds " +
      "with the job id as soon as it is queued (the one already queued, if " +
      "there is one); poll GET /jobs/:id for its progress.",
    { status: 202, schema: queuedJobSchema, description: "Analysis queued" },
    400,
    404
  ),
  idParam(),
  async (c) => {
    const [job] = await enqueueAudioAnalysis([c.req.valid("param").id]);
    if (!job) throw new HTTPException(404);
    return respond(c, queuedJobSchema, { jobId: job.id }, 202);
  }
);

app.get(
  "/:id/measures/:measure",
  describe(
    "One of a track audio's lazily-served measurements, by name; 404 while " +
      "the analysis behind it is still outstanding, which is what queues it",
    { schema: measureResponseSchema, description: "Measure retrieved" },
    400,
    404
  ),
  params({ id: idValue, measure: measureNameSchema }),
  async (c) => {
    const { id, measure } = c.req.valid("param");
    const value = await getTrackAudioMeasure(id, measure);
    if (value === undefined) throw new HTTPException(404);
    // The registry entry the request's own `measure` picked is what actually
    // describes `value`'s shape; `getTrackAudioMeasure` reads it dynamically,
    // so nothing narrower than `unknown` connects the two for the compiler.
    const schema = z.object({ value: TRACK_AUDIO_MEASURES[measure].schema });
    return respond(c, schema, { value } as z.infer<typeof schema>);
  }
);

app.get(
  "/:id/diff/:otherId",
  describe(
    "Compare two versions of a track. This version against another " +
      "version of the same track, per second of this one: the stored row " +
      "when there is one, " +
      "otherwise computed from both versions' stored features; 404 when " +
      "either has not been analysed or the two belong to different tracks",
    { schema: trackAudioDiffSchema, description: "Diff retrieved" },
    400,
    404
  ),
  idParams("id", "otherId"),
  async (c) => {
    const { id, otherId } = c.req.valid("param");
    const diff = await getTrackAudioDiff(id, otherId);
    if (!diff) throw new HTTPException(404);
    return respond(c, trackAudioDiffSchema, diff);
  }
);

export default app;
