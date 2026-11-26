import { Hono } from "hono";
import { z } from "zod";
import type { AuthedEnv } from "../../auth.js";
import {
  movedRowSchema,
  moveEntitySchema,
  moveSessionToProject,
} from "../../db/queries/move.js";
import { savesQuerySchema } from "../../db/queries/pagination.js";
import { getSessionSaves } from "../../db/queries/saves.js";
import { saveSchema } from "../../db/schema/save-schemas.js";
import { sessionSchema } from "../../db/schema/sessions.js";
import { describer, idParam, respond, validator } from "../../lib/http.js";
import { moveRateLimit } from "../../middleware/rate-limit.js";
import { entityTag } from "../shared.js";
import { session } from "./index.js";

const { describe } = describer(entityTag(session));

const app = new Hono<AuthedEnv>();

const movedSessionSchema = movedRowSchema(sessionSchema);

const sessionSavesSchema = z.array(saveSchema);

app.on("POST", "/:id/move", moveRateLimit);

app.post(
  "/:id/move",
  describe(
    "Move a session into another project. Its exclusive attachments go " +
      "with it and its track link is cleared, since the track stays " +
      "behind. A session has no custom fields, so `droppedFields` is " +
      "empty. A priority level the target's scale has no level of that " +
      "name for becomes the target's default, listed in " +
      "`priorityFallbacks`. The caller must be an editor in both projects.",
    { schema: movedSessionSchema, description: "Session moved" },
    400,
    404
  ),
  idParam(),
  validator("json", moveEntitySchema),
  async (c) =>
    respond(
      c,
      movedSessionSchema,
      await moveSessionToProject(
        c.req.valid("param").id,
        c.req.valid("json").projectId,
        c.get("user").id
      )
    )
);

app.get(
  "/:id/saves",
  describe(
    "A session's save history, newest first.",
    { schema: sessionSavesSchema, description: "Saves fetched" },
    400,
    404
  ),
  idParam(),
  validator("query", savesQuerySchema),
  async (c) =>
    respond(
      c,
      sessionSavesSchema,
      await getSessionSaves(c.req.valid("param").id, c.req.valid("query").limit)
    )
);

export default app;
