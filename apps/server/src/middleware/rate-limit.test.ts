import { Hono } from "hono";
import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { jsonErrorHandler } from "../lib/http.js";
import { DEFAULT_INSTANCE_POLICY } from "../lib/instance-policy.js";
import { rateLimit, takeToken } from "./rate-limit.js";
import { app } from "../app.js";
import { authUrl, baseUrl } from "../test/fixtures.js";
import {
  restoreInstancePolicy,
  stubInstancePolicy,
} from "../test/instance-policy.js";

/** An app metered on the `moves` bucket, at the allowance `options` gives it. */
function meteredApp(options: { burst: number; perMinute: number }) {
  stubInstancePolicy({ rateLimits: { moves: options } });
  const app = new Hono();
  app.use("/work", rateLimit("moves"));
  app.get("/work", (c) => c.text("ok"));
  app.onError(jsonErrorHandler);
  return app;
}

/**
 * Simulates a distinct caller for `clientAddress`'s socket fallback (the
 * default outside compose, `TRUSTED_PROXY_HOPS = 0`): `hono/bun`'s
 * `getConnInfo` reads the Bun server object Hono was handed as its second
 * `fetch` argument, which is exactly `app.request`'s third argument.
 */
const callerEnv = (ip: string) => ({
  requestIP: () => ({ address: ip, family: "IPv4" as const }),
});

afterEach(() => {
  mock.restore();
  restoreInstancePolicy();
});

describe("rateLimit", () => {
  it("spends the burst, then refuses with a Retry-After", async () => {
    const app = meteredApp({ burst: 20, perMinute: 30 });
    const now = spyOn(Date, "now").mockReturnValue(1_000_000);

    const ip1 = callerEnv("10.0.0.1");
    for (let i = 0; i < 20; i += 1) {
      const res = await app.request("/work", {}, ip1);
      expect(res.status).toBe(200);
    }

    const refused = await app.request("/work", {}, ip1);
    expect(refused.status).toBe(429);
    // One token at 30 a minute is two seconds away.
    expect(refused.headers.get("Retry-After")).toBe("2");

    now.mockReturnValue(1_002_000);
    const afterRefill = await app.request("/work", {}, ip1);
    expect(afterRefill.status).toBe(200);

    const refusedAgain = await app.request("/work", {}, ip1);
    expect(refusedAgain.status).toBe(429);
  });

  it("meters each caller separately", async () => {
    const app = meteredApp({ burst: 1, perMinute: 1 });
    spyOn(Date, "now").mockReturnValue(1_000_000);

    const ip2 = callerEnv("10.0.0.2");
    const ip3 = callerEnv("10.0.0.3");
    expect((await app.request("/work", {}, ip2)).status).toBe(200);
    expect((await app.request("/work", {}, ip2)).status).toBe(429);
    expect((await app.request("/work", {}, ip3)).status).toBe(200);
  });

  it("ignores a caller-claimed X-Forwarded-For header when TRUSTED_PROXY_HOPS is 0", async () => {
    const app = meteredApp({ burst: 1, perMinute: 1 });

    const first = await app.request("/work", {
      headers: { "X-Forwarded-For": "1.1.1.1" },
    });
    const second = await app.request("/work", {
      headers: { "X-Forwarded-For": "2.2.2.2" },
    });

    expect(first.status).toBe(200);
    // A caller cannot escape the shared bucket by claiming a different
    // address for itself: with no trusted proxy in front, the header is
    // never consulted, so both requests land in the same bucket.
    expect(second.status).toBe(429);
  });

  it("answers in the shared error envelope", async () => {
    const app = meteredApp({ burst: 1, perMinute: 1 });
    const ip4 = callerEnv("10.0.0.4");

    await app.request("/work", {}, ip4);
    const refused = await app.request("/work", {}, ip4);

    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({ error: "Too many requests" });
  });
});

describe("takeToken", () => {
  it("allows the burst then refuses the next call, independent of any middleware", () => {
    spyOn(Date, "now").mockReturnValue(2_000_000);
    stubInstancePolicy({ rateLimits: { moves: { burst: 3, perMinute: 60 } } });

    expect(takeToken("moves", "caller-1")).toBe(true);
    expect(takeToken("moves", "caller-1")).toBe(true);
    expect(takeToken("moves", "caller-1")).toBe(true);
    expect(takeToken("moves", "caller-1")).toBe(false);
  });

  it("keys buckets by name as well as caller, so two named limiters never share tokens", () => {
    spyOn(Date, "now").mockReturnValue(3_000_000);
    const allowance = { burst: 1, perMinute: 60 };
    stubInstancePolicy({
      rateLimits: { moves: allowance, "bulk-moves": allowance },
    });

    expect(takeToken("moves", "same-caller")).toBe(true);
    expect(takeToken("moves", "same-caller")).toBe(false);
    expect(takeToken("bulk-moves", "same-caller")).toBe(true);
  });

  it("refills over time at the configured rate", () => {
    const now = spyOn(Date, "now").mockReturnValue(4_000_000);
    stubInstancePolicy({ rateLimits: { moves: { burst: 1, perMinute: 30 } } });

    expect(takeToken("moves", "caller-2")).toBe(true);
    expect(takeToken("moves", "caller-2")).toBe(false);

    now.mockReturnValue(4_002_000);
    expect(takeToken("moves", "caller-2")).toBe(true);
  });

  it("spends the bulk-moves bucket independently of the moves bucket", () => {
    spyOn(Date, "now").mockReturnValue(5_000_000);
    const caller = "bulk-vs-single-caller";

    const { burst } = DEFAULT_INSTANCE_POLICY.rateLimits["bulk-moves"];
    for (let i = 0; i < burst; i++) {
      expect(takeToken("bulk-moves", caller)).toBe(true);
    }
    expect(takeToken("bulk-moves", caller)).toBe(false);

    // The moves bucket, keyed by the same caller, is untouched by the above.
    expect(takeToken("moves", caller)).toBe(true);
  });

  it("clamps a bucket to a lowered burst on its next take, keeping what it already allowed", () => {
    spyOn(Date, "now").mockReturnValue(6_000_000);
    stubInstancePolicy({ rateLimits: { moves: { burst: 10, perMinute: 60 } } });
    expect(takeToken("moves", "lowered")).toBe(true);
    expect(takeToken("moves", "lowered")).toBe(true);

    // Eight tokens were left; the new burst holds three of them.
    stubInstancePolicy({ rateLimits: { moves: { burst: 3, perMinute: 60 } } });
    expect(takeToken("moves", "lowered")).toBe(true);
    expect(takeToken("moves", "lowered")).toBe(true);
    expect(takeToken("moves", "lowered")).toBe(true);
    expect(takeToken("moves", "lowered")).toBe(false);
  });

  it("refills at a changed rate from the next take", () => {
    const now = spyOn(Date, "now").mockReturnValue(7_000_000);
    stubInstancePolicy({ rateLimits: { moves: { burst: 1, perMinute: 60 } } });
    expect(takeToken("moves", "slowed")).toBe(true);

    // A second at sixty a minute would be a whole token; at one a minute it
    // is a sixtieth.
    stubInstancePolicy({ rateLimits: { moves: { burst: 1, perMinute: 1 } } });
    now.mockReturnValue(7_001_000);
    expect(takeToken("moves", "slowed")).toBe(false);
  });
});

describe("auth rate limiting", () => {
  // Better Auth can only read a client address from request headers, and
  // nothing in front of this API sets one, so its limiter put every caller in
  // one bucket. `/get-session` is the busiest route the app has — a page of
  // prefetched links asks once per link — and metering it locked the whole app
  // out until the window elapsed, then again on the retries.
  it("does not meter the session read", async () => {
    for (let i = 0; i < 100; i += 1) {
      const res = await app.request(`${baseUrl}${authUrl}/get-session`);
      expect(res.status).not.toBe(429);
    }
  });

  // A shared bucket makes a per-attempt limit a way for one reader to lock
  // everybody out of signing in.
  it("does not meter failed sign-ins within the auth-signin burst", async () => {
    // A fresh email every attempt, all from the same (default, unset)
    // address: this isolates the address bucket under test from the
    // per-account lockout (`auth.ts`), which would otherwise refuse an
    // address's sixth failure against one repeated email before the
    // address bucket's own burst of 10 ever came into play.
    const attempt = () =>
      app.request(`${baseUrl}${authUrl}/sign-in/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: `nobody-${crypto.randomUUID()}@example.com`,
          password: "not-the-password",
        }),
      });

    // auth-signin's burst is 10 — this stays under it, then the next
    // attempt proves the bucket is genuinely mounted on the route rather
    // than only asserting the absence of a false positive.
    for (let i = 0; i < 10; i += 1) {
      expect((await attempt()).status).not.toBe(429);
    }
    expect((await attempt()).status).toBe(429);
  });

  it("meters sign-up attempts on the auth-signup bucket (burst 5)", async () => {
    const attempt = () =>
      app.request(`${baseUrl}${authUrl}/sign-up/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: `rate-limit-signup-${Math.random()}@example.com`,
          password: "password123",
          name: "Rate Limit Signup",
        }),
      });

    for (let i = 0; i < 5; i += 1) {
      expect((await attempt()).status).not.toBe(429);
    }
    expect((await attempt()).status).toBe(429);
  });

  it("meters anonymous sign-ins on the guest-signin bucket (burst 5)", async () => {
    const attempt = () =>
      app.request(`${baseUrl}${authUrl}/sign-in/anonymous`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

    for (let i = 0; i < 5; i += 1) {
      expect((await attempt()).status).not.toBe(429);
    }
    expect((await attempt()).status).toBe(429);
  });
});
