import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { basename } from "node:path";
import { z } from "zod";
import type { AuthedEnv } from "../auth.js";
import {
  createImage,
  enqueueImageVariants,
  getImage,
  getImagesInProject,
  projectImagesPageSchema,
  removeImage,
  removeImageFromParent,
  setImageOnParent,
} from "../db/queries/images.js";
import { paginationQuerySchema } from "../db/queries/pagination.js";
import {
  addUsage,
  assertStorageAllows,
  scopesOf,
} from "../db/queries/storage-usage.js";
import { db } from "../db/index.js";
import { imageSchema, type ImageScope } from "../db/schema/images.js";
import {
  describer,
  errors,
  idParam,
  idParams,
  idValue,
  json,
  params,
  parseRequest,
  respond,
  validator,
} from "../lib/http.js";
import { errorFields, log } from "../lib/log.js";
import { multipartRequestBody } from "../lib/multipart.js";
import {
  requireUploadedFile,
  type StreamedFile,
  streamMultipartUpload,
} from "../lib/multipart-stream.js";
import { extractPalette } from "../lib/palette.js";
import { removeStoredFile, storeUpload } from "../lib/storage.js";
import { gatedProject } from "../middleware/authorize-project.js";

const { describe, describeRaw, route } = describer("Images");

const app = new Hono<AuthedEnv>({ strict: false });

const logger = log("images");

/** The paging vocabulary the project image listing takes: page and size only. */
const imagesPageQuerySchema = paginationQuerySchema.pick({
  page: true,
  pageSize: true,
});
const imageUploadResultSchema = imageSchema.extend({
  variantsJobId: z.number().nullable(),
});

const imageUploadFormSchema = z.object({
  file: z.file(),
  projectId: z.optional(z.coerce.number()),
});
const imageUploadFieldsSchema = imageUploadFormSchema.omit({ file: true });
const instanceImageUploadFormSchema = z.object({ file: z.file() });

/**
 * Stores an uploaded image and its row, with the scope and project the route
 * derived rather than any the client named: the scope is what the static
 * handler reads to decide who may have the bytes. The bytes count towards the
 * project, when there is one, and the uploader.
 */
async function acceptImage(
  c: Context<AuthedEnv>,
  file: StreamedFile,
  owner: { scope: ImageScope; projectId: number | null }
) {
  const user = c.get("user");
  const scopes = scopesOf({ projectId: owner.projectId, userId: user.id });

  // Refused before the bytes are written rather than after the row: an
  // upload that will not be allowed to stay should never reach storage.
  await assertStorageAllows(scopes, file.size);

  // Read the staged file before `storeUpload` moves it into place on local storage.
  const palette = await extractPalette(file.tempPath).catch((e) => {
    logger.error("palette extraction failed", errorFields(e));
    return null;
  });

  // The write is awaited and its failure is allowed to reach `app.onError`:
  // a row pointing at a file that was never written would report an upload
  // that did not happen, and the static handler would serve a 404 for it.
  const imagePath = await storeUpload("images", file);

  const image = await createImage({
    assetPath: imagePath,
    name: basename(file.name),
    size: file.size,
    type: file.type,
    createdByUser: user.id,
    projectId: owner.projectId,
    scope: owner.scope,
    accentHue: palette?.accentHue ?? null,
    accentChroma: palette?.accentChroma ?? null,
    accentHex: palette?.accentHex ?? null,
  }).catch(async (error) => {
    await removeStoredFile(imagePath);
    throw error;
  });

  // The counter follows the row rather than sharing its statement, so a
  // crash between the two leaves it low until the storage audit re-derives
  // it — the same repair that covers every other way it can drift.
  await addUsage(db, scopes, image.size);

  // The resizes are pre-generated so the first render is a cache hit, but the
  // image is already stored and readable: a queue that will not take the work
  // is not a failed upload, and the static handler resizes on demand anyway.
  const variantsJob = await enqueueImageVariants(image, user.id).catch(
    (error) => {
      logger.error("failed to queue image variants", {
        imageId: image.id,
        ...errorFields(error),
      });
      return undefined;
    }
  );

  return { ...image, variantsJobId: variantsJob?.id ?? null };
}

app.post(
  "/upload",
  route({
    description:
      "Upload a new image. `variantsJobId` is the id of the queued resize job, or null for an avatar, which has no project to run one in.",
    requestBody: multipartRequestBody(imageUploadFormSchema),
    responses: {
      201: json(imageUploadResultSchema, "Image uploaded successfully"),
      ...errors(400, 413, 500),
    },
  }),
  async (c) => {
    const upload = await streamMultipartUpload(c, {
      acceptedTypes: (policy) => policy.limits.imageTypes,
    });
    try {
      const file = requireUploadedFile(upload);
      const { projectId } = parseRequest(
        imageUploadFieldsSchema,
        upload.fields
      );
      // An upload with no project is an avatar, readable by any signed-in user.
      const owner =
        projectId == null
          ? ({ scope: "user", projectId: null } as const)
          : ({ scope: "project", projectId } as const);
      return respond(
        c,
        imageUploadResultSchema,
        await acceptImage(c, file, owner),
        201
      );
    } finally {
      await upload.cleanup();
    }
  }
);

app.post(
  "/instance",
  route({
    description:
      "Upload a brand image, the instance's logo or app icon. An instance admin's alone, it is readable by anyone at its static URL, signed in or not. It counts towards the uploader's storage, as an avatar does, and has no resize job (`variantsJobId` is null); its resizes are made on demand.",
    requestBody: multipartRequestBody(instanceImageUploadFormSchema),
    responses: {
      201: json(imageUploadResultSchema, "Image uploaded successfully"),
      ...errors(400, 404, 413, 500),
    },
  }),
  async (c) => {
    const upload = await streamMultipartUpload(c, {
      acceptedTypes: (policy) => policy.limits.imageTypes,
    });
    try {
      const file = requireUploadedFile(upload);
      return respond(
        c,
        imageUploadResultSchema,
        await acceptImage(c, file, { scope: "instance", projectId: null }),
        201
      );
    } finally {
      await upload.cleanup();
    }
  }
);

const imageParentKindSchema = z.enum(["project", "collection", "track"]);

app.put(
  "/parent/:kind/:parentId",
  describe(
    "Set the image of a project, collection or track",
    { schema: imageSchema, description: "Image set successfully" },
    400,
    404
  ),
  params({ kind: imageParentKindSchema, parentId: idValue }),
  validator("json", z.object({ imageId: z.coerce.number() })),
  async (c) => {
    const { kind, parentId } = c.req.valid("param");
    const { imageId } = c.req.valid("json");
    return respond(
      c,
      imageSchema,
      await setImageOnParent(imageId, kind, parentId, gatedProject(c))
    );
  }
);

app.delete(
  "/parent/:kind/:parentId",
  describeRaw(
    "Remove the image from a project, collection or track",
    { status: 204, description: "Image removed" },
    400,
    404
  ),
  params({ kind: imageParentKindSchema, parentId: idValue }),
  async (c) => {
    const { kind, parentId } = c.req.valid("param");

    await removeImageFromParent(kind, parentId, gatedProject(c));

    return c.body(null, 204);
  }
);

app.get(
  "/project/:projectId",
  describe(
    "A project's images, paged.",
    {
      schema: projectImagesPageSchema,
      description: "One page of the project's images",
    },
    400
  ),
  idParams("projectId"),
  validator("query", imagesPageQuerySchema),
  async (c) => {
    const { projectId } = c.req.valid("param");
    const { page, pageSize } = c.req.valid("query");
    return respond(
      c,
      projectImagesPageSchema,
      await getImagesInProject(projectId, page, pageSize)
    );
  }
);

app.get(
  "/:id",
  describe(
    "Get a single image by ID",
    { schema: imageSchema, description: "Successfully retrieved image" },
    400,
    404
  ),
  idParam(),
  async (c) => {
    const result = await getImage(c.req.valid("param").id);
    if (!result) throw new HTTPException(404, { message: "Image not found" });
    return respond(c, imageSchema, result);
  }
);

app.delete(
  "/:id",
  describeRaw(
    "Delete an image",
    { status: 204, description: "Image deleted" },
    400,
    404
  ),
  idParam(),
  async (c) => {
    await removeImage(c.req.valid("param").id);

    return c.body(null, 204);
  }
);

export default app;
