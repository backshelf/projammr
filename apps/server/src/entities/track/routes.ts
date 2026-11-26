import { Hono } from "hono";
import { z } from "zod";
import type { AuthedEnv } from "../../auth.js";
import { assertInProject } from "../../db/queries/authorization.js";
import {
  movedRowSchema,
  moveEntitySchema,
  moveTrackToProject,
} from "../../db/queries/move.js";
import {
  candidateAudioSchema,
  getCandidateAudios,
  getTrackAudios,
  linkTrackAudios,
  linkTrackAudiosBodySchema,
  linkTrackAudiosResultSchema,
  trackAudiosSchema,
} from "../../db/queries/track-audios.js";
import {
  addTrackRelation,
  addTrackRelationSchema,
  deleteTrackRelation,
} from "../../db/queries/track-relations.js";
import { assertRelationTypesInProject } from "../../db/queries/track-relation-types.js";
import { assets } from "../../db/schema/assets.js";
import { sessionSchema } from "../../db/schema/sessions.js";
import {
  trackRelationSchema,
  trackSchema,
  tracks as tracksTable,
} from "../../db/schema/tracks.js";
import {
  describer,
  idParam,
  idParams,
  respond,
  validator,
} from "../../lib/http.js";
import { gatedProject } from "../../middleware/authorize-project.js";
import { moveRateLimit } from "../../middleware/rate-limit.js";
import { entityTag } from "../shared.js";
import { track } from "./index.js";
import {
  getTrackAttachments,
  getTrackSessions,
  trackAttachmentsSchema,
} from "./queries.js";

const { describe, describeRaw } = describer(entityTag(track));

const app = new Hono<AuthedEnv>();

const sessionsSchema = z.array(sessionSchema);
const candidateAudiosSchema = z.array(candidateAudioSchema);
const movedTrackSchema = movedRowSchema(trackSchema);

app.get(
  "/:id/attachments",
  describe(
    "List a track's attached assets",
    {
      schema: trackAttachmentsSchema,
      description: "Attachments fetched successfully",
    },
    400,
    404
  ),
  idParam(),
  async (c) =>
    respond(
      c,
      trackAttachmentsSchema,
      await getTrackAttachments(c.req.valid("param").id)
    )
);

app.get(
  "/:id/audios",
  describe(
    "List a track's audio versions, ordered by version",
    {
      schema: trackAudiosSchema,
      description: "Track audios fetched successfully",
    },
    400,
    404
  ),
  idParam(),
  async (c) =>
    respond(c, trackAudiosSchema, await getTrackAudios(c.req.valid("param").id))
);

app.get(
  "/:id/sessions",
  describe(
    "List a track's sessions, main first then most recent",
    {
      schema: sessionsSchema,
      description: "Track sessions fetched successfully",
    },
    400,
    404
  ),
  idParam(),
  async (c) =>
    respond(c, sessionsSchema, await getTrackSessions(c.req.valid("param").id))
);

app.post(
  "/:id/audios",
  describe(
    "Link assets to a track as audio versions. Idempotent; resequences versions and optionally sets the primary. Asset ids that are not audio files are ignored, so `audios` is what is actually linked. `primaryAssetId`, when given, must be one of `assetIds`. `analysisJobIds` carries the ids of the `audio_analysis` jobs queued for the newly linked rows, so a caller can follow them without a second read.",
    {
      status: 201,
      schema: linkTrackAudiosResultSchema,
      description: "Audios linked successfully",
    },
    400,
    404
  ),
  idParam(),
  validator("json", linkTrackAudiosBodySchema),
  async (c) => {
    const { assetIds, primaryAssetId } = c.req.valid("json");
    await assertInProject(
      assets,
      [...assetIds, primaryAssetId],
      gatedProject(c),
      "Asset"
    );

    return respond(
      c,
      linkTrackAudiosResultSchema,
      await linkTrackAudios(c.req.valid("param").id, assetIds, primaryAssetId),
      201
    );
  }
);

app.get(
  "/:id/candidate-audios",
  describe(
    "The audio that could become versions of a track. Every audio asset that could be a version of this track — its attachments and its sessions' attachments — each carrying its existing track-audio link or null.",
    {
      schema: candidateAudiosSchema,
      description: "Candidate audios fetched successfully",
    },
    400,
    404
  ),
  idParam(),
  async (c) =>
    respond(
      c,
      candidateAudiosSchema,
      await getCandidateAudios(c.req.valid("param").id)
    )
);

app.post(
  "/:id/relations",
  describe(
    "Relate this track to another as a derivative: the path track is the " +
      "'from' (derivative), the body's toTrackId is the 'to' (source). " +
      "`relationTypeId` is one of the project's relation types; another " +
      "project's type is a 400.",
    {
      status: 201,
      schema: trackRelationSchema,
      description: "Relation created",
    },
    400,
    404,
    409
  ),
  idParam(),
  validator("json", addTrackRelationSchema),
  async (c) => {
    const { toTrackId, relationTypeId } = c.req.valid("json");
    await assertInProject(tracksTable, [toTrackId], gatedProject(c), "Track");
    await assertRelationTypesInProject([relationTypeId], gatedProject(c));

    const row = await addTrackRelation(
      {
        fromTrackId: c.req.valid("param").id,
        toTrackId,
        relationTypeId,
      },
      c.get("user").id
    );
    return respond(c, trackRelationSchema, row, 201);
  }
);

app.delete(
  "/:id/relations/:relationId",
  describeRaw(
    "Remove a relation touching this track, by relation id.",
    { status: 204, description: "Relation removed" },
    400,
    404
  ),
  idParams("id", "relationId"),
  async (c) => {
    const { id, relationId } = c.req.valid("param");
    await deleteTrackRelation(id, relationId, c.get("user").id);
    return c.body(null, 204);
  }
);

app.on("POST", "/:id/move", moveRateLimit);

app.post(
  "/:id/move",
  describe(
    "Move a track into another project. Its sessions, audios and the " +
      "assets nothing else in the source project references go with it; " +
      "what it shared stays behind, unlinked. Custom values carry onto the " +
      "target's field of the same name and type; `droppedFields` names the " +
      "rest. A priority level the target's scale has no level of that name " +
      "for becomes the target's default, listed in `priorityFallbacks`. " +
      "The caller must be an editor in both projects.",
    { schema: movedTrackSchema, description: "Track moved" },
    400,
    404
  ),
  idParam(),
  validator("json", moveEntitySchema),
  async (c) =>
    respond(
      c,
      movedTrackSchema,
      await moveTrackToProject(
        c.req.valid("param").id,
        c.req.valid("json").projectId,
        c.get("user").id
      )
    )
);

export default app;
