import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { stubEnv, unstubAllEnvs } from "@workspace/test/env";

mock.module("dotenv/config", () => ({}));

/**
 * `publicTlsMode` (`lib/env.ts`) is read once at import time, same as every
 * other env constant there, so a case that varies `TLS_MODE` has to reload
 * both it and this module fresh — clearing only `env.js`'s cache entry would
 * leave `security-headers.js` holding the stale value it already imported.
 */
async function loadSecurityHeaders(vars: Record<string, string | undefined>) {
  delete require.cache[require.resolve("../lib/env.js")];
  delete require.cache[require.resolve("./security-headers.js")];
  for (const [key, value] of Object.entries(vars)) {
    stubEnv(key, value);
  }
  return import("./security-headers.js");
}

async function headersFor(vars: Record<string, string | undefined> = {}) {
  const { securityHeaders } = await loadSecurityHeaders(vars);
  const app = new Hono();
  app.use("*", securityHeaders);
  app.get("/thing", (c) => c.text("ok"));
  const res = await app.request("/thing");
  return res.headers;
}

beforeEach(() => {
  stubEnv("BETTER_AUTH_SECRET", "test-secret");
  stubEnv("NOTES_MASTER_KEY", Buffer.alloc(32, "t").toString("base64"));
});

afterEach(() => {
  unstubAllEnvs();
});

describe("securityHeaders", () => {
  it("sets a conservative floor on every response", async () => {
    const headers = await headersFor();
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("Referrer-Policy")).toBe(
      "strict-origin-when-cross-origin"
    );
    const csp = headers.get("Content-Security-Policy-Report-Only");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("'wasm-unsafe-eval'");
    // Report-only, never enforcing, for the release candidates.
    expect(headers.get("Content-Security-Policy")).toBeNull();
  });

  it("omits HSTS when TLS_MODE is unset", async () => {
    const headers = await headersFor({ TLS_MODE: undefined });
    expect(headers.get("Strict-Transport-Security")).toBeNull();
  });

  it("sends HSTS only when TLS_MODE is acme", async () => {
    const headers = await headersFor({ TLS_MODE: "acme" });
    expect(headers.get("Strict-Transport-Security")).toBe(
      "max-age=63072000; includeSubDomains"
    );
  });

  it("omits HSTS for the self-signed internal CA mode", async () => {
    const headers = await headersFor({ TLS_MODE: "internal" });
    expect(headers.get("Strict-Transport-Security")).toBeNull();
  });
});
