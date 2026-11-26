import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import type { AuthedEnv, AuthType } from "../auth.js";
import { instancePolicy } from "../lib/instance-policy.js";

/**
 * `user`/`session` as `resolveSession` leaves them — nullable, since it runs
 * for signed-out callers too. Every gate below reads them through this rather
 * than casting inline.
 */
const sessionOf = (c: Context) => ({
  user: c.get("user") as AuthType["user"],
  session: c.get("session") as AuthType["session"],
});

/**
 * The instance's guest-access switch, on the routes a share or invite link
 * opens without an account. While guests are allowed it passes everyone;
 * while they are not, a caller with no real account — signed out, or holding
 * a share page's anonymous session — gets the same bare 401 a signed-out
 * caller gets anywhere, which is what sends the page to its sign-in prompt.
 * A member with a real account passes either way. Read per request.
 */
export const guestAccess = createMiddleware<{ Variables: AuthType }>(
  async (c, next) => {
    if (!instancePolicy().access.guestAccess) {
      const { user, session } = sessionOf(c);
      if (!user || !session || user.isAnonymous) {
        throw new HTTPException(401);
      }
    }
    await next();
  }
);

/**
 * Any signed-in caller, including a share-page guest's anonymous session.
 * Only the guest-facing share routes mount this — everything else wants
 * `authenticated` below, which refuses a guest.
 */
export const guestOrMember = createMiddleware<AuthedEnv>(async (c, next) => {
  const { user, session } = sessionOf(c);
  if (!user || !session) {
    throw new HTTPException(401);
  }
  await next();
});

/**
 * The gate that makes `AuthedEnv` true: past it, `user` and `session` are set
 * and belong to a real account. A share-page guest's anonymous session is
 * refused with 403 rather than treated as signed out, so the client can tell
 * "sign in" from "this needs an account" — and so the refusal lands before
 * `authorizeProject` ever resolves a scope for the request.
 */
export const authenticated = createMiddleware<AuthedEnv>(async (c, next) => {
  const { user, session } = sessionOf(c);
  if (!user || !session) {
    throw new HTTPException(401);
  }
  if (user.isAnonymous) {
    throw new HTTPException(403, { message: "This needs an account" });
  }
  await next();
});
