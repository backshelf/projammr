import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "bun:test";
import { jsonErrorHandler } from "../lib/http.js";
import { redirectLogs } from "../lib/log.js";
import { trustedOrigins } from "../lib/env.js";
import { csrfProtection, isTrustedOrigin } from "./trusted-origin.js";

const trusted = trustedOrigins[0]!;
const foreign = "https://evil.example";

function protectedApp() {
  const app = new Hono();
  app.use("*", csrfProtection);
  app.post("/form", (c) => c.text("ok"));
  app.patch("/form", (c) => c.text("ok"));
  app.delete("/form", (c) => c.text("ok"));
  app.post("/boom", () => {
    throw new HTTPException(400, { message: "downstream failure" });
  });
  app.onError(jsonErrorHandler);
  return app;
}

const formPost = (headers: Record<string, string>) => ({
  method: "POST",
  headers: { "Content-Type": "multipart/form-data; boundary=x", ...headers },
});

describe("isTrustedOrigin", () => {
  it("matches an origin on the trusted list", () => {
    expect(isTrustedOrigin(trusted)).toBe(true);
  });

  it("matches case-insensitively", () => {
    expect(isTrustedOrigin(trusted.toUpperCase())).toBe(true);
  });

  it("refuses an origin off the list", () => {
    expect(isTrustedOrigin(foreign)).toBe(false);
  });
});

describe("csrfProtection", () => {
  it("passes a form post from a trusted origin", async () => {
    const app = protectedApp();
    const res = await app.request(
      "/form",
      formPost({ Origin: trusted, Cookie: "session=1" })
    );
    expect(res.status).toBe(200);
  });

  it("refuses a form post riding a cookie from a foreign origin", async () => {
    const app = protectedApp();
    const res = await app.request(
      "/form",
      formPost({ Origin: foreign, Cookie: "session=1" })
    );
    expect(res.status).toBe(403);
  });

  it("does not check a JSON body — the browser's own preflight already covers it", async () => {
    const app = protectedApp();
    const res = await app.request("/form", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: foreign,
        Cookie: "session=1",
      },
      body: "{}",
    });
    expect(res.status).toBe(200);
  });

  // A bodyless request carries no `Content-Type`, which the check reads as
  // `text/plain`: a cross-site form post unless its origin is trusted.
  describe("a bodyless request", () => {
    for (const method of ["POST", "PATCH", "DELETE"]) {
      it(`passes a ${method} from a trusted origin — the shape a server action sends`, async () => {
        const app = protectedApp();
        const res = await app.request("/form", {
          method,
          headers: { Origin: trusted, Cookie: "session=1" },
        });
        expect(res.status).toBe(200);
      });
    }

    it("refuses a POST riding a cookie from a foreign origin — CORS-simple, so nothing else stops it", async () => {
      const app = protectedApp();
      const res = await app.request("/form", {
        method: "POST",
        headers: { Origin: foreign, Cookie: "session=1" },
      });
      expect(res.status).toBe(403);
    });

    it("refuses a POST riding a cookie with no origin at all", async () => {
      const app = protectedApp();
      const res = await app.request("/form", {
        method: "POST",
        headers: { Cookie: "session=1" },
      });
      expect(res.status).toBe(403);
    });
  });

  it("skips the check entirely for a bearer-token caller, foreign origin and all", async () => {
    const app = protectedApp();
    const res = await app.request(
      "/form",
      formPost({ Origin: foreign, Authorization: "Bearer test-token" })
    );
    expect(res.status).toBe(200);
  });

  it("skips the check for a cookie-less caller, foreign origin and all — an OAuth token exchange authenticates by its code, not a cookie", async () => {
    const app = protectedApp();
    const res = await app.request("/form", formPost({ Origin: foreign }));
    expect(res.status).toBe(200);
  });

  it("lets a downstream error propagate untouched rather than reporting it as a refused origin", async () => {
    const app = protectedApp();
    const lines: string[] = [];
    const restore = redirectLogs((line) => lines.push(line));
    try {
      const res = await app.request(
        "/boom",
        formPost({ Origin: trusted, Cookie: "session=1" })
      );
      expect(res.status).toBe(400);
    } finally {
      restore();
    }
    expect(lines.some((line) => line.includes("refused origin"))).toBe(false);
  });

  it("logs a refused origin once, not once per request", async () => {
    // A distinct origin per test keeps this independent of test order: the
    // LRU is a module singleton, so a value another test already refused
    // would otherwise still be warm here.
    const onceOnly = "https://logged-once.evil.example";
    const app = protectedApp();
    const lines: string[] = [];
    const restore = redirectLogs((line) => lines.push(line));
    try {
      await app.request(
        "/form",
        formPost({ Origin: onceOnly, Cookie: "session=1" })
      );
      await app.request(
        "/form",
        formPost({ Origin: onceOnly, Cookie: "session=1" })
      );
    } finally {
      restore();
    }
    const refusals = lines.filter((line) => line.includes("refused origin"));
    expect(refusals).toHaveLength(1);
  });
});
