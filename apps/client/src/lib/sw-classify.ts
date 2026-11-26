/**
 * The service worker's routing rule set, kept in a module so it can be tested.
 * `public/sw.js` is a classic worker script and cannot import this file, so it
 * carries the same `classify` body verbatim; `sw-classify.test.ts` compares the
 * two texts, which is what holds them equal.
 */

export const STATIC_CACHE = "pj-static-v1";
export const IMAGE_CACHE = "pj-images-v1";
export const SHELL_CACHE = "pj-shell-v1";
export const OFFLINE_URL = "/offline";
/** Covers under the phone's own budget; the oldest entry goes first. */
export const IMAGE_CACHE_LIMIT = 200;

type Strategy = "cache-first" | "swr" | "network-first" | "network-only";

export type Classified = { strategy: Strategy; cache?: string };

const NETWORK_ONLY: Classified = { strategy: "network-only" };

/**
 * Which cache, if any, a request may touch. Order matters: anything that
 * carries a body, a byte range, a session-specific payload or a token goes to
 * the network before any path rule can claim it.
 */
export function classify(
  url: URL,
  request: { method: string; headers: Headers; mode?: string }
): Classified {
  if (request.method !== "GET") return NETWORK_ONLY;
  if (request.headers.has("range")) return NETWORK_ONLY;
  if (request.headers.get("rsc") === "1" || url.searchParams.has("_rsc")) {
    return NETWORK_ONLY;
  }
  if (request.headers.has("next-action")) return NETWORK_ONLY;

  const path = url.pathname;
  if (path.startsWith("/api/")) return NETWORK_ONLY;
  if (path.startsWith("/share/")) return NETWORK_ONLY;
  if (path.startsWith("/media/assets/")) return NETWORK_ONLY;

  if (path.startsWith("/_next/static/")) {
    return { strategy: "cache-first", cache: STATIC_CACHE };
  }
  if (
    path.startsWith("/icon/") ||
    path === "/apple-icon" ||
    path === "/manifest.webmanifest"
  ) {
    return { strategy: "swr", cache: SHELL_CACHE };
  }
  if (path.startsWith("/media/images/")) {
    return { strategy: "swr", cache: IMAGE_CACHE };
  }
  if (request.mode === "navigate") {
    return { strategy: "network-first", cache: SHELL_CACHE };
  }
  return NETWORK_ONLY;
}

/**
 * The cache key for a shell asset. Next hashes the icon and manifest links
 * it emits (`/apple-icon?<hash>`), while the worker precaches the bare routes
 * at install; keying by pathname makes the two the same entry. They follow the
 * instance's brand, so each is served stale while revalidated: a renamed
 * instance or a new logo shows from the load after the change.
 */
export function shellKey(url: URL): string {
  return url.pathname;
}
