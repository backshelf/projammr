import { isAPIError } from "better-auth/api";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { auth, type AuthedEnv } from "../auth.js";
import { db } from "../db/index.js";
import {
  deletionPlan,
  deletionPlanSchema,
} from "../db/queries/account-deletion.js";
import { getSaveHeatmap, userHeatmapDaySchema } from "../db/queries/saves.js";
import {
  getProjectsForUser,
  projectsForUserSchema,
} from "../db/queries/user.js";
import { users, userSchema, type InstanceRole } from "../db/schema/auth.js";
import { emailEnabled } from "../lib/env.js";
import { describer, respond, validator } from "../lib/http.js";
import { isSupportedTimeZone } from "../lib/timezone.js";

const { describe } = describer("Account");

const app = new Hono<AuthedEnv>();

/**
 * The signed-in user as they may read themselves: their own contact details,
 * which no one else's view of them carries, and their own instance role — not
 * somebody else's business, but their own account's business. Their settings
 * are read from `/settings`.
 */
const meSchema = userSchema.pick({
  id: true,
  name: true,
  email: true,
  image: true,
  instanceRole: true,
});

/**
 * The payload both `/me` routes answer with.
 *
 * `instanceRole` comes off the session rather than a fresh `users` read, so
 * it is as old as the session cookie cache (`auth.ts`, five minutes) — the
 * same currency as the `name` and `email` beside it. That is the right
 * currency for what reads it: a client-side screen gate, and which settings
 * the client offers.
 * Authorization never reads this; `middleware/instance-admin.ts` goes to
 * `users.instance_role` on every `/admin/*` request.
 *
 * The cast is Better Auth's: an `additionalFields` entry widens to
 * `string | null | undefined` on the session user, while the column behind it
 * is `instanceRoleEnum`, so the value can only ever be one of the union's.
 */
const me = (user: AuthedEnv["Variables"]["user"]) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  image: user.image ?? null,
  instanceRole: (user.instanceRole ?? "user") as InstanceRole,
});

app.get(
  "/",
  describe("Get the signed-in user", {
    schema: meSchema,
    description: "Successfully retrieved the signed-in user",
  }),
  (c) => respond(c, meSchema, me(c.get("user")))
);

const heatmapSchema = z.array(userHeatmapDaySchema);

const heatmapQuerySchema = z.object({
  from: z.coerce.number().int(),
  to: z.coerce.number().int(),
  tz: z.string().default("UTC"),
});

app.get(
  "/heatmap",
  describe(
    "Session-save activity in the caller's projects, by day. " +
      "Every project the caller is a member of, bucketed by local calendar " +
      "day in the caller's IANA time zone. `from`/`to` are epoch " +
      "milliseconds.",
    { schema: heatmapSchema, description: "Heatmap fetched successfully" },
    400
  ),
  validator("query", heatmapQuerySchema),
  async (c) => {
    const { from, to, tz } = c.req.valid("query");
    if (!isSupportedTimeZone(tz)) {
      throw new HTTPException(400, { message: `Unknown time zone: ${tz}` });
    }

    const rows = await getSaveHeatmap(
      { kind: "user", userId: c.get("user").id },
      { from: new Date(from), to: new Date(to), tz }
    );

    return respond(c, heatmapSchema, rows);
  }
);

app.get(
  "/deletion-plan",
  describe(
    "What deleting the signed-in user's account would do: the projects that " +
      "block it because other members still share them, and the projects " +
      "that go with it because no one else is in them.",
    { schema: deletionPlanSchema, description: "Deletion plan fetched" }
  ),
  async (c) =>
    respond(c, deletionPlanSchema, await deletionPlan(c.get("user").id))
);

app.get(
  "/projects",
  describe("Get a list of the currently logged-in user's projects", {
    schema: projectsForUserSchema,
    description: "Successfully retrieved the list of projects",
  }),
  async (c) =>
    respond(
      c,
      projectsForUserSchema,
      await getProjectsForUser(c.get("user").id)
    )
);

const changeEmailNoMailSchema = z.object({
  newEmail: z.email(),
  currentPassword: z.string().min(1),
});

/**
 * Applies an email change on the spot, once the current password checks out.
 * Only reachable on an instance with no mail transport: with one, a change is
 * a two-party act (the account holder and whoever reads the confirmation at
 * the old address), so it goes through Better Auth's own `changeEmail` —
 * wired in `auth.ts` with `sendChangeEmailConfirmation` — instead of this
 * route, which 404s to keep the two paths from coexisting.
 */
app.patch(
  "/email",
  describe(
    "Change the signed-in user's email. Takes effect immediately, after checking the current password. Only present on an instance with no mail transport.",
    { schema: meSchema, description: "Email changed" },
    400,
    404,
    409
  ),
  validator("json", changeEmailNoMailSchema),
  async (c) => {
    if (emailEnabled) throw new HTTPException(404);

    const { newEmail, currentPassword } = c.req.valid("json");
    const user = c.get("user");
    const normalised = newEmail.trim().toLowerCase();
    if (normalised === user.email) {
      throw new HTTPException(400, { message: "That is already your email" });
    }

    try {
      await auth.api.verifyPassword({
        body: { password: currentPassword },
        headers: c.req.raw.headers,
      });
    } catch (error) {
      if (isAPIError(error)) {
        throw new HTTPException(400, {
          message: "Current password is incorrect",
        });
      }
      throw error;
    }

    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, normalised));
    if (existing) {
      throw new HTTPException(409, { message: "That email is already in use" });
    }

    const [updated] = await db
      .update(users)
      .set({ email: normalised, emailVerified: false })
      .where(eq(users.id, user.id))
      .returning();

    return respond(c, meSchema, me(updated!));
  }
);

export default app;
