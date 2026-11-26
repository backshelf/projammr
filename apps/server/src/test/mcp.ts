import { createHash, randomBytes } from "node:crypto";
import { app } from "../app.js";
import { auth } from "../auth.js";
import { mcpResource } from "../lib/env.js";
import { setListeningPort } from "../lib/self-origin.js";
import type { Scope } from "../mcp/actor.js";
import { authUrl, baseUrl, type Actor } from "./fixtures.js";

const redirectUri = "http://localhost:1/callback";

/**
 * `requireMcpAuth` fetches the provider's JWKS over HTTP from the server's own
 * loopback listener (`lib/self-origin.ts`), so `callTool` needs the app
 * listening: every other test drives `app.request` with no port bound, but
 * this one path cannot. Bound once per test process on a free port and never
 * explicitly closed (`unref`, like the rate limiter's sweep timer); every MCP
 * test file shares it.
 */
let mcpServer: ReturnType<typeof Bun.serve> | undefined;

export function ensureMcpServerListening(): void {
  if (mcpServer) return;
  mcpServer = Bun.serve({ fetch: app.fetch, port: 0 });
  mcpServer.unref();
  setListeningPort(mcpServer.port ?? 0);
}

/**
 * An MCP access token for `actor`, minted through the provider's real
 * authorization-code flow with PKCE, so every token a test holds went through
 * the same authorize and token endpoints Claude Code uses. The client is a
 * public native one (loopback redirect, no secret) created through the
 * server-only admin endpoint on the user's own session, the one that may mark
 * it as skipping consent: the test is the user and has nothing to click.
 */
export async function mintMcpToken(
  actor: Pick<Actor, "cookie">,
  scopes: Scope[]
): Promise<string> {
  const client = await auth.api.adminCreateOAuthClient({
    headers: new Headers({ cookie: actor.cookie }),
    body: {
      client_name: "MCP test client",
      application_type: "native",
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "none",
      skip_consent: true,
      scope: "read write",
    },
  });

  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const query = new URLSearchParams({
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: redirectUri,
    scope: scopes.join(" "),
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
  if (!code) {
    throw new Error(
      `authorize answered ${authorized.status} without a code: ${location ?? (await authorized.text())}`
    );
  }

  const exchanged = await app.request(`${baseUrl}${authUrl}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: client.client_id,
      code_verifier: verifier,
      resource: mcpResource,
    }),
  });
  if (exchanged.status !== 200) {
    throw new Error(
      `token exchange answered ${exchanged.status}: ${await exchanged.text()}`
    );
  }
  return ((await exchanged.json()) as { access_token: string }).access_token;
}

/**
 * One JSON-RPC request over the stateless 2026-07-28 transport: the protocol
 * version, client info and capabilities travel in the request's `_meta` and
 * its SEP-2243 routing headers (`Mcp-Method`, and `Mcp-Name` for a named
 * call), with no initialize handshake before it. A result nests under
 * `body.result`.
 */
async function mcpRequest(
  token: string,
  method: string,
  params: Record<string, unknown>,
  name?: string
): Promise<{ status: number; body: unknown }> {
  ensureMcpServerListening();
  const res = await app.request(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "Mcp-Protocol-Version": "2026-07-28",
      "Mcp-Method": method,
      ...(name ? { "Mcp-Name": name } : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params: {
        ...params,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientInfo": { name: "test", version: "0" },
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    }),
  });
  return { status: res.status, body: await res.json() };
}

/** One `tools/call`. A token needs `read` on every call, plus `write` for a write tool. */
export function callTool(
  token: string,
  name: string,
  args: Record<string, unknown>
): Promise<{ status: number; body: unknown }> {
  return mcpRequest(token, "tools/call", { name, arguments: args }, name);
}

/** A tool as `tools/list` renders it, input schema included. */
export type ListedTool = {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
};

/** Every tool `tools/list` shows a token, in registration order. */
export async function listTools(token: string): Promise<ListedTool[]> {
  const { body } = await mcpRequest(token, "tools/list", {});
  const { result } = body as { result: { tools: ListedTool[] } };
  return result.tools;
}

/** The tool names `tools/list` shows a token, in registration order. */
export async function listToolNames(token: string): Promise<string[]> {
  return (await listTools(token)).map((tool) => tool.name);
}
