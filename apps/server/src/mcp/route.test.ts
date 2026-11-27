import { createHash, randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it, setSystemTime } from "bun:test";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { app } from "../app.js";
import { auth } from "../auth.js";
import { db } from "../db/index.js";
import { users } from "../db/schema/auth.js";
import { oauthRefreshTokens } from "../db/schema/oauth.js";
import { mcpResource } from "../lib/env.js";
import { DEFAULT_INSTANCE_POLICY } from "../lib/instance-policy.js";
import { authUrl, baseUrl, signUpAndSignIn } from "../test/fixtures.js";
import {
  restoreInstancePolicy,
  stubInstancePolicy,
} from "../test/instance-policy.js";
import { captureLogs } from "../test/log.js";
import {
  callTool,
  ensureMcpServerListening,
  mintMcpToken,
} from "../test/mcp.js";
import { defineTool } from "./spec.js";
import { createMcpRoute } from "./route.js";

const mcpUrl = "/api/mcp";

const fixtureWriteTool = defineTool({
  name: "delete_thing",
  title: "Delete thing",
  description: "A fixture destructive tool for the step-up test.",
  scope: "write",
  destructive: true,
  input: z.object({}),
  output: z.object({ ok: z.boolean() }),
  run: async () => ({ ok: true }),
});

async function toolsListRequest(
  headers: Record<string, string> = {}
): Promise<Response> {
  return app.request(mcpUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "Mcp-Protocol-Version": "2026-07-28",
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    }),
  });
}

describe("POST /api/mcp", () => {
  // The route addresses its own listener for the JWKS, as the real server does.
  beforeAll(ensureMcpServerListening);

  it("answers 401 naming resource_metadata and every offered scope when no token is presented", async () => {
    // No Origin header either: the origin guard passes a request that omits
    // it, so this reaches token verification and fails there instead of
    // being refused as an untrusted origin.
    const res = await toolsListRequest();
    expect(res.status).toBe(401);
    const challenge = res.headers.get("WWW-Authenticate") ?? "";
    expect(challenge).toContain("resource_metadata=");
    expect(challenge).toContain('scope="read write"');
    expect(challenge).not.toContain("offline_access");
  });

  it("challenges for read alone when the instance offers no write tools", async () => {
    stubInstancePolicy({ integrations: { mcpToolGroups: ["read"] } });
    try {
      const res = await toolsListRequest();
      expect(res.status).toBe(401);
      const challenge = res.headers.get("WWW-Authenticate") ?? "";
      expect(challenge).toContain('scope="read"');
    } finally {
      restoreInstancePolicy();
    }
  });

  it("refuses a browser-declared origin the API does not trust", async () => {
    const res = await toolsListRequest({ Origin: "https://evil.example" });
    expect(res.status).toBe(403);
  });

  it("rejects the 61st call in a burst with 429", async () => {
    const user = await signUpAndSignIn("MCP burst");
    const token = await mintMcpToken(user, ["read"]);

    // The bucket refills against the clock, so a burst that takes more than
    // a moment on a busy machine would earn its 61st call back. Holding the
    // clock still makes the burst instantaneous as far as the bucket knows.
    setSystemTime(new Date());
    let last = { status: 0 };
    try {
      for (let i = 0; i < 61; i += 1) {
        last = await callTool(token, "list_projects", {});
      }
    } finally {
      setSystemTime();
    }
    expect(last.status).toBe(429);
  });

  it("answers 401 for a token whose user row has since been deleted", async () => {
    const user = await signUpAndSignIn("MCP deleted user");
    const token = await mintMcpToken(user, ["read"]);

    await db.delete(users).where(eq(users.id, user.userId));

    const { status } = await callTool(token, "list_projects", {});
    expect(status).toBe(401);
  });

  it("answers 403 with an insufficient_scope step-up challenge for a write tool a read-only token names", async () => {
    const user = await signUpAndSignIn("MCP step-up");
    const token = await mintMcpToken(user, ["read"]);
    const route = createMcpRoute([fixtureWriteTool]);

    const res = await route.request("/", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "Mcp-Protocol-Version": "2026-07-28",
        "Mcp-Method": "tools/call",
        "Mcp-Name": "delete_thing",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "delete_thing",
          arguments: {},
          _meta: {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientInfo": {
              name: "test",
              version: "0",
            },
            "io.modelcontextprotocol/clientCapabilities": {},
          },
        },
      }),
    });

    expect(res.status).toBe(403);
    const challenge = res.headers.get("WWW-Authenticate") ?? "";
    expect(challenge).toContain("insufficient_scope");
    expect(challenge).toContain('scope="write"');
  });

  it("logs the calling actor's id", async () => {
    const user = await signUpAndSignIn("MCP request log");
    const token = await mintMcpToken(user, ["read"]);

    const written = await captureLogs(() =>
      callTool(token, "list_projects", {})
    );

    const mcpLines = written.filter((line) => line.includes('"/api/mcp"'));
    expect(
      mcpLines.some((line) =>
        line.includes(`userId=${JSON.stringify(user.userId)}`)
      )
    ).toBe(true);
  });
});

describe("MCP OAuth discovery and token lifetimes", () => {
  beforeAll(ensureMcpServerListening);

  it("advertises offline_access on the authorization server but keeps protected resource metadata scoped to MCP_SCOPES", async () => {
    const resourceRes = await app.request(
      "/.well-known/oauth-protected-resource"
    );
    expect(resourceRes.status).toBe(200);
    const resourceMeta = (await resourceRes.json()) as {
      resource: string;
      authorization_servers: string[];
      scopes_supported: string[];
    };
    expect(resourceMeta.resource).toBe(mcpResource);
    expect(resourceMeta.scopes_supported).toEqual(["read", "write"]);
    expect(resourceMeta.scopes_supported).not.toContain("offline_access");

    const authServerUrl = new URL(resourceMeta.authorization_servers[0]!);
    const authServerPath = authServerUrl.pathname.replace(/\/$/, "");
    const asRes = await app.request(
      `/.well-known/oauth-authorization-server${authServerPath}`
    );
    expect(asRes.status).toBe(200);
    const asMeta = (await asRes.json()) as { scopes_supported: string[] };
    expect(asMeta.scopes_supported).toEqual([
      "read",
      "write",
      "offline_access",
    ]);
  });

  it("issues 24-hour access tokens and 90-day refresh tokens when offline_access is granted, and refreshes cleanly", async () => {
    const actor = await signUpAndSignIn("MCP offline refresh");
    const redirectUri = "http://localhost:1/callback";
    const client = await auth.api.adminCreateOAuthClient({
      headers: new Headers({ cookie: actor.cookie }),
      body: {
        client_name: "MCP refresh test client",
        application_type: "native",
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: "none",
        skip_consent: true,
        scope: "read write offline_access",
      },
    });

    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const query = new URLSearchParams({
      response_type: "code",
      client_id: client.client_id,
      redirect_uri: redirectUri,
      scope: "read write offline_access",
      resource: mcpResource,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: randomBytes(8).toString("hex"),
    });

    const authorized = await app.request(
      `${baseUrl}${authUrl}/oauth2/authorize?${query}`,
      { headers: { cookie: actor.cookie } }
    );
    const location = authorized.headers.get("location");
    const code = location && new URL(location).searchParams.get("code");
    expect(code).toBeTruthy();

    const issuedAt = Date.now();
    const exchanged = await app.request(`${baseUrl}${authUrl}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: code!,
        redirect_uri: redirectUri,
        client_id: client.client_id,
        code_verifier: verifier,
        resource: mcpResource,
      }),
    });
    expect(exchanged.status).toBe(200);
    const tokenBody = (await exchanged.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      scope: string;
    };

    const expectedAccessSeconds =
      DEFAULT_INSTANCE_POLICY.integrations.mcpAccessTokenHours * 60 * 60;
    const expectedRefreshSeconds =
      DEFAULT_INSTANCE_POLICY.integrations.mcpRefreshTokenDays * 24 * 60 * 60;

    expect(tokenBody.expires_in).toBe(expectedAccessSeconds);
    expect(tokenBody.refresh_token).toBeTruthy();

    const [refreshRow] = await db
      .select({ expiresAt: oauthRefreshTokens.expiresAt })
      .from(oauthRefreshTokens)
      .where(eq(oauthRefreshTokens.clientId, client.client_id));
    expect(refreshRow).toBeDefined();
    const refreshDeltaSeconds =
      (refreshRow!.expiresAt.getTime() - issuedAt) / 1000;
    expect(refreshDeltaSeconds).toBeGreaterThan(expectedRefreshSeconds - 60);
    expect(refreshDeltaSeconds).toBeLessThan(expectedRefreshSeconds + 60);

    const refreshed = await app.request(`${baseUrl}${authUrl}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tokenBody.refresh_token!,
        client_id: client.client_id,
        resource: mcpResource,
      }),
    });
    expect(refreshed.status).toBe(200);
    const refreshedBody = (await refreshed.json()) as {
      access_token: string;
      expires_in: number;
    };
    expect(refreshedBody.expires_in).toBe(expectedAccessSeconds);

    const call = await callTool(
      refreshedBody.access_token,
      "list_projects",
      {}
    );
    expect(call.status).toBe(200);
  });
});
