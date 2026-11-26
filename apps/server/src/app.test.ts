import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { app } from "./app.js";
import { db } from "./db/index.js";
import { betterAuthUrl, mcpResource, trustedOrigins } from "./lib/env.js";
import { appVersion } from "./lib/version.js";
import { authUrl, baseUrl, setupSuite } from "./test/fixtures.js";

const suite = setupSuite("Origins");
const { requireProject, request } = suite;

const nodeEnv = process.env.NODE_ENV;

afterEach(() => {
  process.env.NODE_ENV = nodeEnv;
});

describe("docs", () => {
  it("serves the reference outside production", async () => {
    const res = await app.request("/api/docs");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("is not advertised to anonymous production traffic", async () => {
    process.env.NODE_ENV = "production";

    const res = await app.request("/api/docs");

    expect(res.status).toBe(404);
  });
});

describe("openapi", () => {
  it("serves the spec outside production, where typegen reads it", async () => {
    const res = await app.request("/api/openapi");

    expect(res.status).toBe(200);
    expect((await res.json()).openapi).toBeTruthy();
  });

  it("requires a session in production", async () => {
    process.env.NODE_ENV = "production";

    const res = await app.request("/api/openapi");

    expect(res.status).toBe(401);
  });
});

describe("the auth spec", () => {
  it("is served outside production, like the API's own", async () => {
    const res = await app.request("/api/auth/openapi");

    expect(res.status).toBe(200);
    expect((await res.json()).paths).toBeTruthy();
  });

  it("needs a session in production", async () => {
    requireProject();
    process.env.NODE_ENV = "production";

    const anon = await app.request("/api/auth/openapi");
    expect(anon.status).toBe(401);

    const signedIn = await request("owner", "/auth/openapi");
    expect(signedIn.status).toBe(200);
  });

  /**
   * Better Auth's `openAPI()` plugin serves the same document from its own two
   * paths under the `/auth/*` catch-all. Gating the alias alone left them open,
   * and `/reference` renders the schema as a browsable page.
   */
  it("needs a session in production on the plugin's own paths too", async () => {
    process.env.NODE_ENV = "production";

    for (const path of [
      "/api/auth/open-api/generate-schema",
      "/api/auth/reference",
    ]) {
      expect((await app.request(path)).status, path).toBe(401);
    }
  });
});

describe("request ids", () => {
  it("stamps every response", async () => {
    const res = await app.request("/api/docs");

    expect(res.headers.get("X-Request-Id")).toBeTruthy();
  });

  it("honours an id the caller brought", async () => {
    const res = await app.request("/api/docs", {
      headers: { "X-Request-Id": "id-from-the-caller" },
    });

    expect(res.headers.get("X-Request-Id")).toBe("id-from-the-caller");
  });
});

describe("trusted origins", () => {
  const allowed = trustedOrigins[0]!;

  it("echoes a trusted origin with credentials and answers an unknown one with none", async () => {
    requireProject();

    const trusted = await request("viewer", `/projects/${suite.projectId}`, {
      headers: { Origin: allowed },
    });
    expect(trusted.headers.get("access-control-allow-origin")).toBe(allowed);
    expect(trusted.headers.get("access-control-allow-credentials")).toBe(
      "true"
    );

    const untrusted = await request("viewer", `/projects/${suite.projectId}`, {
      headers: { Origin: "https://evil.test" },
    });
    expect(untrusted.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("applies the same rule to preflight", async () => {
    requireProject();

    const preflight = (origin: string) =>
      app.request(`${baseUrl}/projects/${suite.projectId}`, {
        method: "OPTIONS",
        headers: {
          Origin: origin,
          "Access-Control-Request-Method": "GET",
        },
      });

    const trusted = await preflight(allowed);
    expect(trusted.headers.get("access-control-allow-origin")).toBe(allowed);

    const untrusted = await preflight("https://evil.test");
    expect(untrusted.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("health", () => {
  it("answers a caller with no session", async () => {
    const res = await app.request(`${baseUrl}/health`);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.db).toBe(true);
    expect(body.media).toEqual({ ffmpeg: true });
    expect(typeof body.queue).toBe("number");
    expect(body.version).toBe(appVersion);
  });

  it("answers 503 when the database is unreachable", async () => {
    const execute = spyOn(db, "execute").mockRejectedValue(
      new Error("connection refused")
    );

    const res = await app.request(`${baseUrl}/health`);

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe("degraded");
    expect(body.db).toBe(false);
    expect(body.version).toBe(appVersion);

    execute.mockRestore();
  });
});

describe("OAuth discovery", () => {
  // MCP clients look for both documents at the origin root, outside `/api`.
  it("serves the MCP protected-resource metadata at the root", async () => {
    const res = await app.request(
      "/.well-known/oauth-protected-resource/api/mcp"
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.resource).toBe(mcpResource);
    expect(body.authorization_servers).toEqual([`${betterAuthUrl}/api/auth`]);
    expect(body.scopes_supported).toEqual(["read", "write"]);
  });

  it("serves the authorization-server metadata at the root", async () => {
    const res = await app.request(
      "/.well-known/oauth-authorization-server/api/auth"
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.issuer).toBe(`${betterAuthUrl}/api/auth`);
    expect(body.registration_endpoint).toBe(
      `${betterAuthUrl}/api/auth/oauth2/register`
    );
  });
});

describe("OAuth client registration", () => {
  // Registration is open to anyone, so a caller gets five a minute.
  it("refuses the sixth registration in a minute", async () => {
    const register = () =>
      app.request(`${baseUrl}${authUrl}/oauth2/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Forwarded-For": "10.9.9.1",
        },
        body: JSON.stringify({
          client_name: "Registration limit",
          application_type: "native",
          redirect_uris: ["http://localhost:1/callback"],
          token_endpoint_auth_method: "none",
        }),
      });

    for (let i = 0; i < 5; i += 1) {
      expect((await register()).status).toBe(201);
    }
    expect((await register()).status).toBe(429);
  });
});
