import { describe, expect, it } from "bun:test";
import { setupSuite } from "../../test/fixtures.js";
import { authInfoFor, type Actor } from "../actor.js";
import { createMcpHandlerFor } from "../registry.js";
import { RESOURCES } from "./index.js";

const suite = setupSuite("MCP read resources");
const { owner, outsider } = suite;

function actorFor(userId: string): Actor {
  return {
    id: userId,
    name: "",
    scopes: new Set(["read"]),
    user: {} as Actor["user"],
  };
}

const handler = createMcpHandlerFor([], RESOURCES);

type JsonRpcResponse = {
  result?: { contents?: { text: string }[] };
  error?: unknown;
};

async function readResource(
  actor: Actor,
  uri: string
): Promise<{ status: number; body: JsonRpcResponse }> {
  const request = new Request("http://localhost/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": "resources/read",
      "mcp-name": uri,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "resources/read",
      params: {
        uri,
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

describe("projammr://projects", () => {
  it("answers the actor's own projects as JSON", async () => {
    suite.requireProject();
    const { body } = await readResource(
      actorFor(owner.userId),
      "projammr://projects"
    );
    const contents = JSON.parse(body.result?.contents?.[0]?.text ?? "[]") as {
      id: number;
    }[];
    expect(contents.some((project) => project.id === suite.projectId)).toBe(
      true
    );
  });
});

describe("projammr://projects/{projectId}", () => {
  it("answers the project's detail for a member", async () => {
    suite.requireProject();
    const uri = `projammr://projects/${suite.projectId}`;
    const { body } = await readResource(actorFor(owner.userId), uri);
    const detail = JSON.parse(body.result?.contents?.[0]?.text ?? "{}") as {
      id: number;
    };
    expect(detail.id).toBe(suite.projectId);
  });

  it("answers an error, never another member's data, for a caller outside the project", async () => {
    suite.requireProject();
    const uri = `projammr://projects/${suite.projectId}`;
    const { body } = await readResource(actorFor(outsider.userId), uri);
    expect(body.result).toBeUndefined();
    expect(body.error).toBeDefined();
  });
});
