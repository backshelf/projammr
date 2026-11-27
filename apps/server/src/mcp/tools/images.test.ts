import { stubGlobal, unstubAllGlobals } from "@workspace/test/globals";
import { beforeAll, describe, expect, it } from "bun:test";
import sharp from "sharp";
import { setupSuite } from "../../test/fixtures.js";
import {
  callTool,
  ensureMcpServerListening,
  listToolNames,
  mintMcpToken,
} from "../../test/mcp.js";

const suite = setupSuite("MCP image tools");
const { editor, viewer } = suite;

beforeAll(ensureMcpServerListening);

type ToolResult = { status: number; body: unknown };
type ToolResultBody = {
  result?: {
    isError?: boolean;
    structuredContent?: Record<string, unknown>;
    content?: { type: "text"; text: string }[];
  };
};

function resultOf(res: ToolResult): ToolResultBody["result"] {
  return (res.body as ToolResultBody).result;
}

function contentOf(res: ToolResult): Record<string, unknown> {
  const data = resultOf(res)?.structuredContent;
  if (!data) throw new Error(`no structuredContent in ${JSON.stringify(res)}`);
  return data;
}

async function vividJpeg(): Promise<Uint8Array<ArrayBuffer>> {
  const buf = await sharp({
    create: {
      width: 64,
      height: 64,
      channels: 3,
      background: { r: 230, g: 55, b: 65 },
    },
  })
    .jpeg()
    .toBuffer();
  return Uint8Array.from(buf);
}

describe("MCP cover tools", () => {
  it("exposes list_images to readers and set_cover/remove_cover to writers", async () => {
    suite.requireProject();
    const readToken = await mintMcpToken(viewer, ["read"]);
    const writeToken = await mintMcpToken(editor, ["read", "write"]);

    const readNames = await listToolNames(readToken);
    expect(readNames).toContain("list_images");
    expect(readNames).not.toContain("set_cover");
    expect(readNames).not.toContain("remove_cover");

    const writeNames = await listToolNames(writeToken);
    expect(writeNames).toContain("list_images");
    expect(writeNames).toContain("set_cover");
    expect(writeNames).toContain("remove_cover");
  });

  it("imports a cover from a URL, populates artwork + accent colours, reuses imageId, and removes covers", async () => {
    suite.requireProject();
    const collectionId = await suite.mkCollection("MCP Cover Album");
    const trackId = await suite.mkTrack("MCP Cover Track");
    const token = await mintMcpToken(editor, ["read", "write"]);
    const jpeg = await vividJpeg();

    const realFetch = globalThis.fetch;
    stubGlobal("fetch", (async (
      input: string | URL | Request,
      init?: RequestInit
    ) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "https://1.1.1.1/images?image=cover-test.jpg") {
        return new Response(jpeg, {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        });
      }
      return realFetch(input, init);
    }) as typeof fetch);

    try {
      const setRes = await callTool(token, "set_cover", {
        kind: "collection",
        id: collectionId,
        url: "https://1.1.1.1/images?image=cover-test.jpg",
      });
      const imported = contentOf(setRes) as {
        id: number;
        name: string;
        assetPath: string;
        accentHue: number | null;
        accentChroma: number | null;
        variantsJobId: number | null;
      };
      expect(imported.name).toBe("cover-test.jpg");
      expect(typeof imported.assetPath).toBe("string");
      expect(imported.accentHue).not.toBeNull();
      expect(imported.accentChroma).not.toBeNull();
      expect(imported.variantsJobId).not.toBeNull();

      const collectionRes = await suite.request(
        "editor",
        `/collections/${collectionId}`
      );
      expect(collectionRes.status).toBe(200);
      const collection = (await collectionRes.json()) as {
        image: string | null;
        artwork: {
          assetPath: string;
          accentHue: number | null;
          accentChroma: number | null;
        } | null;
      };
      expect(collection.image).toBe(imported.assetPath);
      expect(collection.artwork).not.toBeNull();
      expect(collection.artwork?.assetPath).toBe(imported.assetPath);
      expect(collection.artwork?.accentHue).not.toBeNull();

      // List images and reuse the same imageId on a track without re-fetching.
      const listed = contentOf(
        await callTool(token, "list_images", { projectId: suite.projectId })
      ) as { rows: { id: number }[] };
      expect(listed.rows.some((row) => row.id === imported.id)).toBe(true);

      const reuseRes = await callTool(token, "set_cover", {
        kind: "track",
        id: trackId,
        imageId: imported.id,
      });
      const reused = contentOf(reuseRes);
      expect(reused.id).toBe(imported.id);
      expect(reused.variantsJobId).toBeNull();

      // Remove the cover from the collection.
      const removed = contentOf(
        await callTool(token, "remove_cover", {
          kind: "collection",
          id: collectionId,
        })
      );
      expect(removed).toEqual({ removed: true });

      const afterRemove = (await (
        await suite.request("editor", `/collections/${collectionId}`)
      ).json()) as { image: string | null };
      expect(afterRemove.image).toBeNull();
    } finally {
      unstubAllGlobals();
    }
  });

  it("refuses invalid set_cover inputs and private URLs, and ignores raw image on update_collection", async () => {
    suite.requireProject();
    const collectionId = await suite.mkCollection("MCP Guarded Album");
    const token = await mintMcpToken(editor, ["read", "write"]);
    const viewerToken = await mintMcpToken(viewer, ["read", "write"]);

    // Raw image passed to update_collection is stripped, not persisted.
    await callTool(token, "update_collection", {
      id: collectionId,
      title: "MCP Guarded Album Renamed",
      image: "https://example.com/should-be-dropped.jpg",
    });
    const reread = (await (
      await suite.request("editor", `/collections/${collectionId}`)
    ).json()) as { title: string; image: string | null };
    expect(reread.title).toBe("MCP Guarded Album Renamed");
    expect(reread.image).toBeNull();

    // Neither url nor imageId -> 400.
    const neither = await callTool(token, "set_cover", {
      kind: "collection",
      id: collectionId,
    });
    expect(resultOf(neither)?.isError).toBe(true);
    expect(resultOf(neither)?.content?.[0]?.text).toContain("400");

    // Private URL -> 400.
    const privateUrl = await callTool(token, "set_cover", {
      kind: "collection",
      id: collectionId,
      url: "http://127.0.0.1/private.jpg",
    });
    expect(resultOf(privateUrl)?.isError).toBe(true);
    expect(resultOf(privateUrl)?.content?.[0]?.text).toContain("400");

    // Viewer cannot set or remove cover -> 403.
    const asViewer = await callTool(viewerToken, "remove_cover", {
      kind: "collection",
      id: collectionId,
    });
    expect(resultOf(asViewer)?.isError).toBe(true);
    expect(resultOf(asViewer)?.content?.[0]?.text).toContain("403");
  });
});
