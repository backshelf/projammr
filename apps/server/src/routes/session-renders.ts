import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { AuthedEnv } from "../auth.js";
import { requireMembership } from "../db/queries/authorization.js";
import {
  acceptRender,
  renderAcceptedSchema,
} from "../entities/session/renders.js";
import { getSessionRow } from "../entities/session/queries.js";
import { describer, idParam, respond, validator } from "../lib/http.js";

const { describe } = describer("Sessions");

const renderBodySchema = z.object({
  /** The audio file rendered. */
  assetId: z.number(),
  /** The save the render was bounced from, or null when none. */
  bouncedFromSaveId: z.number().nullable(),
});

/** A session's renders. Accepting one needs the editor role on its project. */
export function sessionRenderRoutes(): Hono<AuthedEnv> {
  const renders = new Hono<AuthedEnv>();

  renders.post(
    "/:id/renders",
    describe(
      "Accept a render of a session: attach the audio file, link it as a " +
        "version of the session's track, and record the save it was " +
        "bounced from. The session needs a track.",
      {
        status: 201,
        schema: renderAcceptedSchema,
        description: "Render accepted",
      },
      400,
      404,
      409
    ),
    idParam(),
    validator("json", renderBodySchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      const session = await getSessionRow(id);
      if (!session) {
        throw new HTTPException(404, { message: "Session not found" });
      }
      await requireMembership(
        c.get("user").id,
        session.projectId,
        "editor",
        "Session not found"
      );
      return respond(
        c,
        renderAcceptedSchema,
        await acceptRender(id, body.assetId, body.bouncedFromSaveId),
        201
      );
    }
  );

  return renders;
}
