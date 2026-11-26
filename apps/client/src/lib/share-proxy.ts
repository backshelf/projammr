import { serverApiBaseUrl } from "@workspace/api/lib/api-base-url";
import type { NextRequest } from "next/server";

/** The response headers worth carrying back: everything an `<audio>` or `<img>`
 *  needs to range-seek, cache and name what it was given. */
const PASSED_BACK = [
  "content-type",
  "content-length",
  "content-range",
  "content-disposition",
  "accept-ranges",
  "cache-control",
  "etag",
  "last-modified",
];

/**
 * Same-origin proxy for a share link's own media routes. The API authenticates
 * these on the token in the path rather than on a session, but an `<audio>` or
 * `<img>` element still cannot reach the API's origin — so the bytes come back
 * through the Next server, which forwards the `Range` header playback needs
 * and the caller's `X-Forwarded-For` unchanged, so the API's share rate limits
 * key on the guest rather than on this server.
 *
 * The token is the credential a guest holds. The session cookie rides along
 * when there is one, like the `/media` proxy's, because an instance that
 * turns guest access off lets only a real account through these routes; no
 * other header of the browser's is forwarded.
 */
export async function proxyShareMedia(
  request: NextRequest,
  path: string,
  method: "GET" | "HEAD",
  passedQuery: string[]
) {
  const target = new URL(`${serverApiBaseUrl}/api/share/${path}`);
  for (const name of passedQuery) {
    const value = request.nextUrl.searchParams.get(name);
    if (value !== null) target.searchParams.set(name, value);
  }

  const forwardHeaders = new Headers();
  const range = request.headers.get("range");
  if (range) forwardHeaders.set("range", range);
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) forwardHeaders.set("x-forwarded-for", forwardedFor);
  const cookie = request.headers.get("cookie");
  if (cookie) forwardHeaders.set("cookie", cookie);

  const upstream = await fetch(target, {
    method,
    headers: forwardHeaders,
    redirect: "manual",
  });

  const responseHeaders = new Headers();
  for (const header of PASSED_BACK) {
    const value = upstream.headers.get(header);
    if (value) responseHeaders.set(header, value);
  }

  return new Response(method === "HEAD" ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}
