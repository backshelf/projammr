import { describe, expect, it, mock } from "bun:test";
import type { AssetsPage } from "@workspace/api/api";

type Call = { path: string; init: unknown };

/** A canned openapi-fetch result, `data`/`error` matching the response's status. */
type CannedResult = { data?: unknown; error?: unknown; response: Response };

const ok = (data: unknown): CannedResult => ({
  data,
  response: new Response(JSON.stringify(data), {
    status: 200,
    headers: { "content-type": "application/json" },
  }),
});

const failed = (): CannedResult => ({
  error: { error: "nope" },
  response: new Response(JSON.stringify({ error: "nope" }), {
    status: 500,
    headers: { "content-type": "application/json" },
  }),
});

const calls: Call[] = [];
let nextResult: CannedResult = ok({ rows: [], rowCount: 0, pageSize: 50 });

mock.module("@/lib/browser-api", () => ({
  browserApi: {
    GET: mock((path: string, init: unknown) => {
      calls.push({ path, init });
      return Promise.resolve(nextResult);
    }),
  },
}));

const { getAssetsPage } = await import("./asset-queries");

describe("getAssetsPage", () => {
  it("reads a page of a project's files with the view's search and sort", async () => {
    calls.length = 0;
    const page = {
      rows: [{ id: 1 }],
      rowCount: 60,
      pageSize: 50,
    } as unknown as AssetsPage;
    nextResult = ok(page);

    const result = await getAssetsPage(1, { page: 2, q: "kick", sort: "name" });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe("/api/assets/project/{projectId}");
    expect(calls[0]?.init).toMatchObject({
      params: {
        path: { projectId: "1" },
        query: { page: 2, q: "kick", sort: "name" },
      },
    });
    expect(result).toEqual(page);
  });

  it("carries the server's error through on failure", async () => {
    nextResult = failed();

    const result = await getAssetsPage(1, { page: 1 });

    expect(result).toEqual({ error: "nope", status: 500 });
  });
});
