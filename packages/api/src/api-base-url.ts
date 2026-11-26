/**
 * The address the API is reachable at when nothing in the environment says
 * otherwise: the API's own default port on this machine.
 */
export const FALLBACK_API_URL = "http://localhost:8080";

/**
 * API base URL for calls made from a server — RSC, server actions, route
 * handlers — and for `proxy.ts`'s forward of the browser's `/api/*` requests.
 * `INTERNAL_API_URL` is the API's in-network address, under compose the `api`
 * service. It is read from the environment when the server starts, never
 * inlined at build time, so one built image can be pointed at any API. The
 * browser never needs it: every request it makes is same-origin.
 */
export const serverApiBaseUrl =
  typeof process === "undefined"
    ? FALLBACK_API_URL
    : process.env.INTERNAL_API_URL || FALLBACK_API_URL;
