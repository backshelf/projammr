import { readFile } from "node:fs/promises";
import { Hono } from "hono";
import type { AuthedEnv } from "../auth.js";
import {
  acceptObjects,
  fetchObjectsBodySchema,
  heldObjects,
  missingObjects,
  missingObjectsBodySchema,
  missingObjectsSchema,
  objectsUploadedSchema,
} from "../db/queries/objects.js";
import {
  ApiError,
  describer,
  errors,
  idParam,
  json,
  respond,
  validator,
} from "../lib/http.js";
import { packRecordHeader, packRecords } from "../lib/object-pack.js";
import { objectKey, storedFilePath } from "../lib/storage.js";
import { streamOf } from "../lib/stream.js";

const { describe, describeRaw, route } = describer("Repos");

/**
 * How dit uploads a push's objects: it asks which the repo lacks, then sends
 * those in packs. `resolveRepoRoute` gates the `/repos` mount on the repo's
 * project, so an editor pushes and a non-member gets a 404. A pack is held to
 * the instance's upload limit rather than the fixed body cap, and must declare
 * its length (`packBodyLimit`, mounted in `app.ts` after the gate).
 */
export function repoObjectRoutes(): Hono<AuthedEnv> {
  const app = new Hono<AuthedEnv>({ strict: false });

  app.post(
    "/:id/objects/missing",
    describe(
      "Ask which objects to upload. `missing` is the given hashes the repo " +
        "holds no object for, in the order asked and without repeats. An " +
        "object another repo holds is claimed instead — linked into this " +
        "repo with no upload, and listed in `claimed` — when that repo's " +
        "project is one the caller is a member of; held only by a project " +
        "the caller is not in, it stays missing.",
      { schema: missingObjectsSchema, description: "The objects to upload" },
      400,
      403,
      404
    ),
    idParam(),
    validator("json", missingObjectsBodySchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const { hashes } = c.req.valid("json");
      return respond(
        c,
        missingObjectsSchema,
        await missingObjects(id, hashes, c.get("user").id)
      );
    }
  );

  app.post(
    "/:id/objects",
    route({
      description:
        "Upload a pack of objects into the repo. The body is a run of " +
        "records, `[id 32][kind u8][length u32 LE][zstd frame]`. The frame is " +
        "the object's file in dit's store: it decompresses to the kind byte " +
        "and the body, and id is the SHA-256 of those bytes. Records are " +
        "verified as they arrive and taken into the repo in groups, and a " +
        "record that fails ends the pack with the records before it kept: " +
        "a frame or body over 64 MiB is " +
        "a 413, an unknown kind, a frame that is not exactly one zstd frame, " +
        "a frame whose first byte is not the header's kind, a hash that " +
        "does not match or a body that ends inside a record a 400, and a " +
        "storage cap the 413 `storage_limit`. The body must declare its " +
        "`Content-Length` (a 411 without one), and a pack over the " +
        "instance's upload limit is refused before a byte is read with a " +
        "413 `pack_too_large`.",
      requestBody: {
        required: true,
        content: {
          "application/octet-stream": {
            schema: { type: "string", format: "binary" },
          },
        },
      },
      responses: {
        200: json(objectsUploadedSchema, "Pack taken"),
        ...errors(400, 403, 404, 411, 413),
      },
    }),
    idParam(),
    async (c) => {
      const { id } = c.req.valid("param");
      return respond(
        c,
        objectsUploadedSchema,
        await acceptObjects(id, c.get("user").id, packRecords(c.req.raw.body))
      );
    }
  );

  app.post(
    "/:id/objects/fetch",
    describeRaw(
      "Fetch held objects as pack records. The records are in the layout the upload " +
        "reads: `[id 32][kind u8][length u32 LE][zstd frame]`, one record per " +
        "hash, in the order asked and without repeats. When the repo does not " +
        "hold every hash, nothing is streamed: the answer is a 409 with code " +
        "`objects_missing` and every missing hash, in the order asked, in " +
        "`details.hashes`. A viewer of the repo's project may fetch; a " +
        "stranger gets a 404.",
      { description: "The objects as pack records" },
      400,
      403,
      404,
      409
    ),
    idParam(),
    validator("json", fetchObjectsBodySchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const asked = [...new Set(c.req.valid("json").hashes)];
      const held = await heldObjects(id, asked);
      const missing = asked.filter((hash) => !held.has(hash));
      if (missing.length > 0) {
        throw new ApiError(409, {
          code: "objects_missing",
          message: `The repo does not hold ${missing.length} of the objects asked for`,
          details: { hashes: missing },
        });
      }
      const records = asked.map((hash) => ({ hash, kind: held.get(hash)! }));
      return c.body(streamOf(packFrames(records)), 200, {
        "Content-Type": "application/octet-stream",
      });
    }
  );

  return app;
}

/**
 * The pack records of the given objects, each frame read from the store as
 * the body is sent. A frame missing from the store fails the body mid-stream.
 */
async function* packFrames(
  records: { hash: string; kind: number }[]
): AsyncGenerator<Uint8Array> {
  for (const { hash, kind } of records) {
    const frame = await readFile(storedFilePath(objectKey(hash)));
    yield packRecordHeader(hash, kind, frame.byteLength);
    yield frame;
  }
}
