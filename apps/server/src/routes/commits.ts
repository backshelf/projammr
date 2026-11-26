import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AuthedEnv } from "../auth.js";
import {
  commitDownload,
  commitRecord,
  commitRecordSchema,
} from "../db/queries/commits.js";
import { archiveEntries } from "../lib/archive.js";
import { describer, errors, idParam, json, respond } from "../lib/http.js";
import { contentDisposition } from "../lib/serve-file.js";
import {
  SET_FILE_RESPONSE,
  setFile,
  setFileResponse,
} from "../lib/set-download.js";
import { streamOf } from "../lib/stream.js";
import { zipChunks } from "../lib/zip.js";

const { route } = describer("Repos");

/**
 * A commit's own routes. `resolveCommitRoute` gates the `/commits` mount on the
 * project of the commit's repo, so a member of any role may download and
 * anyone else gets a 404.
 */
export function commitRoutes(): Hono<AuthedEnv> {
  const app = new Hono<AuthedEnv>({ strict: false });

  app.get(
    "/:id",
    route({
      description:
        "A commit's own record: its hash and its parent's, the hash of the " +
        "save it names, its message, kind and time, the branch it is on, and " +
        "the set and session it belongs to. `ditSetId` is the set's identity " +
        "in dit, null when the session has none.",
      responses: {
        200: json(commitRecordSchema, "The commit"),
        ...errors(400, 404),
      },
    }),
    idParam(),
    async (c) => {
      const { id } = c.req.valid("param");
      const commit = await commitRecord(id);
      if (!commit)
        throw new HTTPException(404, { message: "Commit not found" });
      return respond(c, commitRecordSchema, commit);
    }
  );

  app.get(
    "/:id/set",
    route({
      description:
        "Download a commit's set. It is rebuilt from the commit's stored " +
        "objects as a gzipped Ableton set named after the commit's session. " +
        "A save whose content is not stored answers 409.",
      responses: {
        200: SET_FILE_RESPONSE,
        ...errors(400, 404, 409),
      },
    }),
    idParam(),
    async (c) => {
      const { id } = c.req.valid("param");
      const commit = await commitDownload(id);
      if (!commit)
        throw new HTTPException(404, { message: "Commit not found" });
      return setFileResponse(c, "commit", id, commit);
    }
  );

  app.get(
    "/:id/archive",
    route({
      description:
        "Download a commit as a zip. It is in the project folder's layout: the set " +
        "at its file name, every sample the hub holds at its path under " +
        "`Samples/`, and `MANIFEST.txt` last, one `<state>\\t<path>` line per " +
        "reference (`included`, `not pushed` or `outside the project " +
        "folder`). The zip streams: a sample is checked before its entry " +
        "starts and listed `not pushed` when a chunk is missing, and a chunk " +
        "that vanishes mid-entry ends the response as a failed download. " +
        "409 when the commit's content is not stored.",
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
      const commit = await commitDownload(id);
      if (!commit)
        throw new HTTPException(404, { message: "Commit not found" });
      const file = await setFile("commit", id, commit);
      const entries = archiveEntries([
        {
          fileName: `${commit.sessionName}.als`,
          saveId: commit.saveId,
          file,
        },
      ]);

      return c.body(streamOf(zipChunks(entries)), 200, {
        "Content-Type": "application/zip",
        "Content-Disposition": contentDisposition(
          "attachment",
          `${commit.sessionName}.zip`
        ),
      });
    }
  );

  return app;
}
