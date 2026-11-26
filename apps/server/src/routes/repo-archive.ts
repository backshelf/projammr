import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AuthedEnv } from "../auth.js";
import { mainTips, repoName } from "../db/queries/archives.js";
import { archiveEntries } from "../lib/archive.js";
import { describer, errors, idParam } from "../lib/http.js";
import { contentDisposition } from "../lib/serve-file.js";
import { streamOf } from "../lib/stream.js";
import { zipChunks } from "../lib/zip.js";

const { route } = describer("Repos");

/**
 * A repository as one download. Mounted under `/repos` behind the same gate as
 * the repo's other routes, so a member of any role may download and anyone
 * else gets a 404.
 */
export function repoArchiveRoutes(): Hono<AuthedEnv> {
  const app = new Hono<AuthedEnv>({ strict: false });

  app.get(
    "/:id/archive",
    route({
      description:
        "Download a repository as a zip. It is in the project folder's layout: " +
        "every set at the tip of its `main` branch, every sample the hub " +
        "holds at its path under `Samples/`, and `MANIFEST.txt` last. A set " +
        "is rebuilt when its turn comes, one in memory at a time, so a set " +
        "that cannot be rebuilt ends the response as a failed download. 409 " +
        "when no set has a `main` commit yet or a tip's content is not stored.",
      responses: {
        200: {
          description: "The zip",
          content: {
            "application/zip": { schema: { type: "string", format: "binary" } },
          },
        },
        ...errors(400, 404, 409, 429),
      },
    }),
    idParam(),
    async (c) => {
      const { id } = c.req.valid("param");
      // The gate has resolved the repo, so it exists.
      const name = (await repoName(id))!;

      const tips = await mainTips(id);
      if (tips.length === 0) {
        throw new HTTPException(409, {
          message: "No set of this repository has a commit on main yet",
        });
      }
      const gone = tips.find((tip) => tip.contentState !== "stored");
      if (gone) {
        throw new HTTPException(409, {
          message: `The content of ${gone.sessionName} is not stored (${gone.contentState})`,
        });
      }

      const entries = archiveEntries(
        tips.map((tip) => ({
          fileName: `${tip.sessionName}.als`,
          saveId: tip.saveId,
          committedAt: tip.committedAt,
        }))
      );
      return c.body(streamOf(zipChunks(entries)), 200, {
        "Content-Type": "application/zip",
        "Content-Disposition": contentDisposition("attachment", `${name}.zip`),
      });
    }
  );

  return app;
}
