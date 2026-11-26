import type { Context } from "hono";
import { getConnInfo } from "hono/bun";
import { trustedProxyHops } from "./env.js";

/**
 * The socket address of whoever is directly connected to this process.
 * `getConnInfo` needs the Bun server Hono was handed at boot, which the test
 * harness's `app.request()` never supplies — a caller with no socket to point
 * at only comes up under test, everywhere else `"unknown"` is what a caller
 * shares if the runtime genuinely has nothing to report.
 */
function socketAddress(c: Context): string {
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * The caller's address, trusting `hops` proxies' worth of `X-Forwarded-For`
 * entries counted from the right — the end our own proxies wrote, since each
 * one appends rather than replaces (`TRUSTED_PROXY_HOPS`, `lib/env.ts`).
 *
 * `hops = 0` (the default outside compose) ignores the header entirely:
 * nothing in front of the server is trusted to have written it, so trusting
 * any part of it would let a caller pick its own claimed address.
 *
 * `hops = 1` in compose, because Caddy is the only thing in front of the API
 * that writes to this header. It routes `/api/*` and `/media/*` straight to
 * `api:8080` and appends the address it actually saw the connection from, so
 * the rightmost entry is the real caller. Counting from the right is what makes
 * that spoof-proof: a browser can prepend whatever it likes and Caddy's own
 * entry still lands last. The Tailscale node that takes Caddy's place under
 * `docker-compose.tailscale.yml` is still one hop: it replaces the header with
 * the address the connection came from, so its one entry is the whole chain.
 * The web service forwards the chain unchanged rather
 * than adding a hop of its own (`apps/client/src/proxy.ts`), so a request that
 * came via Next reads at the same position as one that did not.
 */
export function clientAddress(c: Context, hops = trustedProxyHops): string {
  const socket = socketAddress(c);
  if (hops === 0) return socket;
  const chain = (c.req.header("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return chain.at(-hops) ?? socket;
}
