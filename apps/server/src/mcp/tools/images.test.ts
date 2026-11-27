import { stubGlobal, unstubAllGlobals } from "@workspace/test/globals";
import { beforeAll, describe, expect, it, spyOn } from "bun:test";
import sharp from "sharp";
import * as instancePolicyModule from "../../lib/instance-policy.js";
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

async function vividPng(): Promise<Uint8Array<ArrayBuffer>> {
  const buf = await sharp({
    create: {
      width: 64,
      height: 64,
      channels: 3,
      background: { r: 40, g: 120, b: 230 },
    },
  })
    .png()
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

  it("uploads a cover from raw base64 and data-URL base64", async () => {
    suite.requireProject();
    const collectionId = await suite.mkCollection("MCP Base64 Album");
    const trackId = await suite.mkTrack("MCP Base64 Track");
    const token = await mintMcpToken(editor, ["read", "write"]);
    const jpeg = await vividJpeg();
    const png = await vividPng();

    const rawRes = await callTool(token, "set_cover", {
      kind: "collection",
      id: collectionId,
      data: Buffer.from(jpeg).toString("base64"),
      filename: "vinyl-sleeve.jpg",
    });
    const uploaded = contentOf(rawRes) as {
      id: number;
      name: string;
      type: string;
      assetPath: string;
      accentHue: number | null;
      variantsJobId: number | null;
    };
    expect(uploaded.name).toBe("vinyl-sleeve.jpg");
    expect(uploaded.type).toBe("image/jpeg");
    expect(uploaded.accentHue).not.toBeNull();
    expect(uploaded.variantsJobId).not.toBeNull();

    const collection = (await (
      await suite.request("editor", `/collections/${collectionId}`)
    ).json()) as { image: string | null };
    expect(collection.image).toBe(uploaded.assetPath);

    const dataUrlRes = await callTool(token, "set_cover", {
      kind: "track",
      id: trackId,
      data: `data:image/png;base64,${Buffer.from(png).toString("base64")}`,
    });
    const fromDataUrl = contentOf(dataUrlRes) as {
      name: string;
      type: string;
      assetPath: string;
      variantsJobId: number | null;
    };
    expect(fromDataUrl.name).toBe("cover.png");
    expect(fromDataUrl.type).toBe("image/png");
    expect(fromDataUrl.variantsJobId).not.toBeNull();

    const track = (await (
      await suite.request("editor", `/tracks/${trackId}`)
    ).json()) as { image: string | null };
    expect(track.image).toBe(fromDataUrl.assetPath);
  });

  it("refuses invalid set_cover inputs, base64 errors, size limits, and private URLs, and ignores raw image on update_collection", async () => {
    suite.requireProject();
    const collectionId = await suite.mkCollection("MCP Guarded Album");
    const token = await mintMcpToken(editor, ["read", "write"]);
    const viewerToken = await mintMcpToken(viewer, ["read", "write"]);
    const jpeg = await vividJpeg();
    const jpegBase64 = Buffer.from(jpeg).toString("base64");

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

    // Zero or multiple cover sources -> 400.
    for (const args of [
      { kind: "collection", id: collectionId },
      {
        kind: "collection",
        id: collectionId,
        url: "https://1.1.1.1/a.jpg",
        imageId: 1,
      },
      {
        kind: "collection",
        id: collectionId,
        url: "https://1.1.1.1/a.jpg",
        data: jpegBase64,
      },
      {
        kind: "collection",
        id: collectionId,
        imageId: 1,
        data: jpegBase64,
      },
      {
        kind: "collection",
        id: collectionId,
        url: "https://1.1.1.1/a.jpg",
        imageId: 1,
        data: jpegBase64,
      },
    ]) {
      const bad = await callTool(token, "set_cover", args);
      expect(resultOf(bad)?.isError).toBe(true);
      expect(resultOf(bad)?.content?.[0]?.text).toContain("400");
    }

    // Invalid base64 -> 400.
    const invalidBase64 = await callTool(token, "set_cover", {
      kind: "collection",
      id: collectionId,
      data: "not!valid@base64",
    });
    expect(resultOf(invalidBase64)?.isError).toBe(true);
    expect(resultOf(invalidBase64)?.content?.[0]?.text).toContain("400");

    // Valid base64 of non-image bytes -> 400.
    const nonImage = await callTool(token, "set_cover", {
      kind: "collection",
      id: collectionId,
      data: Buffer.from("<html>not an image</html>").toString("base64"),
    });
    expect(resultOf(nonImage)?.isError).toBe(true);
    expect(resultOf(nonImage)?.content?.[0]?.text).toContain("400");

    // Base64 exceeding instance upload limit -> 400.
    const limitSpy = spyOn(
      instancePolicyModule,
      "uploadLimitBytes"
    ).mockReturnValueOnce(jpeg.byteLength - 1);
    try {
      const oversized = await callTool(token, "set_cover", {
        kind: "collection",
        id: collectionId,
        data: jpegBase64,
      });
      expect(resultOf(oversized)?.isError).toBe(true);
      expect(resultOf(oversized)?.content?.[0]?.text).toContain("400");
      expect(resultOf(oversized)?.content?.[0]?.text).toContain("upload limit");
    } finally {
      limitSpy.mockRestore();
    }

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
