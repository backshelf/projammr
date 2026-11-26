import { describe, expect, it, mock } from "bun:test";

import { applyMutation } from "@/lib/mutation";

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
let nextResult: CannedResult = ok({ deleted: 0 });

mock.module("@/lib/browser-api", () => ({
  browserApi: {
    DELETE: mock((path: string, init: unknown) => {
      calls.push({ path, init });
      return Promise.resolve(nextResult);
    }),
  },
}));

const { bulkDeleteAssets } = await import("./asset-mutations");

describe("bulkDeleteAssets", () => {
  it("deletes a selection in one request", async () => {
    calls.length = 0;
    nextResult = ok({ deleted: 3 });

    const result = await bulkDeleteAssets(1, [10, 20, 30]).run();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe("/api/assets/bulk");
    expect(calls[0]?.init).toMatchObject({
      body: { projectId: 1, ids: [10, 20, 30] },
    });
    expect(result).toEqual({ deleted: 3 });
  });

  it("invalidates the route on success and nothing on failure", async () => {
    let refreshed = 0;
    const router = { refresh: () => refreshed++ };

    nextResult = ok({ deleted: 2 });
    await applyMutation(bulkDeleteAssets(1, [1, 2]), router);
    expect(refreshed).toBe(1);

    nextResult = failed();
    await applyMutation(bulkDeleteAssets(1, [1, 2]), router);
    expect(refreshed).toBe(1);
  });
});
