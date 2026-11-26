/**
 * Projammr's service worker. A `public/` script cannot import a module, so the
 * `classify` body below is the same text as `src/lib/sw-classify.ts`, which is
 * where the rule set is documented and tested; `sw-classify.test.ts` compares
 * the two.
 *
 * The worker never calls `skipWaiting()`: a new worker claiming the page
 * mid-session while the document still asks for the previous build's chunks
 * fails those chunk loads. It takes over on the next cold start.
 */

const STATIC_CACHE = "pj-static-v1";
const IMAGE_CACHE = "pj-images-v1";
const SHELL_CACHE = "pj-shell-v1";
const OFFLINE_URL = "/offline";
const IMAGE_CACHE_LIMIT = 200;

const CURRENT_CACHES = [STATIC_CACHE, IMAGE_CACHE, SHELL_CACHE];

/** Cheap and needed the moment the network is gone; revalidated on every use. */
const PRECACHE_ICONS = [
  "/icon/default",
  "/icon/maskable",
  "/apple-icon",
  "/manifest.webmanifest",
];

const NETWORK_ONLY = { strategy: "network-only" };

/**
 * Which cache, if any, a request may touch. Order matters: anything that
 * carries a body, a byte range, a session-specific payload or a token goes to
 * the network before any path rule can claim it.
 */
function classify(url, request) {
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
function shellKey(url) {
  return url.pathname;
}

self.addEventListener("install", (event) => {
  event.waitUntil(precache());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(dropRetiredCaches());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  // Everything the app caches is served from its own origin; a third party's
  // response is the browser's business.
  if (url.origin !== self.location.origin) return;

  const { strategy, cache } = classify(url, request);
  switch (strategy) {
    case "cache-first":
      // Build output is content-addressed by its path and keeps the full URL.
      event.respondWith(cacheFirst(request, cache, request));
      return;
    case "swr":
      // Shell assets collapse onto one entry per route.
      event.respondWith(
        staleWhileRevalidate(
          event,
          request,
          cache,
          cache === SHELL_CACHE ? shellKey(url) : request
        )
      );
      return;
    case "network-first":
      event.respondWith(networkFirst(request));
      return;
    default:
      // No `respondWith` at all, so the browser keeps its own handling of byte
      // ranges, streaming and credentials.
      return;
  }
});

/**
 * The offline document is the one thing the worker cannot do its job without,
 * so its failure fails the install and the previous worker stays in place. The
 * icons are best-effort.
 */
async function precache() {
  const cache = await caches.open(SHELL_CACHE);
  // Fetched without the member's cookies, so the root layout renders it as a
  // signed-out visitor: from the instance's theme, which is `system` unless an
  // admin set one, and then `THEME_SCRIPT` picks the class from the theme the
  // member last saved in `localStorage`; the theme provider follows the same
  // saved theme once it hydrates, as on every signed-out page (the sign-in
  // page included) whose theme is `system`. With their cookies the page would
  // carry whichever theme they had at install and keep it after a change. An
  // instance that sets an explicit theme shows it offline to everyone.
  await cache.add(
    new Request(OFFLINE_URL, { cache: "reload", credentials: "omit" })
  );
  await Promise.all(
    PRECACHE_ICONS.map((path) => cache.add(path).catch(() => undefined))
  );
}

async function dropRetiredCaches() {
  const names = await caches.keys();
  await Promise.all(
    names
      .filter((name) => !CURRENT_CACHES.includes(name))
      .map((name) => caches.delete(name))
  );
}

/** A 403 from a signed-out session, or an opaque cross-origin body, is not a
 *  copy of anything worth keeping. */
function storable(response) {
  return response.ok && response.type === "basic";
}

async function cacheFirst(request, cacheName, key) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(key);
  if (cached) return cached;

  const response = await fetch(request);
  if (storable(response)) await cache.put(key, response.clone());
  return response;
}

async function staleWhileRevalidate(event, request, cacheName, key) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(key);
  const fresh = revalidate(cache, cacheName, request, key);
  if (!cached) return fresh;

  event.waitUntil(fresh.catch(() => undefined));
  return cached;
}

/** Only the image cache has a budget; the shell cache holds a handful of routes and the offline page. */
async function revalidate(cache, cacheName, request, key) {
  const response = await fetch(request);
  if (storable(response)) {
    await cache.put(key, response.clone());
    if (cacheName === IMAGE_CACHE) await trim(cache, IMAGE_CACHE_LIMIT);
  }
  return response;
}

/** `keys()` answers in insertion order, so the oldest entries are first. */
async function trim(cache, limit) {
  const keys = await cache.keys();
  for (const key of keys.slice(0, keys.length - limit)) {
    await cache.delete(key);
  }
}

/**
 * Documents are never stored: every page is request-time dynamic and shaped by
 * the session. Offline, the precached fallback stands in for whichever one was
 * asked for.
 */
async function networkFirst(request) {
  try {
    return await fetch(request);
  } catch {
    const offline = await caches.match(OFFLINE_URL);
    return offline ?? Response.error();
  }
}
