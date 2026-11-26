import { createMiddleware } from "hono/factory";
import { auth, type AuthType } from "../auth.js";
import { revokeUserSessions } from "../db/queries/auth-sessions.js";

/**
 * Puts the Better Auth session on the context for every request, signed in or
 * not. Never throws — routes that require a user reach for `authenticated`.
 *
 * A disabled account reads as signed out rather than as a caller with no
 * rights: every gate downstream already answers 401 to a request with no user,
 * so one check here covers every route instead of each of them learning about
 * `disabledAt`. Its session rows are dropped on the way past, so the account
 * cannot come back on the same cookie once Better Auth's cookie cache lapses.
 */
export const resolveSession = createMiddleware<{ Variables: AuthType }>(
  async (c, next) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    const disabled = session?.user.disabledAt != null;

    if (session && disabled) await revokeUserSessions(session.user.id);

    c.set("user", session && !disabled ? session.user : null);
    c.set("session", session && !disabled ? session.session : null);

    await next();
  }
);
