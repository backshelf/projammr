import { describe, expect, it } from "bun:test";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  restoreInstancePolicy,
  stubInstancePolicy,
} from "../test/instance-policy.js";
import { authInfoFor, type Actor, type Scope } from "./actor.js";
import { createMcpHandlerFor } from "./registry.js";
import { defineTool, type AnyToolSpec } from "./spec.js";

function actorFor(scopes: Scope[]): Actor {
  return {
    id: "registry-test-user",
    name: "Registry test",
    scopes: new Set(scopes),
    user: {} as Actor["user"],
  };
}

const readTool = defineTool({
  name: "read_thing",
  title: "Read thing",
  description: "Reads a fixture thing.",
  scope: "read",
  input: z.object({}),
  output: z.object({ value: z.string() }),
  run: async () => ({ value: "ok" }),
});

const writeTool = defineTool({
  name: "write_thing",
  title: "Write thing",
  description: "Writes a fixture thing.",
  scope: "write",
  input: z.object({}),
  output: z.object({ value: z.string() }),
  run: async () => ({ value: "written" }),
});

const missingTool = defineTool({
  name: "missing_thing",
  title: "Missing thing",
  description: "Always answers 404, for the not-found path.",
  scope: "read",
  input: z.object({}),
  output: z.object({ value: z.string() }),
  run: async () => {
    throw new HTTPException(404, { message: "thing not found" });
  },
});

const createdAt = new Date("2026-09-17T10:00:00.000Z");

const datedTool = defineTool({
  name: "dated_thing",
  title: "Dated thing",
  description: "Answers a row carrying a timestamp, as the entity reads do.",
  scope: "read",
  input: z.object({ since: z.date().optional() }),
  output: z.object({ createdAt: z.date() }),
  run: async () => ({ createdAt }),
});

const FIXTURE_TOOLS: AnyToolSpec[] = [
  readTool,
  writeTool,
  missingTool,
  datedTool,
];
const handler = createMcpHandlerFor(FIXTURE_TOOLS, []);

type JsonRpcResponse = {
  result?: {
    tools?: { name: string; inputSchema?: unknown; outputSchema?: unknown }[];
    isError?: boolean;
    content?: { text: string }[];
    structuredContent?: unknown;
  };
};

async function send(
  actor: Actor,
  method: "tools/list" | "tools/call",
  params: Record<string, unknown> = {}
): Promise<{ status: number; body: JsonRpcResponse }> {
  const name = typeof params.name === "string" ? params.name : undefined;
  const request = new Request("http://localhost/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": method,
      ...(name ? { "mcp-name": name } : {}),
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
  const res = await handler.fetch(request, {
    authInfo: authInfoFor(actor, { sub: actor.id }, "test-token"),
  });
  return { status: res.status, body: (await res.json()) as JsonRpcResponse };
}

const listTools = (actor: Actor) => send(actor, "tools/list");
const callTool = (actor: Actor, name: string, args: Record<string, unknown>) =>
  send(actor, "tools/call", { name, arguments: args });

describe("buildServer", () => {
  it("answers tools/list byte-identically across two requests", async () => {
    const actor = actorFor(["read", "write"]);
    const first = await listTools(actor);
    const second = await listTools(actor);
    expect(JSON.stringify(first.body)).toBe(JSON.stringify(second.body));
  });

  it("omits every write tool from a read-only actor's list", async () => {
    const { body } = await listTools(actorFor(["read"]));
    const names = body.result?.tools?.map((tool) => tool.name);
    expect(names).toEqual(["read_thing", "missing_thing", "dated_thing"]);
  });

  it("offers no tool of a scope the instance does not allow, whatever the token holds", async () => {
    stubInstancePolicy({ integrations: { mcpToolGroups: ["read"] } });
    try {
      const { body } = await listTools(actorFor(["read", "write"]));
      const names = body.result?.tools?.map((tool) => tool.name);
      expect(names).toEqual(["read_thing", "missing_thing", "dated_thing"]);
    } finally {
      restoreInstancePolicy();
    }
  });

  it("answers isError with the thrown status in the text when a tool fails", async () => {
    const { body } = await callTool(actorFor(["read"]), "missing_thing", {});
    expect(body.result?.isError).toBe(true);
    expect(body.result?.content?.[0]?.text).toContain("404");
  });

  it("returns structuredContent matching the tool's output schema", async () => {
    const { body } = await callTool(actorFor(["read"]), "read_thing", {});
    expect(body.result?.isError).toBeUndefined();
    expect(body.result?.structuredContent).toEqual({ value: "ok" });
  });

  it("advertises a Date in an input as the ISO string the client sends", async () => {
    const { body } = await listTools(actorFor(["read"]));
    const dated = body.result?.tools?.find(
      (tool) => tool.name === "dated_thing"
    );
    expect(dated?.inputSchema).toMatchObject({
      type: "object",
      properties: { since: { type: "string", format: "date-time" } },
    });
  });

  it("advertises a Date in an output as the ISO string the client receives", async () => {
    const { body } = await listTools(actorFor(["read"]));
    const dated = body.result?.tools?.find(
      (tool) => tool.name === "dated_thing"
    );
    expect(dated?.outputSchema).toMatchObject({
      type: "object",
      properties: { createdAt: { type: "string", format: "date-time" } },
    });
  });

  it("returns a Date in structuredContent as an ISO string", async () => {
    const { body } = await callTool(actorFor(["read"]), "dated_thing", {});
    expect(body.result?.isError).toBeUndefined();
    expect(body.result?.structuredContent).toEqual({
      createdAt: createdAt.toISOString(),
    });
  });
});
