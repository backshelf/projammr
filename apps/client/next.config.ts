import { FALLBACK_API_URL } from "@workspace/api/lib/api-base-url";
import { securityHeaders } from "@workspace/security-headers";
import { MAX_UPLOAD_CEILING_MB } from "@workspace/settings/bounds";
import type { NextConfig } from "next";
import { createHash } from "node:crypto";
import path from "node:path";
import { THEME_SCRIPT } from "./src/lib/theme/script";

/**
 * The site-wide floor the API sends too, with the inline scripts the root
 * layout renders allowed by their sha256 hashes, taken from the very strings
 * it renders.
 */
const SECURITY_HEADERS = securityHeaders({
  scriptHashes: [THEME_SCRIPT].map((script) =>
    createHash("sha256").update(script).digest("base64")
  ),
});

const stripRelativeJsExtension = {
  loaders: [
    path.join(import.meta.dirname, "turbopack/strip-relative-js-extension.cjs"),
  ],
};

const nextConfig: NextConfig = {
  // Traces the workspace packages the app actually uses into
  // `.next/standalone`, so the container ships a server bundle instead of the
  // whole monorepo's node_modules.
  output: "standalone",
  outputFileTracingRoot: path.join(import.meta.dirname, "../../"),

  transpilePackages: ["@workspace/ui"],

  // See turbopack/strip-relative-js-extension.cjs: the internal relative
  // imports of `@workspace/dsp`, `@workspace/session-diff` and `@workspace/settings`, the packages the
  // server also imports as source, carry a `.js` extension for the server's
  // NodeNext typecheck, which Turbopack — unlike Bun and TypeScript's own
  // "bundler" resolution — does not remap to the `.ts` file that exists.
  turbopack: {
    rules: {
      "../../packages/dsp/src/**/*.ts": stripRelativeJsExtension,
      "../../packages/session-diff/src/**/*.ts": stripRelativeJsExtension,
      "../../packages/settings/src/**/*.ts": stripRelativeJsExtension,
    },
  },
  images: {
    // Every uploaded image is served through the `/media` proxy, which gates
    // the file on the viewer's session cookie. Next's image optimizer fetches
    // sources server-side without that cookie, so it would only ever get a
    // 403 — skip optimization and let the browser load the proxied URL
    // directly (the API already sends cache headers).
    unoptimized: true,
  },
  allowedDevOrigins: ["localhost", new URL(FALLBACK_API_URL).hostname],

  experimental: {
    // The largest upload any instance can be set to accept, which is what
    // the body buffer has to allow for. Next buffers a request body on every
    // path `proxy.ts` runs for, and it runs for `/api/*` because it is what
    // forwards those requests to the API, so every upload made through this
    // server passes through the buffer. A body over this is truncated to it
    // with nothing but a logged warning, and the API is handed the partial
    // body; below the ceiling, the instance's own limit (a setting the API
    // checks per request) refuses such a body first.
    proxyClientMaxBodySize: `${MAX_UPLOAD_CEILING_MB}mb`,
    // Holds a navigation, prefetch or server action that hits a dead network
    // and retries it when the connection returns, instead of throwing, and
    // gives `useOffline` its value.
    useOffline: true,
    optimizePackageImports: ["@tabler/icons-react"],
  },

  async headers() {
    return [
      // The security headers, on every page whatever proxy fronts the app.
      // Left out of `next dev`, whose React build evals to
      // rebuild server stacks and would draw a CSP report on every load.
      ...(process.env.NODE_ENV === "development"
        ? []
        : [
            {
              source: "/:path*",
              headers: Object.entries(SECURITY_HEADERS).map(([key, value]) => ({
                key,
                value,
              })),
            },
          ]),
      // The worker and the DSP worklet processor are both served from
      // `public/`, where Next sends a long-lived `Cache-Control` by default. A
      // cached worker can never be replaced, and a stale worklet would run the
      // previous ABI against the current `dsp.wasm` — the worklet is also
      // loaded with `?v=ABI_VERSION` (`attachMeters` in `player-engine.ts`),
      // but a browser that has already cached the bare URL from an older
      // deploy never gets that far.
      {
        source: "/sw.js",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
          {
            key: "Content-Type",
            value: "application/javascript; charset=utf-8",
          },
        ],
      },
      {
        source: "/dsp-processor.js",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
          {
            key: "Content-Type",
            value: "application/javascript; charset=utf-8",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
