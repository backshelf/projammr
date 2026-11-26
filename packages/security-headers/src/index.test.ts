import { describe, expect, it } from "bun:test";
import { SECURITY_HEADERS, securityHeaders } from "./index.js";

const CSP = "Content-Security-Policy-Report-Only";

const POLICY_WITHOUT_HASHES =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; " +
  "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
  "media-src 'self'; worker-src 'self' blob:; connect-src 'self'; " +
  "frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

describe("SECURITY_HEADERS", () => {
  it("is the floor with no inline script hashes", () => {
    expect(SECURITY_HEADERS).toEqual({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      [CSP]: POLICY_WITHOUT_HASHES,
    });
  });

  it("matches the builder called with no options or no hashes", () => {
    expect(securityHeaders()).toEqual(SECURITY_HEADERS);
    expect(securityHeaders({ scriptHashes: [] })).toEqual(SECURITY_HEADERS);
  });
});

describe("securityHeaders", () => {
  it("adds each script hash to script-src as a sha256 source", () => {
    const headers = securityHeaders({ scriptHashes: ["abc+/=", "xyz="] });
    expect(headers[CSP]).toBe(
      POLICY_WITHOUT_HASHES.replace(
        "script-src 'self' 'wasm-unsafe-eval'",
        "script-src 'self' 'wasm-unsafe-eval' 'sha256-abc+/=' 'sha256-xyz='"
      )
    );
  });

  it("leaves the other headers alone when hashes are given", () => {
    const headers = securityHeaders({ scriptHashes: ["abc="] });
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(Object.keys(headers)).toEqual(Object.keys(SECURITY_HEADERS));
  });
});
