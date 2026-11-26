import { Hono } from "hono";
import type { AuthedEnv } from "../auth.js";
import {
  acceptInvite,
  deleteInvite,
  inviteWithInviterSchema,
} from "../db/queries/invites.js";
import { describer, idParam, respond } from "../lib/http.js";

/** The invite group, `app.ts`'s public invite preview included. */
export const inviteDocs = describer("Invites");
const { describe, describeRaw } = inviteDocs;

const app = new Hono<AuthedEnv>();

const inviteResultSchema = inviteWithInviterSchema.partial();

app.delete(
  "/:id",
  describeRaw(
    "Revoke a pending invite. Requires project admin.",
    { status: 204, description: "Invite revoked" },
    400,
    404
  ),
  idParam(),
  async (c) => {
    await deleteInvite(c.req.valid("param").id);
    return c.body(null, 204);
  }
);

app.post(
  "/:token/accept",
  describe(
    "Accept an invite as the signed-in user. The token is the capability, and the signed-in account's email must match the address the invite names (case-insensitively), or the answer is a 403 with code `invite_email_mismatch`. An invite that is expired or already accepted answers 410 or 409 first.",
    {
      schema: inviteResultSchema,
      description: "Invite accepted; the caller is now a project member",
    },
    403,
    404,
    409,
    410
  ),
  async (c) =>
    respond(
      c,
      inviteResultSchema,
      await acceptInvite(c.req.param("token"), c.get("user"))
    )
);

export default app;
