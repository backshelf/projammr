import { beforeEach, describe, expect, it, mock } from "bun:test";
import {
  getRewrittenUrl,
  isRewrite,
  unstable_doesMiddlewareMatch,
} from "next/experimental/testing/server";
import { NextRequest, type NextResponse } from "next/server";

mock.module("server-only", () => ({}));

const getCachedSession = mock();
const isSignedOut = mock();
mock.module("@/lib/session", () => ({ getCachedSession, isSignedOut }));

// Set before the import, the way a container's environment is there before
// the server starts: nothing about the target is fixed at build time.
const INTERNAL_API_URL = "http://api.internal:8080";
process.env.INTERNAL_API_URL = INTERNAL_API_URL;

const { proxy, config } = await import("./proxy");

beforeEach(() => {
  getCachedSession.mockReset();
  isSignedOut.mockReset();
});

function requestFor(path: string, headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost:3000${path}`, { headers });
}

/**
 * `NextResponse.rewrite(url, { request: { headers } })` carries the modified
 * request forward as `x-middleware-request-<key>` response headers rather than
 * mutating anything observable directly — this is how Next itself reads them
 * back out before making the forward.
 */
function forwardedFor(res: Response | undefined): string | null {
  return res?.headers.get("x-middleware-request-x-forwarded-for") ?? null;
}

function forwardedTo(res: NextResponse | undefined): string | null {
  expect(res && isRewrite(res)).toBe(true);
  return getRewrittenUrl(res!);
}

describe("proxy's forward to the API", () => {
  it("sends /api to the API's address from the runtime environment", async () => {
    const res = await proxy(requestFor("/api/assets/upload"));
    expect(forwardedTo(res)).toBe(`${INTERNAL_API_URL}/api/assets/upload`);
  });

  it("keeps the query string", async () => {
    const res = await proxy(requestFor("/api/projects?limit=5&cursor=a%2Fb"));
    expect(forwardedTo(res)).toBe(
      `${INTERNAL_API_URL}/api/projects?limit=5&cursor=a%2Fb`
    );
  });

  it("sends the discovery documents under /.well-known too", async () => {
    const res = await proxy(
      requestFor("/.well-known/oauth-authorization-server")
    );
    expect(forwardedTo(res)).toBe(
      `${INTERNAL_API_URL}/.well-known/oauth-authorization-server`
    );
  });

  it("forwards the bare /api path rather than gating it", async () => {
    const res = await proxy(requestFor("/api"));
    expect(forwardedTo(res)).toBe(`${INTERNAL_API_URL}/api`);
  });

  it("leaves a page whose path only starts with 'api' to the gate", async () => {
    getCachedSession.mockResolvedValue({ kind: "member" });
    isSignedOut.mockReturnValue(false);
    expect(await proxy(requestFor("/apiary"))).toBeUndefined();
  });

  // Next buffers a request body (`proxyClientMaxBodySize`) only on a path
  // proxy runs for, and an upload through this server is one of them.
  it("runs for every path it forwards", () => {
    for (const url of ["/api/assets/upload", "/api", "/.well-known/x"]) {
      expect(
        unstable_doesMiddlewareMatch({ config, nextConfig: {}, url })
      ).toBe(true);
    }
  });
});

describe("proxy on /api and /.well-known", () => {
  it("adds no hop of its own when the header is absent", async () => {
    const res = await proxy(requestFor("/api/health"));
    expect(forwardedFor(res)).toBeNull();
    expect(getCachedSession).not.toHaveBeenCalled();
  });

  // The server reads the rightmost entry (`TRUSTED_PROXY_HOPS = 1`), so a hop
  // added here would move the real caller and only on the paths that come
  // through this service — Caddy sends `/api/*` straight to the API.
  it("forwards an existing chain unchanged rather than appending to it", async () => {
    const res = await proxy(
      requestFor("/api/assets/upload", { "x-forwarded-for": "203.0.113.5" })
    );
    expect(forwardedFor(res)).toBe("203.0.113.5");
  });

  it("leaves a spoofed chain for the server to read from the right", async () => {
    const res = await proxy(
      requestFor("/api/assets/upload", {
        "x-forwarded-for": "9.9.9.9, 203.0.113.5",
      })
    );
    expect(forwardedFor(res)).toBe("9.9.9.9, 203.0.113.5");
  });

  it("covers the well-known discovery paths the same way", async () => {
    const res = await proxy(
      requestFor("/.well-known/oauth-protected-resource", {
        "x-forwarded-for": "203.0.113.5",
      })
    );
    expect(forwardedFor(res)).toBe("203.0.113.5");
  });

  it("skips the session gate entirely for these paths", async () => {
    isSignedOut.mockReturnValue(true);
    const res = await proxy(requestFor("/api/me"));
    // A signed-out reader would otherwise be redirected to `/`.
    expect(res?.status).not.toBe(307);
    expect(getCachedSession).not.toHaveBeenCalled();
  });
});

describe("proxy on a gated page", () => {
  it("still redirects a signed-out reader", async () => {
    getCachedSession.mockResolvedValue({ kind: "signed-out" });
    isSignedOut.mockReturnValue(true);

    const res = await proxy(requestFor("/project/1"));

    expect(res?.status).toBe(307);
    expect(new URL(res!.headers.get("location")!).pathname).toBe("/");
  });

  it("lets a member through with no response", async () => {
    getCachedSession.mockResolvedValue({ kind: "member" });
    isSignedOut.mockReturnValue(false);

    const res = await proxy(requestFor("/project/1"));

    expect(res).toBeUndefined();
  });
});
