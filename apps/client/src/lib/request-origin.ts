/**
 * The scheme the browser used for the request. TLS always ends in front of
 * this server — Caddy, a Tailscale node, or nothing at all under `next dev` —
 * so the socket here is plain http whatever the browser saw, and the only
 * witness is the first `X-Forwarded-Proto` entry. Caddy and Tailscale serve
 * both set it from the connection they accepted and discard any value the
 * caller sent. With nothing in front, Next fills it from its own socket before
 * a page or action renders; it is absent only in `proxy.ts`, which runs
 * earlier, and absent means the request reached this server's plain-http
 * socket directly.
 */
export function requestProtocol(headers: Headers): "http" | "https" {
  const forwarded = headers.get("x-forwarded-proto")?.split(",")[0];
  return forwarded?.trim().toLowerCase() === "https" ? "https" : "http";
}

/**
 * The origin the request was made at, for a metadata base URL: the app has no
 * fixed public origin, so it is read from the `Host` the browser sent, which
 * both proxies pass through unchanged, and the scheme it used.
 */
export function requestOrigin(headers: Headers): string {
  const host = headers.get("host") ?? "localhost";
  return `${requestProtocol(headers)}://${host}`;
}
