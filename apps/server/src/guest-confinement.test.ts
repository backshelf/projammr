import { describe, expect, it } from "bun:test";
import { app } from "./app.js";
import { db } from "./db/index.js";
import { trackAudios } from "./db/schema/tracks.js";
import { authenticated } from "./middleware/authenticated.js";
import {
  cookieHeaders,
  servedAt,
  setupSuite,
  signInAsGuest,
} from "./test/fixtures.js";
import { ensureMcpServerListening, mintMcpToken } from "./test/mcp.js";

const suite = setupSuite("Guest confinement");
const { requireProject, request, mkTrack, uploadAsset } = suite;

/**
 * Every path Hono composed the `authenticated` middleware into: the
 * wildcard mounts (`app.use("/x/*", authenticated)`) and the per-route uses
 * inside `routes/sharelinks.ts`. Read straight off the compiled app rather
 * than a hand-kept list — `route.handler` is the exact function reference
 * `app.ts` and every route file passed to `authenticated`, so a mount added
 * next year is covered the moment it reuses that same import, with nothing
 * here to update.
 */
function authenticatedMounts(): { method: string; path: string }[] {
  const seen = new Set<string>();
  const mounts: { method: string; path: string }[] = [];
  for (const route of app.routes) {
    if (route.handler !== authenticated) continue;
    const key = `${route.method} ${route.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    mounts.push({ method: route.method, path: route.path });
  }
  return mounts;
}

/**
 * A concrete, harmless request for a route pattern: every `:param` and the
 * trailing segment of a wildcard mount becomes `0`. `authenticated` runs
 * ahead of every resolver and handler on its mount, so it throws before the
 * question of whether `0` names a real row is ever reached — the probe
 * never needs a row that exists.
 */
function probePath(pattern: string): string {
  return pattern.replace(/\*/g, "0").replace(/:[^/]+/g, "0");
}

describe("every authenticated mount", () => {
  it("refuses an anonymous guest session with 403, on every one of them", async () => {
    requireProject();
    const mounts = authenticatedMounts();
    // A regression on this file itself: if the introspection above ever came
    // back empty, every assertion below would vacuously pass.
    expect(mounts.length).toBeGreaterThan(10);

    const guestCookie = await signInAsGuest();

    for (const { method, path } of mounts) {
      // A wildcard mount (`ALL /x/*`) covers every verb, so any one of them
      // proves the gate — except GET, which `/invites/:token` also answers
      // from a dedicated, deliberately public route registered ahead of the
      // wildcard (the invite-acceptance page reads it before sign-in). POST
      // has no such shadow on any mount here.
      const probeMethod = method === "ALL" ? "POST" : method;
      const res = await app.request(probePath(path), {
        method: probeMethod,
        headers: cookieHeaders(guestCookie),
      });
      expect(res.status, `${probeMethod} ${path} as a guest`).toBe(403);
    }
  });

  it("rejects a guest creating a project — the hole this closes", async () => {
    const guestCookie = await signInAsGuest();

    const res = await app.request("/api/projects", {
      method: "POST",
      headers: cookieHeaders(guestCookie),
      body: JSON.stringify({
        name: "Guest-created project",
        description: [],
        links: [],
      }),
    });

    expect(res.status).toBe(403);
  });
});

/** A track with one audio version behind it, bypassing the upload pipeline —
 *  these tests are about the guest gate, not about transcoding. */
async function mkSharedTrack(title: string) {
  const trackId = await mkTrack(title);
  const asset = await uploadAsset(`${title}.jpeg`);
  const [audio] = await db
    .insert(trackAudios)
    .values({ trackId, assetId: asset.id, version: 1, isPrimary: true })
    .returning({ id: trackAudios.id });
  return { trackId, trackAudioId: audio!.id };
}

describe("the guest-facing share routes", () => {
  it("still serves the share and lets a guest comment", async () => {
    requireProject();
    const { trackId, trackAudioId } = await mkSharedTrack("Confinement share");
    const shared = await request("owner", "/share/connected", {
      method: "POST",
      body: JSON.stringify({ entityType: "track", entityId: trackId }),
    });
    expect(shared.status).toBe(201);
    const { token } = (await shared.json()) as { token: string };

    const guestCookie = await signInAsGuest();

    const read = await app.request(`/api/share/${token}`, {
      headers: cookieHeaders(guestCookie),
    });
    expect(read.status).toBe(200);

    const commented = await app.request(`/api/share/${token}/comments`, {
      method: "POST",
      headers: cookieHeaders(guestCookie),
      body: JSON.stringify({ trackAudioId, content: "Sounds great!" }),
    });
    expect(commented.status).toBe(201);
  });
});

describe("/static/*", () => {
  it("refuses a guest ahead of the row lookup, for a real key and a made-up one alike", async () => {
    requireProject();
    const asset = await uploadAsset("guest-cannot-read-this.jpeg");
    const guestCookie = await signInAsGuest();

    const real = await app.request(servedAt(asset.assetPath), {
      headers: cookieHeaders(guestCookie),
    });
    expect(real.status).toBe(403);

    // A guest cannot tell a real key from a nonexistent one by status code:
    // both are refused before the row is ever looked up.
    const madeUp = await app.request(servedAt("assets/does-not-exist.jpeg"), {
      headers: cookieHeaders(guestCookie),
    });
    expect(madeUp.status).toBe(403);
  });
});

describe("/api/mcp", () => {
  it("refuses an anonymous subject's token", async () => {
    ensureMcpServerListening();
    const guestCookie = await signInAsGuest();
    const token = await mintMcpToken({ cookie: guestCookie }, ["read"]);

    const res = await app.request("/api/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "Mcp-Protocol-Version": "2026-07-28",
        "Mcp-Method": "tools/list",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      }),
    });

    expect(res.status).toBe(403);
  });
});
