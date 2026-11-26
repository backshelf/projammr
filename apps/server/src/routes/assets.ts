import { AUDIO_EXTENSIONS } from "@workspace/settings/groups/instance-limits";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { basename } from "node:path";
import { z } from "zod";
import type { AuthedEnv } from "../auth.js";
import {
  createAsset,
  deleteAsset,
  deleteAssetsInProject,
  duplicateGroupsSchema,
  enqueueAssetConversion,
  findAssetsByFingerprint,
  findDuplicateAudio,
  getAsset,
  getAssetsInProjectWithContext,
  projectAssetsPageSchema,
  removeDuplicateAudio,
} from "../db/queries/assets.js";
import {
  bulkDeletedSchema,
  paginationQuerySchema,
} from "../db/queries/pagination.js";
import { assertStorageAllows, scopesOf } from "../db/queries/storage-usage.js";
import { spectrogramKeysForAsset } from "../db/queries/track-audios.js";
import {
  assetFingerprintMatchSchema,
  assetSchema,
} from "../db/schema/assets.js";
import { queuedJobSchema } from "../db/schema/jobs.js";
import {
  describer,
  idParam,
  idParams,
  respond,
  validator,
} from "../lib/http.js";
import { instancePolicy } from "../lib/instance-policy.js";
import {
  AUDIO_SIGNATURE_BYTES,
  audioExtensionOf,
  hasAudioSignature,
  isAudioName,
} from "../lib/media.js";
import { declaredFileType, uploadedFile } from "../lib/multipart.js";
import { removeStoredFile, storeUpload } from "../lib/storage.js";
import { gatedProject } from "../middleware/authorize-project.js";

const { describe, describeRaw } = describer("Assets");

const app = new Hono<AuthedEnv>({ strict: false });

const fingerprintMatchesSchema = z.array(assetFingerprintMatchSchema);

/** The paging vocabulary the project asset listing takes: page, size, name filter and sort. */
const assetsPageQuerySchema = paginationQuerySchema.pick({
  page: true,
  pageSize: true,
  q: true,
  sort: true,
});

/** The files one bulk call may name. */
const assetIdsSchema = z.array(z.number().int().positive()).min(1).max(500);

app.post(
  "/upload",
  describe(
    "Upload a new asset",
    {
      status: 201,
      schema: assetSchema,
      description: "Asset uploaded successfully",
    },
    400,
    413,
    500
  ),
  validator(
    "form",
    z.object({
      file: uploadedFile(),
      projectId: z.coerce.number(),
      localFilepath: z.string().optional(),
      localFileCreatedAt: z.coerce.number().optional(),
      localFileUpdatedAt: z.coerce.number().optional(),
      localFileMachineName: z.string().optional(),
      fingerprint: z.string().optional(),
    })
  ),
  async (c) => {
    const body = c.req.valid("form");
    const { file, projectId } = body;

    // Any other file is an attachment, which the instance's audio types do
    // not govern.
    const audioType = audioExtensionOf(file.name);
    if (audioType && !instancePolicy().limits.audioTypes.includes(audioType)) {
      throw new HTTPException(400, {
        message: `This instance does not take ${audioType} uploads`,
      });
    }

    // Refused here rather than stored: a mislabelled file would otherwise be
    // listed as audio and fail every analysis without a word.
    const head = await file.slice(0, AUDIO_SIGNATURE_BYTES).bytes();
    if (audioType && !hasAudioSignature(head)) {
      throw new HTTPException(400, {
        message: "File has an audio extension but is not audio",
      });
    }

    // Refused before the bytes are written rather than after the row: an
    // upload that will not be allowed to stay should never reach the disk.
    await assertStorageAllows(
      scopesOf({ projectId, userId: c.get("user").id }),
      file.size
    );

    // The write is awaited and its failure is allowed to reach `app.onError`:
    // a row pointing at a file that was never written would report an upload
    // that did not happen, and the static handler would serve a 404 for it.
    const assetPath = await storeUpload("assets", file);

    const asset = await createAsset({
      assetPath: assetPath,
      // The upload's name is a display label; a path fragment in it must not
      // survive into a row that a download names the file from.
      name: basename(file.name),
      size: file.size,
      type: (await declaredFileType(c, "file")) ?? file.type,
      createdByUser: c.get("user").id,
      projectId,
      // ms epoch → timestamptz. Omitting undefined fields would make drizzle
      // apply the column defaults, so nulls are passed explicitly.
      localFileCreatedAt:
        body.localFileCreatedAt == null
          ? null
          : new Date(body.localFileCreatedAt),
      localFileUpdatedAt:
        body.localFileUpdatedAt == null
          ? null
          : new Date(body.localFileUpdatedAt),
      localFileMachineName: body.localFileMachineName ?? null,
      localFilepath: body.localFilepath ?? null,
      fingerprint: body.fingerprint ?? null,
    }).catch(async (error) => {
      await removeStoredFile(assetPath);
      throw error;
    });

    return respond(c, assetSchema, asset, 201);
  }
);

app.post(
  "/lookup",
  describe(
    "Find a project's assets by content fingerprint. The assets already " +
      "holding the given fingerprints, with the sessions each is attached " +
      "to. Takes a body " +
      "rather than a query string because a scan asks about hundreds of " +
      "fingerprints at once.",
    {
      schema: fingerprintMatchesSchema,
      description: "Matches for the fingerprints that are already uploaded",
    },
    400
  ),
  validator(
    "json",
    z.object({
      projectId: z.number(),
      fingerprints: z.array(z.string()),
    })
  ),
  async (c) => {
    const { projectId, fingerprints } = c.req.valid("json");
    return respond(
      c,
      fingerprintMatchesSchema,
      await findAssetsByFingerprint(projectId, fingerprints)
    );
  }
);

app.get(
  "/project/:projectId",
  describe(
    "A project's files, paged: `q` filters by name (case-insensitive), " +
      "`sort` takes `id`, `name`, `size` or `createdAt`.",
    {
      schema: projectAssetsPageSchema,
      description: "One page of the project's assets",
    },
    400
  ),
  idParams("projectId"),
  validator("query", assetsPageQuerySchema),
  async (c) => {
    const { projectId } = c.req.valid("param");
    const { page, pageSize, q, sort } = c.req.valid("query");
    return respond(
      c,
      projectAssetsPageSchema,
      await getAssetsInProjectWithContext(projectId, {
        page,
        pageSize,
        q,
        sort,
      })
    );
  }
);

app.get(
  "/project/:projectId/duplicates",
  describe(
    "A project's duplicate audio, grouped by bounce. A group is " +
      "uploaded audio from one machine, folder and name (`Song.wav` " +
      "beside `Song.mp3`) written within two minutes of each other. Its " +
      "largest file is kept; every other copy is listed in `remove`, or in " +
      "`skipped` when deleting it would lose an attachment, a track version " +
      "or comments.",
    {
      schema: duplicateGroupsSchema,
      description: "The duplicate groups, with what would go",
    },
    400
  ),
  idParams("projectId"),
  async (c) => {
    const { projectId } = c.req.valid("param");
    return respond(c, duplicateGroupsSchema, {
      groups: await findDuplicateAudio(projectId),
    });
  }
);

app.post(
  "/project/:projectId/duplicates/remove",
  describe(
    "Delete a project's removable duplicate audio. Only the copies the " +
      "audit lists in `remove` go; where one held its track's primary, the " +
      "kept file takes it first. An id the audit no longer lists there (the " +
      "files changed since it was read) is skipped: neither deleted nor " +
      "counted.",
    { schema: bulkDeletedSchema, description: "How many files were deleted" },
    400
  ),
  idParams("projectId"),
  validator("json", z.object({ ids: assetIdsSchema })),
  async (c) => {
    const { ids } = c.req.valid("json");
    const { deleted, storedKeys } = await removeDuplicateAudio(
      gatedProject(c),
      ids
    );

    // Unlinked after the commit, for the reason `DELETE /bulk` gives.
    for (const key of storedKeys) await removeStoredFile(key);

    return respond(c, bulkDeletedSchema, { deleted });
  }
);

// Registered before `/:id`, which matches `bulk` as well and would answer a
// 400 from its id validator before this handler ever ran.
app.delete(
  "/bulk",
  describe(
    "Delete several of a project's files at once. An id naming a file in " +
      "another project, or no file at all, is skipped: neither deleted nor " +
      "counted.",
    { schema: bulkDeletedSchema, description: "How many files were deleted" },
    400
  ),
  validator("json", z.object({ projectId: z.number(), ids: assetIdsSchema })),
  async (c) => {
    const { ids } = c.req.valid("json");
    const { deleted, storedKeys } = await deleteAssetsInProject(
      gatedProject(c),
      ids
    );

    // The rows go first and the bytes second, as the single delete does: a
    // failed unlink leaves orphans the static handler already refuses to
    // serve, whereas rolling the delete back over them would resurrect files
    // the caller was told were gone.
    for (const key of storedKeys) await removeStoredFile(key);

    return respond(c, bulkDeletedSchema, { deleted });
  }
);

app.get(
  "/:id",
  describe(
    "One asset, as its row: name, type, size, storage path and the local " +
      "file columns it was uploaded with.",
    { schema: assetSchema, description: "The asset" },
    400,
    404
  ),
  idParam(),
  async (c) => respond(c, assetSchema, await getAsset(c.req.valid("param").id))
);

app.delete(
  "/:id",
  describeRaw(
    "Delete an asset",
    { status: 204, description: "Asset deleted" },
    400,
    404
  ),
  idParam(),
  async (c) => {
    const id = c.req.valid("param").id;
    // Read before the delete cascades the asset's track-audio rows away —
    // once they are gone, nothing else names the spectrogram PNGs they wrote.
    const spectrogramKeys = await spectrogramKeysForAsset(id);
    const result = await deleteAsset(id);

    // The row goes first and the bytes second: a failed unlink leaves an
    // orphan the static handler already refuses to serve, whereas rolling the
    // delete back over it would resurrect the asset.
    await removeStoredFile(result.assetPath);
    for (const key of spectrogramKeys) await removeStoredFile(key);

    return c.body(null, 204);
  }
);

app.post(
  "/:id/convert",
  describe(
    "Queue a transcode of an audio asset. Responds with the job id as soon " +
      "as the work is queued; the output arrives as an asset of its own, and " +
      "GET /jobs/:id carries its id and URL once the job is done.",
    {
      status: 202,
      schema: queuedJobSchema,
      description: "Conversion queued",
    },
    400,
    404,
    413
  ),
  idParam(),
  validator(
    "json",
    z.object({
      format: z.enum(AUDIO_EXTENSIONS),
      kbps: z.number().min(1).max(320).optional(),
    })
  ),
  async (c) => {
    const asset = await getAsset(c.req.valid("param").id);
    if (!isAudioName(asset.name)) {
      throw new HTTPException(400, { message: "Asset is not audio" });
    }

    const body = c.req.valid("json");
    const job = await enqueueAssetConversion(
      asset,
      body.format,
      body.kbps,
      c.get("user").id
    );

    return respond(c, queuedJobSchema, { jobId: job.id }, 202);
  }
);

export default app;
