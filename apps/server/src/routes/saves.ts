import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AuthedEnv } from "../auth.js";
import { saveDownload } from "../db/queries/commits.js";
import { describer, errors, idParam } from "../lib/http.js";
import { SET_FILE_RESPONSE, setFileResponse } from "../lib/set-download.js";

const { route } = describer("Repos");

/**
 * A save's own routes. `resolveSaveRoute` gates the `/saves` mount on the
 * save's project, so a member of any role may download and anyone else gets a
 * 404.
 */
export function saveRoutes(): Hono<AuthedEnv> {
  const app = new Hono<AuthedEnv>({ strict: false });

  app.get(
    "/:id/set",
    route({
      description:
        "Download a save's set. It is rebuilt from the save's stored objects as a " +
        "gzipped Ableton set named after the save's session. A save whose " +
        "content is not stored (never pushed, or pruned) answers 409.",
      responses: {
        200: SET_FILE_RESPONSE,
        ...errors(400, 404, 409),
      },
    }),
    idParam(),
    async (c) => {
      const { id } = c.req.valid("param");
      const save = await saveDownload(id);
      if (!save) throw new HTTPException(404, { message: "Save not found" });
      return setFileResponse(c, "save", id, save);
    }
  );

  return app;
}
