export interface SecurityHeadersOptions {
  /**
   * Base64 sha256 digests of the inline scripts a page is allowed to run,
   * each added to `script-src` as `'sha256-<digest>'`.
   */
  scriptHashes?: readonly string[];
}

/**
 * Written against what the client actually loads (`apps/client`): itself,
 * `blob:` for the DSP AudioWorklet module and the FLAC-encode worker,
 * `data:`/`blob:` for images, `'wasm-unsafe-eval'` for compiling `dsp.wasm`.
 * Report-only for the release candidates. `connect-src` and `media-src` need
 * nothing beyond `self`: the browser reaches the API only through the site's
 * own `/api` and `/media` paths, so every request it makes is same-origin.
 */
function contentSecurityPolicy(scriptHashes: readonly string[]): string {
  const scriptSources = [
    "'self'",
    "'wasm-unsafe-eval'",
    ...scriptHashes.map((hash) => `'sha256-${hash}'`),
  ];
  return [
    "default-src 'self'",
    `script-src ${scriptSources.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self'",
    "worker-src 'self' blob:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

/**
 * The conservative floor on every response the site serves, whichever process
 * answers it: the API sends it from its middleware
 * (`apps/server/src/middleware/security-headers.ts`) and the web app from
 * `apps/client/next.config.ts`'s `headers()`, so no proxy in front of either
 * has to add anything. The web app passes the hashes of the inline scripts
 * its pages render; the API renders none.
 */
export function securityHeaders({
  scriptHashes = [],
}: SecurityHeadersOptions = {}): Readonly<Record<string, string>> {
  return {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Content-Security-Policy-Report-Only": contentSecurityPolicy(scriptHashes),
  };
}

/** The floor with no inline scripts allowed: what the API sends. */
export const SECURITY_HEADERS = securityHeaders();
