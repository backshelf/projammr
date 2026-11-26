import { beforeAll, describe, expect, it, setSystemTime } from "bun:test";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { app } from "../app.js";
import { db } from "../db/index.js";
import { users } from "../db/schema/auth.js";
import { signUpAndSignIn } from "../test/fixtures.js";
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
