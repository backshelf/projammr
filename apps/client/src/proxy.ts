import { getCachedSession, isSignedOut } from "@/lib/session";
import { serverApiBaseUrl } from "@workspace/api/lib/api-base-url";
import { NextRequest, NextResponse } from "next/server";

/** The paths the API answers on this origin. */
const API_PATH = /^\/(api|\.well-known)(\/|$)/;

/**
 * Every browser→API request goes through here, which is what makes them
 * same-origin with the page: the HttpOnly session cookie is first-party to
 * this origin, so it rides each one with no CORS and no cross-site cookie
 * rules to satisfy. Nothing is shadowed — the app has no `src/app/api`. The
 * RFC 9728 and RFC 8414 discovery documents under `/.well-known` come too:
 * Better Auth serves them from its request hook, and the MCP resource
 * identifier names this origin.
 *
 * The target is `serverApiBaseUrl`, read from the environment when the server
 * starts. A `rewrites()` entry in `next.config.ts` could not be pointed at the
 * API that way: `output: "standalone"` serialises the config at build time, so
 * its target would be fixed in the image.
 *
 * Caddy's or Tailscale's `X-Forwarded-For` entry goes on **unchanged**, so a
 * request that reaches the API through this service carries the same
 * one-entry chain as one the proxy routed straight to `api:8080`. The server's
 * `TRUSTED_PROXY_HOPS = 1` therefore reads the same position whichever way a
 * request arrived; a hop added here would make the two paths disagree about
 * where the real caller sits, and `clientAddress` would fall back to the
 * socket — collapsing every unauthenticated caller into one rate-limit bucket.
 * Next's forward adds no hop of its own, so this re-set is belt-and-braces
 * rather than load-bearing: it pins the pass-through here instead of
 * depending on that internal.
 */
function forwardToApi(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;
  const headers = new Headers(request.headers);
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) headers.set("x-forwarded-for", forwarded);
  return NextResponse.rewrite(
    new URL(`${serverApiBaseUrl}${pathname}${search}`),
    { request: { headers } }
  );
}

/**
 * An optimistic gate, not the authorization: every API route establishes the
 * caller itself. So a session the proxy could not read is let through rather
 * than bounced — the pages behind it handle a failing API, whereas redirecting
 * would send a reader round a loop that only adds to the traffic that broke
 * the read in the first place.
 */
export async function proxy(request: NextRequest) {
  if (API_PATH.test(request.nextUrl.pathname)) return forwardToApi(request);

  const session = await getCachedSession();
  if (isSignedOut(session)) {
    return NextResponse.redirect(new URL("/", request.url));
  }
}

export const config = {
  matcher: [
    // Everything a real member's account reaches. `/`, `/share/:token` and
    // `/invite/:token` stay open to a guest's anonymous session — those are
    // the only pages an anonymous account is meant to use.
    "/project/:path*",
    "/projects",
    "/notes/:path*",
    "/profile/:path*",
    "/admin/:path*",
    "/settings/:path*",
    // What `forwardToApi` sends on to the API.
    "/api/:path*",
    "/.well-known/:path*",
  ],
};
