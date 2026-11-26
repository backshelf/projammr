import "server-only";
import { anonymousClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { getCookieCache } from "better-auth/cookies";
import { headers } from "next/headers";
import { serverApiBaseUrl } from "@workspace/api/lib/api-base-url";
import { requestProtocol } from "@/lib/request-origin";

const BETTER_AUTH_COOKIE_PREFIX = "better-auth";
export const authServerClient = createAuthClient({
  plugins: [anonymousClient()],
  baseURL: serverApiBaseUrl,
  fetchOptions: {
    onRequest: async (context) => {
      const headersList = await headers();
      const cookie = headersList.get("Cookie");

      // Proxy auth-related cookies
      if (cookie) {
        const authCookies = cookie
          .split(";")
          .map((c) => c.trim())
          .filter(
            (c) =>
              c.startsWith(`${BETTER_AUTH_COOKIE_PREFIX}.`) ||
              c.startsWith(`__Secure-${BETTER_AUTH_COOKIE_PREFIX}.`)
          )
          .join("; ");

        if (authCookies) {
          context.headers.set("Cookie", authCookies);
        }
      }
    },
  },
});

export type SessionData = typeof authServerClient.$Infer.Session;

/**
 * The API signs the session cookie, so reading it back here needs the same
 * secret. Absent, every read would fall back to an HTTP round trip per render
 * and nothing would say why, so this is a startup error rather than a silent
 * loss of the fast path.
 */
function authSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error(
      "BETTER_AUTH_SECRET is not set. The client verifies the session cookie in-process and needs the same secret the API signs it with."
    );
  }
  return secret;
}

/**
 * The session Better Auth mirrored into the signed `session_data` cookie, or
 * null when it is absent, tampered with, or past its `cookieCache` lifetime.
 *
 * The API names the cookie `__Secure-better-auth.session_data` when its own
 * `BETTER_AUTH_URL` is https, and every deployment sets that to the public
 * origin the browser uses. So the name to read follows the scheme of the
 * request itself: a browser only keeps a `__Secure-` cookie from an https
 * page, and reading only that name there means an unprefixed cookie planted
 * over http is never trusted. A request whose scheme disagrees with the API's
 * setting finds no cookie and costs one API read, never a wrong answer.
 */
export async function readCachedSessionCookie(): Promise<SessionData | null> {
  const requestHeaders = await headers();
  const cached = await getCookieCache(requestHeaders, {
    secret: authSecret(),
    isSecure: requestProtocol(requestHeaders) === "https",
  });

  return (cached as SessionData | null) ?? null;
}
