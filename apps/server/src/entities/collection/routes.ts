import { Hono } from "hono";
import { z } from "zod";
import type { AuthedEnv } from "../../auth.js";
import { assertInProject } from "../../db/queries/authorization.js";
import {
  moveCollectionToProject,
  movedRowSchema,
  moveEntitySchema,
} from "../../db/queries/move.js";
import { calculateStatus } from "../../db/queries/statuses.js";
import {
  getCollectionAudioSummary,
  getCollectionRuntimeMs,
} from "../../db/queries/track-audios.js";
import {
  collectionSchema,
  collectionTrackSchema,
  newCollectionTrackSchema,
} from "../../db/schema/collections.js";
import { tracks } from "../../db/schema/tracks.js";
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
import { collection } from "./index.js";
import {
  addedCountSchema,
  addTracksToCollectionSchema,
  addTrackToCollection,
  bulkAddTracksToCollection,
  collectionPrimaryAudiosQuerySchema,
  collectionPrimaryAudiosSchema,
  collectionTrackSummarySchema,
  getCollectionPrimaryAudios,
  getCollectionTrackSummaries,
  getTracksInCollection,
  removeTrackFromCollection,
  trackNumberSchema,
  tracksInCollectionSchema,
  updateTrackNumberInCollection,
} from "./queries.js";

const { describe, describeRaw } = describer(entityTag(collection));

const app = new Hono<AuthedEnv>();

const movedCollectionSchema = movedRowSchema(collectionSchema);

const collectionLoudnessSchema = z.object({
  min: z.number(),
  max: z.number(),
  median: z.number(),
  measured: z.number(),
  total: z.number(),
  tracks: z.array(
    z.object({ id: z.number(), title: z.string(), lufs: z.number() })
  ),
});

const collectionSpectrumSchema = z.object({
  hz: z.array(z.number()),
  mean: z.array(z.number()),
  min: z.array(z.number()),
  max: z.array(z.number()),
  measured: z.number(),
  total: z.number(),
});

const collectionTempoSchema = z.object({
  min: z.number(),
  max: z.number(),
  median: z.number(),
  measured: z.number(),
  tracks: z.array(
    z.object({ id: z.number(), title: z.string(), bpm: z.number() })
  ),
});

const collectionKeySchema = z.object({
  id: z.number(),
  title: z.string(),
  key: z.string(),
});

const collectionStatusSchema = z.object({
  totalStatus: z.number(),
  /** Summed playing time of the tracks' primary audio, in ms. */
  runtimeMs: z.number(),
  /**
   * False while a primary audio is still being analysed, so the runtime above
   * is a partial sum rather than the whole.
   */
  runtimeComplete: z.boolean(),
  /** Tracks in the collection, and how many have finished. */
  trackCount: z.number(),
  completeTrackCount: z.number(),
  /** Loudness spread of the tracks' primary audio, or null until measured. */
  loudness: collectionLoudnessSchema.nullable(),
  /** Spectral envelope of the tracks' primary audio, or null until measured. */
  spectrum: collectionSpectrumSchema.nullable(),
  /** Tempo spread of the tracks' primary audio, or null until measured. */
  tempo: collectionTempoSchema.nullable(),
  /** Every track with a detected key, one dot per track on the circle of
   *  fifths rather than an aggregated count. */
  keys: z.array(collectionKeySchema),
});

app.get(
  "/:id/status",
  describe(
    "Get a collection's full status. Includes the real status, based on its tracks' statuses.",
    {
      schema: collectionStatusSchema,
      description: "Collection fetched successfully",
    },
    400,
    404
  ),
  idParam(),
  async (c) => {
    const { id } = c.req.valid("param");
    // A collection that does not exist never reaches here — `authorizeProject`
    // 404s on an unresolvable id — so there is nothing to null-check.
    const [tracksInCollection, runtime, audio] = await Promise.all([
      getTracksInCollection(id),
      getCollectionRuntimeMs(id),
      getCollectionAudioSummary(id),
    ]);

    return respond(c, collectionStatusSchema, {
      totalStatus: calculateStatus(tracksInCollection),
      runtimeMs: runtime.runtimeMs,
      runtimeComplete: runtime.complete,
      trackCount: tracksInCollection.length,
      completeTrackCount: tracksInCollection.filter(
        (track) => track.status?.percentage === 100
      ).length,
      ...audio,
    });
  }
);

app.get(
  "/:id/tracks/summary",
  describe(
    "Get a collection's track summaries. Each is an id, title, track " +
      "number and artwork — the shape the sidebar reads.",
    {
      schema: collectionTrackSummarySchema,
      description: "Track summaries fetched successfully",
    },
    400,
    404
  ),
  idParam(),
  async (c) =>
    respond(
      c,
      collectionTrackSummarySchema,
      await getCollectionTrackSummaries(c.req.valid("param").id)
    )
);

app.get(
  "/:id/tracks",
  describe(
    "Get tracks in a collection",
    {
      schema: tracksInCollectionSchema,
      description: "Tracks fetched successfully",
    },
    400,
    404
  ),
  idParam(),
  async (c) =>
    respond(
      c,
      tracksInCollectionSchema,
      await getTracksInCollection(c.req.valid("param").id)
    )
);

app.patch(
  "/:id/tracks/:trackId/number",
  describe(
    "Update a single track's number in a collection. Swaps on conflict.",
    {
      schema: tracksInCollectionSchema,
      description: "Track number updated successfully",
    },
    400,
    404
  ),
  idParams("id", "trackId"),
  validator("json", trackNumberSchema),
  async (c) => {
    const { id, trackId } = c.req.valid("param");
    const { trackNumber } = c.req.valid("json");

    await updateTrackNumberInCollection(
      id,
      trackId,
      trackNumber,
      c.get("user").id
    );

    return respond(
      c,
      tracksInCollectionSchema,
      await getTracksInCollection(id)
    );
  }
);

app.post(
  "/:id/tracks/bulk",
  describe(
    "Add many tracks to a collection at once",
    { schema: addedCountSchema, description: "Tracks added" },
    400,
    404
  ),
  idParam(),
  validator("json", addTracksToCollectionSchema),
  async (c) => {
    const { trackIds } = c.req.valid("json");
    await assertInProject(tracks, trackIds, gatedProject(c), "Track");

    return respond(
      c,
      addedCountSchema,
      await bulkAddTracksToCollection(
        c.req.valid("param").id,
        trackIds,
        c.get("user").id
      )
    );
  }
);

app.post(
  "/:id/tracks",
  describe(
    "Add track to a collection",
    {
      schema: collectionTrackSchema,
      description: "Track added successfully",
    },
    400,
    404,
    409
  ),
  idParam(),
  validator("json", newCollectionTrackSchema.omit({ collectionId: true })),
  async (c) => {
    const { trackId, trackNumber } = c.req.valid("json");
    await assertInProject(tracks, [trackId], gatedProject(c), "Track");

    return respond(
      c,
      collectionTrackSchema,
      await addTrackToCollection(
        trackId,
        c.req.valid("param").id,
        c.get("user").id,
        trackNumber || undefined
      )
    );
  }
);

app.delete(
  "/:id/tracks/:trackId",
  describeRaw(
    "Remove track from a collection",
    { status: 204, description: "Track removed" },
    400,
    404
  ),
  idParams("id", "trackId"),
  async (c) => {
    const { id, trackId } = c.req.valid("param");
    await removeTrackFromCollection(id, trackId, c.get("user").id);
    return c.body(null, 204);
  }
);

app.get(
  "/:id/audios/primary",
  describe(
    "One audio per track in a collection. In track-number order; `version` " +
      "`primary` (the default) picks each track's primary, else its " +
      "highest-numbered version, and `latest` picks the highest-numbered. " +
      "Tracks without audio are omitted.",
    {
      schema: collectionPrimaryAudiosSchema,
      description: "Audios fetched successfully",
    },
    400,
    404
  ),
  idParam(),
  validator("query", collectionPrimaryAudiosQuerySchema),
  async (c) =>
    respond(
      c,
      collectionPrimaryAudiosSchema,
      await getCollectionPrimaryAudios(
        c.req.valid("param").id,
        c.req.valid("query").version
      )
    )
);

app.on("POST", "/:id/move", moveRateLimit);

app.post(
  "/:id/move",
  describe(
    "Move a collection into another project. The tracks no other " +
      "collection in the source project holds move with it. A shared track stays " +
      "and is dropped from the collection. Custom values, the moving " +
      "tracks' included, carry onto the target's field of the same name " +
      "and type; `droppedFields` names the rest. A priority level the " +
      "target's scale has no level of that name for becomes the target's " +
      "default, listed in `priorityFallbacks`. The caller must be an " +
      "editor in both projects.",
    { schema: movedCollectionSchema, description: "Collection moved" },
    400,
    404
  ),
  idParam(),
  validator("json", moveEntitySchema),
  async (c) =>
    respond(
      c,
      movedCollectionSchema,
      await moveCollectionToProject(
        c.req.valid("param").id,
        c.req.valid("json").projectId,
        c.get("user").id
      )
    )
);

export default app;
