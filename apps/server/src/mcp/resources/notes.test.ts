import { describe, expect, it } from "bun:test";
import { createNote } from "../../db/queries/notes.js";
import { setupSuite } from "../../test/fixtures.js";
import { authInfoFor, type Actor } from "../actor.js";
import { createMcpHandlerFor } from "../registry.js";
import { RESOURCES } from "./index.js";

const suite = setupSuite("MCP notes resources");
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

describe("projammr://tracks/{trackId}/lyrics", () => {
  it("answers an error for a track the caller has no access to", async () => {
    suite.requireProject();
    const trackId = await suite.mkTrack("Foreign track");
    const { body } = await readResource(
      actorFor(outsider.userId),
      `projammr://tracks/${trackId}/lyrics`
    );
    expect(body.result).toBeUndefined();
    expect(body.error).toBeDefined();
  });
});

describe("projammr://{kind}/{id}/notes", () => {
  it("answers a track's notes as markdown for a member", async () => {
    suite.requireProject();
    const trackId = await suite.mkTrack("Notes resource");
    const { body } = await readResource(
      actorFor(owner.userId),
      `projammr://track/${trackId}/notes`
    );
    expect(body.error).toBeUndefined();
    expect(typeof body.result?.contents?.[0]?.text).toBe("string");
  });
});

describe("projammr://notes/{noteId}", () => {
  it("answers a notebook note's markdown for its author", async () => {
    suite.requireProject();
    const note = await createNote(owner.userId, {
      body: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "A notebook note" }],
        },
      ],
      lyricsMode: false,
    });
    const { body } = await readResource(
      actorFor(owner.userId),
      `projammr://notes/${note.id}`
    );
    expect(body.error).toBeUndefined();
    expect(body.result?.contents?.[0]?.text).toContain("A notebook note");
  });

  it("answers an error for a note the caller may not read", async () => {
    suite.requireProject();
    const note = await createNote(owner.userId, {
      body: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Private" }],
        },
      ],
      lyricsMode: false,
    });
    const { body } = await readResource(
      actorFor(outsider.userId),
      `projammr://notes/${note.id}`
    );
    expect(body.result).toBeUndefined();
    expect(body.error).toBeDefined();
  });
});
