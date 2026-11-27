import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  getImagesInProject,
  imageParentKinds,
  imageUploadResultSchema,
  ingestImage,
  projectImagesPageSchema,
  removeImageFromParent,
  setImageOnParent,
} from "../../db/queries/images.js";
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from "../../db/queries/pagination.js";
import { fetchRemoteImage } from "../../lib/remote-image.js";
import { spendToken } from "../../middleware/rate-limit.js";
import { requireEntity, requireProject } from "../authorize.js";
import { defineTool, type AnyToolSpec } from "../spec.js";

const coverKindSchema = z.enum(imageParentKinds());

const listImagesTool = defineTool({
  name: "list_images",
  title: "List images",
  description:
    "Lists the images stored in a project (each with its id, assetPath, " +
    "accent palette and dimensions of variants readiness), paged. Use an " +
    "image's `id` with `set_cover` to reuse existing artwork across entities " +
    "without re-uploading it.",
  scope: "read",
  input: z.object({
    projectId: z.number().int(),
    page: z.number().int().min(1).optional(),
    pageSize: z.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
  }),
  output: projectImagesPageSchema,
  run: async (actor, { projectId, page, pageSize }) => {
    await requireProject(actor, projectId, "viewer");
    return getImagesInProject(
      projectId,
      page ?? 1,
      pageSize ?? DEFAULT_PAGE_SIZE
    );
  },
});

const setCoverTool = defineTool({
  name: "set_cover",
  title: "Set cover",
  description:
    "Sets the cover artwork of a project, collection or track. Pass either " +
    "`url` (a public http(s) image URL that the server fetches, stores in " +
    "project storage, extracts accent colours from and queues resize variants " +
    "for) or `imageId` (an existing image already stored in the same project).",
  scope: "write",
  input: z.object({
    kind: coverKindSchema,
    id: z.number().int(),
    url: z
      .url()
      .optional()
      .describe(
        "Public http(s) URL of an image to fetch into project storage and set as cover."
      ),
    imageId: z
      .number()
      .int()
      .optional()
      .describe("ID of an existing image in this project to reuse as cover."),
  }),
  output: imageUploadResultSchema,
  run: async (actor, { kind, id, url, imageId }) => {
    if ((url != null) === (imageId != null)) {
      throw new HTTPException(400, {
        message: "Provide either url or imageId, not both",
      });
    }

    const gate = await requireEntity(actor, kind, id, "editor");

    if (url != null) {
      spendToken("image-upload", actor.id);
      const remote = await fetchRemoteImage(url);
      const uploaded = await ingestImage(remote, {
        scope: "project",
        projectId: gate.projectId,
        userId: actor.id,
      });
      const image = await setImageOnParent(
        uploaded.id,
        kind,
        id,
        gate.projectId
      );
      return { ...image, variantsJobId: uploaded.variantsJobId };
    }

    const image = await setImageOnParent(imageId!, kind, id, gate.projectId);
    return { ...image, variantsJobId: null };
  },
});

const removeCoverTool = defineTool({
  name: "remove_cover",
  title: "Remove cover",
  description:
    "Removes the cover artwork from a project, collection or track. The " +
    "stored image row itself is kept in the project.",
  scope: "write",
  destructive: true,
  idempotent: true,
  input: z.object({
    kind: coverKindSchema,
    id: z.number().int(),
  }),
  output: z.object({ removed: z.literal(true) }),
  run: async (actor, { kind, id }) => {
    const gate = await requireEntity(actor, kind, id, "editor");
    await removeImageFromParent(kind, id, gate.projectId);
    return { removed: true as const };
  },
});

/** Cover artwork tools: listing stored images, importing/pinning covers, and clearing them. */
export const IMAGE_TOOLS: AnyToolSpec[] = [
  listImagesTool,
  setCoverTool,
  removeCoverTool,
];
