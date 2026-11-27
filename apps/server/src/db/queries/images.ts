import { and, asc, count, eq, inArray, isNotNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { basename } from "node:path";
import { z } from "zod";
import {
  ensureVariantKey,
  removeVariants,
  VARIANT_WIDTHS,
} from "../../lib/images.js";
import { errorFields, log } from "../../lib/log.js";
import { extractPalette } from "../../lib/palette.js";
import {
  newStorageKey,
  removeStoredFile,
  storageExtension,
  storeBytes,
  storedFileExists,
  storeUpload,
} from "../../lib/storage.js";
import { ENTITIES, entityModules } from "../../entities/index.js";
import type { EntityKind } from "../../entities/types.js";
import { db } from "../index.js";
import {
  imageSchema,
  type Image,
  type ImageScope,
  images,
  type NewImage,
} from "../schema/images.js";
import type { Job } from "../schema/jobs.js";
import { assertInProject, projectScope, type Scope } from "./authorization.js";
import {
  enqueueJobsOnce,
  labelsBySubject,
  registerJobHandler,
} from "./jobs.js";
import { offsetOf, pageResponseSchema } from "./pagination.js";
import {
  addUsage,
  assertStorageAllows,
  scopesOf,
  subtractUsage,
} from "./storage-usage.js";

const logger = log("images");

export const imageUploadResultSchema = imageSchema.extend({
  variantsJobId: z.number().nullable(),
});

type IngestImageSource =
  | {
      kind: "staged";
      tempPath: string;
      name: string;
      type: string;
      size: number;
    }
  | {
      kind: "bytes";
      bytes: Uint8Array;
      name: string;
      type: string;
    };

type IngestImageOwner = {
  scope: ImageScope;
  projectId: number | null;
  userId: string | null;
};

/**
 * Stores an image (from a staged upload or in-memory bytes) into the active
 * storage backend, extracts its accent palette, inserts its `images` row,
 * updates storage counters, and queues pre-generated resize variants.
 *
 * Every path that puts an image into the instance — multipart uploads, URL
 * imports, MCP cover tools and backfills — goes through here so none can skip
 * palette extraction, storage limits or variants.
 */
export async function ingestImage(
  source: IngestImageSource,
  owner: IngestImageOwner
): Promise<Image & { variantsJobId: number | null }> {
  const size = source.kind === "staged" ? source.size : source.bytes.byteLength;
  const scopes = scopesOf({ projectId: owner.projectId, userId: owner.userId });

  // Refused before the bytes are written rather than after the row: an upload
  // that will not be allowed to stay should never reach storage.
  await assertStorageAllows(scopes, size);

  const palette = await extractPalette(
    source.kind === "staged" ? source.tempPath : Buffer.from(source.bytes)
  ).catch((error) => {
    logger.error("palette extraction failed", errorFields(error));
    return null;
  });

  // The write is awaited and its failure propagates: a row pointing at a file
  // that was never written would serve a 404.
  let imagePath: string;
  if (source.kind === "staged") {
    imagePath = await storeUpload("images", {
      tempPath: source.tempPath,
      name: source.name,
      type: source.type,
    });
  } else {
    imagePath = newStorageKey(
      "images",
      storageExtension(source.name, source.type)
    );
    await storeBytes(imagePath, source.bytes, source.type || undefined);
  }

  const image = await createImage({
    assetPath: imagePath,
    name: basename(source.name),
    size,
    type: source.type,
    createdByUser: owner.userId,
    projectId: owner.projectId,
    scope: owner.scope,
    accentHue: palette?.accentHue ?? null,
    accentChroma: palette?.accentChroma ?? null,
    accentHex: palette?.accentHex ?? null,
  }).catch(async (error) => {
    await removeStoredFile(imagePath);
    throw error;
  });

  await addUsage(db, scopes, image.size);

  // The resizes are pre-generated so the first render is a cache hit, but the
  // image is already stored and readable: a queue that will not take the work
  // is not a failed upload, and the static handler resizes on demand anyway.
  const variantsJob = await enqueueImageVariants(
    image,
    owner.userId ?? undefined
  ).catch((error) => {
    logger.error("failed to queue image variants", {
      imageId: image.id,
      ...errorFields(error),
    });
    return undefined;
  });

  return { ...image, variantsJobId: variantsJob?.id ?? null };
}

async function createImage(image: NewImage) {
  const [result] = await db.insert(images).values(image).returning();
  if (!result) throw new Error(`Failed to create image: ${image}`);

  return result;
}

export async function getImage(imageId: number) {
  const [result] = await db.select().from(images).where(eq(images.id, imageId));
  if (!result) throw new HTTPException(404);

  return result;
}

/** The pool, or a transaction on it: what an image's removal reads and writes. */
type ImageDatabase = Pick<typeof db, "select" | "delete" | "execute">;

export async function deleteImage(id: number, database: ImageDatabase = db) {
  const [result] = await database
    .delete(images)
    .where(eq(images.id, id))
    .returning();

  if (!result) throw new HTTPException(404);

  return result;
}

/**
 * Deletes an image the way every owner of one must: the row, then its bytes off
 * the storage counters (the resizes go with the original), then its files. The
 * row goes first and the bytes second: a failed unlink leaves an orphan the
 * static handler already refuses to serve, whereas rolling the delete back over
 * it would resurrect the image.
 */
export async function removeImage(
  id: number,
  database: ImageDatabase = db
): Promise<void> {
  const result = await deleteImage(id, database);

  await subtractUsage(
    database,
    scopesOf({ projectId: result.projectId, userId: result.createdByUser }),
    result.size + result.variantBytes
  );

  await removeStoredFile(result.assetPath);
  await removeVariants(result.assetPath);
}

/**
 * How many times {@link removeUserImages} looks again for avatars uploaded
 * while it was removing the ones it found.
 */
const USER_IMAGE_SWEEPS = 5;

/**
 * Removes every image the account owns outright (its avatars), through
 * {@link removeImage}. Images it uploaded to a project belong to that project
 * and stay.
 *
 * The account can still act through another session while it is being
 * deleted (Better Auth revokes them only after the `users` row goes): an
 * avatar that session deletes first is already gone and skipped, and one it
 * uploads meanwhile is found by looking again until a look finds none.
 */
export async function removeUserImages(
  userId: string,
  database: ImageDatabase = db
): Promise<void> {
  for (let sweep = 0; sweep < USER_IMAGE_SWEEPS; sweep++) {
    const owned = await database
      .select({ id: images.id })
      .from(images)
      .where(and(eq(images.scope, "user"), eq(images.createdByUser, userId)));
    if (owned.length === 0) return;

    for (const { id } of owned) {
      try {
        await removeImage(id, database);
      } catch (error) {
        if (error instanceof HTTPException && error.status === 404) continue;
        throw error;
      }
    }
  }
}

/**
 * Resolver for `authorizeProject`. A project-scoped image carries its project
 * id and is gated on membership there. A user-scoped one — an avatar —
 * belongs to no project, so it is gated on ownership instead: only its
 * uploader may change or delete it, which `authorizeProject`'s `user` branch
 * enforces the same way a `project` scope enforces membership.
 */
export async function projectIdForImage(imageId: number): Promise<Scope> {
  if (Number.isNaN(imageId)) return null;
  const [row] = await db
    .select({
      projectId: images.projectId,
      scope: images.scope,
      createdByUser: images.createdByUser,
    })
    .from(images)
    .where(eq(images.id, imageId));
  if (!row) return null;

  // `images_scope_owner` guarantees `createdByUser` is set whenever `scope`
  // is `"user"`.
  if (row.scope === "user") return { kind: "user", id: row.createdByUser! };
  // The instance's own branding: anyone signed in reads the row, and only an
  // instance admin changes or deletes it.
  if (row.scope === "instance") return { kind: "instance" };

  return projectScope(row.projectId);
}

/**
 * The stored key of each instance image among `ids`, by id: where the static
 * route serves it to anyone. An id that names no image, or an image of
 * another scope, is absent.
 */
export async function instanceImagePaths(
  ids: readonly number[]
): Promise<Map<number, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: images.id, assetPath: images.assetPath })
    .from(images)
    .where(and(inArray(images.id, [...ids]), eq(images.scope, "instance")));
  return new Map(rows.map(({ id, assetPath }) => [id, assetPath]));
}

export async function getImagesFromUser(userId: string) {
  return db.select().from(images).where(eq(images.createdByUser, userId));
}

/** The one page of a project's images `GET /images/project/:projectId` answers. */
export const projectImagesPageSchema = pageResponseSchema(imageSchema);

/**
 * A page of a project's images, ordered by id. Avatars carry no project id
 * and so never match `where`, the same guard the unpaged listing used.
 */
export async function getImagesInProject(
  projectId: number,
  page: number,
  pageSize: number
): Promise<z.infer<typeof projectImagesPageSchema>> {
  const where = eq(images.projectId, projectId);

  const [rows, [total]] = await Promise.all([
    db
      .select()
      .from(images)
      .where(where)
      .orderBy(asc(images.id))
      .limit(pageSize)
      .offset(offsetOf(page, pageSize)),
    db.select({ value: count() }).from(images).where(where),
  ]);

  return { rows, rowCount: total?.value ?? 0, page, pageSize };
}

/** The entities an image can be pinned to, as the registry reports them. */
export function imageParentKinds(): [EntityKind, ...EntityKind[]] {
  const kinds = entityModules()
    .filter((m) => m.image)
    .map((m) => m.kind);
  return kinds as [EntityKind, ...EntityKind[]];
}

/**
 * The module for a parent kind, with its cover column. A kind that carries no
 * cover never reaches here — the route's enum is built from the same list.
 */
function imageParent(kind: EntityKind) {
  const module = ENTITIES[kind];
  if (!module.image) {
    throw new HTTPException(400, { message: `A ${kind} carries no cover` });
  }
  return module as typeof module & { image: NonNullable<typeof module.image> };
}

export async function setImageOnParent(
  imageId: number,
  kind: EntityKind,
  parentId: number,
  projectId: number
): Promise<Image> {
  const parent = imageParent(kind);
  await assertInProject(images, [imageId], projectId, "Image");
  await parent.assertInProject([parentId], projectId, "Parent");

  const [image] = await db.select().from(images).where(eq(images.id, imageId));
  if (!image) throw new HTTPException(404, { message: "Image not found" });

  // The parent stores the image's own key, so the artwork lookups match the
  // two columns against each other directly.
  const updated = await parent.image.set(parentId, image.assetPath);
  if (!updated) throw new HTTPException(404, { message: "Parent not found" });

  return image;
}

export async function removeImageFromParent(
  kind: EntityKind,
  parentId: number,
  projectId: number
): Promise<void> {
  const parent = imageParent(kind);
  await parent.assertInProject([parentId], projectId, "Parent");

  const updated = await parent.image.set(parentId, null);
  if (!updated) throw new HTTPException(404, { message: "Parent not found" });
}
/**
 * Queues the resizes for a freshly uploaded image so the first render is a
 * cache hit rather than a sharp call inside a request.
 *
 * A job belongs to a project, and an avatar has none, so avatars are left to
 * the static handler's on-demand path — there is one per user and it is
 * requested moments after upload anyway.
 */
async function enqueueImageVariants(
  image: Image,
  createdBy?: string
): Promise<Job | undefined> {
  if (image.projectId == null) return undefined;

  const [job] = await enqueueJobsOnce(
    "image_variants",
    [{ subjectId: image.id, projectId: image.projectId }],
    createdBy
  );

  return job;
}

/**
 * The outstanding-work finder for `image_variants`: every project-scoped image
 * that is not marked as fully resized. An avatar has no project and is resized
 * on demand instead, so it is excluded here rather than queued for a job nobody
 * would read.
 *
 * `variantsReady` is the answer rather than four `exists()` calls per image at
 * every boot; the storage audit, which walks the whole static root anyway, is
 * what corrects the column against disk. Only the original is still stat'd, and
 * only for the few images the column leaves outstanding: one whose original is
 * gone can never be resized, so it is not outstanding work.
 */
async function findOutstandingImageVariants() {
  const rows = await db
    .select({
      id: images.id,
      projectId: images.projectId,
      assetPath: images.assetPath,
    })
    .from(images)
    .where(and(isNotNull(images.projectId), eq(images.variantsReady, false)));

  const subjects: { subjectId: number; projectId: number }[] = [];
  await Promise.all(
    rows.map(async (row) => {
      if (row.projectId == null) return;
      if (!(await storedFileExists(row.assetPath))) return;
      subjects.push({ subjectId: row.id, projectId: row.projectId });
    })
  );
  return subjects;
}

async function imageNames(ids: number[]): Promise<Map<number, string>> {
  const rows = await db
    .select({ id: images.id, name: images.name })
    .from(images)
    .where(inArray(images.id, ids));
  return new Map(rows.map((image) => [image.id, image.name]));
}

registerJobHandler(
  "image_variants",
  async (job, report) => {
    if (job.subjectId == null) throw new Error("job names no image");

    const image = await getImage(job.subjectId);

    for (const [index, width] of VARIANT_WIDTHS.entries()) {
      await ensureVariantKey(image.assetPath, width);
      await report.progress((index + 1) / VARIANT_WIDTHS.length);
    }

    await db
      .update(images)
      .set({ variantsReady: true })
      .where(eq(images.id, image.id));

    return { widths: [...VARIANT_WIDTHS] };
  },
  {
    label: "Resizing image",
    outstanding: findOutstandingImageVariants,
    subjectLabels: labelsBySubject(imageNames),
  }
);
