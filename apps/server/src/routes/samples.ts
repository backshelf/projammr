import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { AuthedEnv } from "../auth.js";
import { heldSample } from "../db/queries/sample-objects.js";
import { describer, errors, idValue, params, validator } from "../lib/http.js";
import {
  leavesPresent,
  sampleBytes,
  sampleLeaves,
} from "../lib/sample-objects.js";
import { contentDisposition } from "../lib/serve-file.js";
import { streamOf } from "../lib/stream.js";
import { isObjectHash } from "../lib/storage.js";

const { route } = describer("Repos");

/**
 * One held sample. `resolveSampleRoute` gates the `/samples` mount on the
 * project of the repo the query names, so a member of any role may download
 * and anyone else gets a 404.
 */
export function sampleRoutes(): Hono<AuthedEnv> {
  const app = new Hono<AuthedEnv>({ strict: false });

  app.get(
    "/:hash",
    route({
      description:
        "Download one held sample. It is found by the object id a save's " +
        "reference carries and served under the reference's file name. A " +
        "hash the repo does not hold as a sample answers 404.",
      responses: {
        200: {
          description: "The sample's bytes",
          content: {
            "application/octet-stream": {
              schema: { type: "string", format: "binary" },
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    params({
      hash: z.string().refine(isObjectHash, "Not an object hash"),
    }),
    validator("query", z.object({ repo: idValue })),
    async (c) => {
      const { hash } = c.req.valid("param");
      const { repo } = c.req.valid("query");
      const sample = await heldSample(repo, hash);
      if (!sample)
        throw new HTTPException(404, { message: "Sample not found" });

      // Checked before the first byte: a response cannot take bytes back.
      const leaves = await sampleLeaves(hash, sample.kind);
      if (!(await leavesPresent(leaves))) {
        throw new Error(`sample ${hash} is missing stored chunks`);
      }

      return c.body(streamOf(sampleBytes(leaves)), 200, {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": contentDisposition("attachment", sample.name),
      });
    }
  );

  return app;
}
