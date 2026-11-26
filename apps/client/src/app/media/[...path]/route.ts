import { serverApiBaseUrl } from "@workspace/api/lib/api-base-url";
import { headers } from "next/headers";
import type { NextRequest } from "next/server";

/**
 * Same-origin proxy for the API's `/static/*` files. Uploaded audio and images
 * are private to their project's members, and the API enforces that on every
 * `/static` request. `/static` sits outside `/api`, so it is not covered by the
 * rewrite that makes the rest of the API same-origin — this handler stands in
 * for one, forwarding the session cookie (plus `Range`, for audio seeking, and
 * the conditional headers that let the API answer 304) on to the API.
 */
async function proxy(
  request: NextRequest,
  path: string[],
  method: "GET" | "HEAD"
) {
  const target = new URL(
    `${serverApiBaseUrl}/static/${path.map(encodeURIComponent).join("/")}`
  );
  if (request.nextUrl.searchParams.has("download")) {
    target.searchParams.set("download", "");
  }
  const width = request.nextUrl.searchParams.get("w");
  if (width) target.searchParams.set("w", width);

  const forwardHeaders = new Headers();
  const cookie = (await headers()).get("cookie");
  if (cookie) forwardHeaders.set("cookie", cookie);
  for (const header of ["range", "if-none-match", "if-modified-since"]) {
    const value = request.headers.get(header);
    if (value) forwardHeaders.set(header, value);
  }

  const upstream = await fetch(target, {
    method,
    headers: forwardHeaders,
    redirect: "manual",
  });

  const responseHeaders = new Headers();
  for (const header of [
    "content-type",
    "content-length",
    "content-range",
    "content-disposition",
    "accept-ranges",
    "cache-control",
    "etag",
    "last-modified",
  ]) {
    const value = upstream.headers.get(header);
    if (value) responseHeaders.set(header, value);
  }

  return new Response(method === "HEAD" ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  return proxy(request, (await params).path, "GET");
}

export async function HEAD(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  return proxy(request, (await params).path, "HEAD");
}
