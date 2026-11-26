import { Hono } from "hono";
import { describe, expect, it } from "bun:test";
import { clientAddress } from "./client-address.js";

function appWithHops(hops: number) {
  const app = new Hono();
  app.get("/whoami", (c) => c.text(clientAddress(c, hops)));
  return app;
}

describe("clientAddress", () => {
  it("reads the entry `hops` proxies back from the right, ignoring a spoofed left-most entry", async () => {
    const app = appWithHops(2);
    const res = await app.request("/whoami", {
      headers: {
        // A caller can write anything ahead of what its own proxy appended;
        // only the two rightmost entries (Caddy's, then the Next rewrite's)
        // are trusted at hops = 2.
        "x-forwarded-for": "9.9.9.9, 203.0.113.5, 10.0.0.7",
      },
    });
    expect(await res.text()).toBe("203.0.113.5");
  });

  it("reads Caddy's own entry at the compose default of one hop", async () => {
    const app = appWithHops(1);
    const res = await app.request("/whoami", {
      headers: {
        // What compose actually produces: Caddy appends the address it saw the
        // connection from and routes `/api/*` straight here, and the web
        // service forwards the chain unchanged, so the rightmost entry is the
        // caller however the request arrived. Everything left of it is a
        // browser's own invention.
        "x-forwarded-for": "9.9.9.9, 198.51.100.4, 203.0.113.5",
      },
    });
    expect(await res.text()).toBe("203.0.113.5");
  });

  it("ignores the header entirely at hops = 0", async () => {
    const app = appWithHops(0);
    const res = await app.request("/whoami", {
      headers: { "x-forwarded-for": "203.0.113.5" },
    });
    // No trusted proxy means no socket to fall back to under the test
    // harness either, but the point is the header was never consulted: the
    // spoofable value never reaches the caller's key.
    expect(await res.text()).not.toBe("203.0.113.5");
  });

  it("falls back to the socket address when the chain is shorter than `hops`", async () => {
    const app = appWithHops(3);
    const res = await app.request("/whoami", {
      headers: { "x-forwarded-for": "203.0.113.5, 10.0.0.7" },
    });
    const body = await res.text();
    expect(body).not.toBe("203.0.113.5");
    expect(body).not.toBe("10.0.0.7");
    expect(body).toBe("unknown");
  });

  it("ignores a missing header the same way at any hop count", async () => {
    const app = appWithHops(2);
    const res = await app.request("/whoami");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("unknown");
  });
});
