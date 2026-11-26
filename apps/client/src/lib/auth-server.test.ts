import { beforeEach, describe, expect, it, mock } from "bun:test";

mock.module("server-only", () => ({}));

let requestHeaders = new Headers();
mock.module("next/headers", () => ({ headers: async () => requestHeaders }));

// Better Auth turns `isSecure` into the cookie name: `__Secure-better-auth.`
// when true, `better-auth.` when false.
const getCookieCache = mock<
  (headers: Headers, config: { isSecure?: boolean }) => Promise<unknown>
>(async () => null);
mock.module("better-auth/cookies", () => ({ getCookieCache }));

process.env.BETTER_AUTH_SECRET ??= "test-secret";

const { readCachedSessionCookie } = await import("./auth-server");

beforeEach(() => {
  getCookieCache.mockReset();
  getCookieCache.mockResolvedValue(null);
});

async function isSecureFor(init: Record<string, string>) {
  requestHeaders = new Headers({
    cookie: "better-auth.session_data=x",
    ...init,
  });
  await readCachedSessionCookie();
  const [headers, config] = getCookieCache.mock.calls[0]!;
  expect(headers).toBe(requestHeaders);
  return config.isSecure;
}

describe("readCachedSessionCookie's cookie name", () => {
  // Caddy and Tailscale serve both terminate TLS and forward `https`; the API
  // behind them has an https `BETTER_AUTH_URL` and writes the prefixed name.
  it("is the __Secure- name behind a proxy that forwarded https", async () => {
    expect(await isSecureFor({ "x-forwarded-proto": "https" })).toBe(true);
  });

  // `next dev`: Next fills the header from its own plain-http socket.
  it("is the unprefixed name for a plain-http request", async () => {
    expect(await isSecureFor({ "x-forwarded-proto": "http" })).toBe(false);
  });

  // `proxy.ts` runs before Next fills the header.
  it("is the unprefixed name when nothing forwarded a proto", async () => {
    expect(await isSecureFor({ host: "app.example.com" })).toBe(false);
  });
});

describe("readCachedSessionCookie", () => {
  it("returns the session the cookie carried", async () => {
    const session = { user: { id: "user_1" }, session: { id: "session_1" } };
    getCookieCache.mockResolvedValue(session);
    const read: unknown = await readCachedSessionCookie();
    expect(read).toBe(session);
  });

  it("is null when the cookie is absent or does not verify", async () => {
    expect(await readCachedSessionCookie()).toBeNull();
  });
});
