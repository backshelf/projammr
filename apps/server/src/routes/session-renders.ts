import { Hono } from "hono";
import { z } from "zod";
import type { AuthedEnv } from "../auth.js";
import {
  acceptRender,
  renderAcceptedSchema,
} from "../entities/session/renders.js";
import { describer, idParam, respond, validator } from "../lib/http.js";

const { describe } = describer("Sessions");

const renderBodySchema = z.object({
  /** The audio file rendered. */
  assetId: z.number().int().positive(),
  /** The save the render was bounced from, or null when none. */
  bouncedFromSaveId: z.number().int().positive().nullable(),
});

/**
 * A session's renders. Mounted under `/sessions`, which `mountEntities` has
 * already gated on the session's project with the editor role for `POST`.
 */
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
