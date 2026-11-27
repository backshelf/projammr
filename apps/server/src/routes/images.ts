import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { AuthedEnv } from "../auth.js";
import {
  getImage,
  getImagesInProject,
  imageParentKinds,
  imageUploadResultSchema,
  ingestImage,
  projectImagesPageSchema,
  removeImage,
  removeImageFromParent,
  setImageOnParent,
} from "../db/queries/images.js";
import { paginationQuerySchema } from "../db/queries/pagination.js";
import { imageSchema } from "../db/schema/images.js";
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
import { multipartRequestBody } from "../lib/multipart.js";
import {
  requireUploadedFile,
  streamMultipartUpload,
} from "../lib/multipart-stream.js";
import { fetchRemoteImage } from "../lib/remote-image.js";
import { gatedProject } from "../middleware/authorize-project.js";

const { describe, describeRaw, route } = describer("Images");

const app = new Hono<AuthedEnv>({ strict: false });

/** The paging vocabulary the project image listing takes: page and size only. */
const imagesPageQuerySchema = paginationQuerySchema.pick({
  page: true,
  pageSize: true,
});

const imageUploadFormSchema = z.object({
  file: z.file(),
  projectId: z.optional(z.coerce.number()),
});
const imageUploadFieldsSchema = imageUploadFormSchema.omit({ file: true });
const instanceImageUploadFormSchema = z.object({ file: z.file() });
const imageImportBodySchema = z.object({
  url: z.url(),
  projectId: z.number().int().optional(),
});

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
        await ingestImage(
          { kind: "staged", ...file },
          { ...owner, userId: c.get("user").id }
        ),
        201
      );
    } finally {
      await upload.cleanup();
    }
  }
);

app.post(
  "/import",
  describe(
    "Import an image from a public http(s) URL into storage, extracting its accent palette and queueing resize variants. Omit `projectId` for an avatar.",
    {
      status: 201,
      schema: imageUploadResultSchema,
      description: "Image imported successfully",
    },
    400,
    413,
    500
  ),
  validator("json", imageImportBodySchema),
  async (c) => {
    const { url, projectId } = c.req.valid("json");
    const remote = await fetchRemoteImage(url);
    const owner =
      projectId == null
        ? ({ scope: "user", projectId: null } as const)
        : ({ scope: "project", projectId } as const);
    return respond(
      c,
      imageUploadResultSchema,
      await ingestImage(remote, { ...owner, userId: c.get("user").id }),
      201
    );
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
        await ingestImage(
          { kind: "staged", ...file },
          { scope: "instance", projectId: null, userId: c.get("user").id }
        ),
        201
      );
    } finally {
      await upload.cleanup();
    }
  }
);

const imageParentKindSchema = z.enum(imageParentKinds());

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
