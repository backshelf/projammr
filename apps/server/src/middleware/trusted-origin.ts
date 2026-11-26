import { csrf } from "hono/csrf";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { trustedOrigins } from "../lib/env.js";
import { log } from "../lib/log.js";
import { LruSet } from "../lib/lru-set.js";

const logger = log("cors");

/**
 * Matches the same list Hono's CORS and Better Auth's `trustedOrigins` read,
 * so a browser's preflight and this check never disagree.
 */
export const isTrustedOrigin = (origin: string): boolean =>
  trustedOrigins.includes(origin.toLowerCase());

const refusedOrigins = new LruSet<string>(256);

function logRefusedOnce(origin: string): void {
  const key = origin.toLowerCase();
  if (refusedOrigins.has(key)) return;
  refusedOrigins.add(key);
  logger.warn("refused origin", { origin, trustedOrigins });
}

const checkOrigin = csrf({ origin: isTrustedOrigin });

/**
 * Refuses a cross-site request that carries the session cookie. Hono's
 * `csrf()` checks `Origin` against the trusted list, but only for the
 * CORS-simple content types (`multipart/form-data`,
 * `application/x-www-form-urlencoded`, `text/plain`) a plain HTML form can
 * send without the preflight `cors()` would otherwise refuse — which is
 * exactly the gap `cors()` alone leaves open: it withholds a response header
 * the browser needs to read the reply, but never stops the request, its
 * side effects, or the cookie riding along with it.
 *
 * A bearer-token caller (dit, MCP) sends no cookie, so there is
 * nothing to ride and no origin worth checking — the same is true of any
 * other request with no `Cookie` at all, which is what `POST
 * /auth/oauth2/token` is: the OAuth provider's token endpoint, called by an
 * MCP client with its authorization code and PKCE verifier in a
 * `application/x-www-form-urlencoded` body (RFC 6749's own shape, not a
 * browser's), authenticated by that code rather than by an ambient cookie.
 *
 * `checkOrigin` is probed with a no-op `next` first so only its own refusal
 * is turned into a 403 here — a downstream route's own error must propagate
 * untouched, not be mistaken for a CSRF failure. Hono's own `HTTPException`
 * carries no message (it answers with a fixed `Response`), which would log
 * as `lib/http.ts`'s generic 403 text; a named one here is what actually
 * appears in both the response body and the log line.
 */
export const csrfProtection = createMiddleware(async (c, next) => {
  if (
    c.req.header("Authorization")?.startsWith("Bearer ") ||
    !c.req.header("Cookie")
  ) {
    return next();
  }

  try {
    await checkOrigin(c, async () => {});
  } catch {
    const origin = c.req.header("Origin");
    if (origin) logRefusedOnce(origin);
    throw new HTTPException(403, { message: "Cross-site request refused" });
  }

  return next();
});
