import { describe, expect, it, mock } from "bun:test";
import { myHeatmap, myProjects, projectHeatmap } from "@/lib/shared-reads";
import { isActionError } from "@workspace/api/lib/action-result";
import type { ApiClient } from "@workspace/api/lib/authed-client";

type Call = { path: string; init: unknown };

/** A canned openapi-fetch result, `data`/`error` matching the response's status. */
type CannedResult = { data?: unknown; error?: unknown; response: Response };

const ok = (data: unknown = { ok: true }): CannedResult => ({
  data,
  response: new Response(JSON.stringify(data), {
    status: 200,
    headers: { "content-type": "application/json" },
  }),
});

const failure = (status: number, error: string): CannedResult => ({
  error: { error },
  response: new Response(JSON.stringify({ error }), {
    status,
    headers: { "content-type": "application/json" },
  }),
});

/** A fake `ApiClient` whose methods record every `(path, init)` call and resolve to `result`. */
function fakeApi(result: CannedResult): { api: ApiClient; calls: Call[] } {
  const calls: Call[] = [];
  const method = (path: string, init: unknown) => {
    calls.push({ path, init });
    return Promise.resolve(result);
  };

  const api = {
    GET: mock(method),
    POST: mock(method),
    PATCH: mock(method),
    PUT: mock(method),
    DELETE: mock(method),
  } as unknown as ApiClient;

  return { api, calls };
}

describe("myProjects", () => {
  it("reports a failed read instead of an empty list", async () => {
    const { api } = fakeApi(failure(500, "Internal error"));

    const result = await myProjects(api);

    expect(isActionError(result)).toBe(true);
    if (isActionError(result)) {
      expect(result.error).toBe("Internal error");
    }
  });
});

describe("myHeatmap", () => {
  it("passes its query through", async () => {
    const { api, calls } = fakeApi(ok([]));
    const range = { from: 1, to: 2, tz: "UTC" };

    await myHeatmap(api, range);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe("/api/me/heatmap");
    expect(
      (calls[0]?.init as { params: { query: unknown } }).params.query
    ).toEqual(range);
  });
});

describe("projectHeatmap", () => {
  it("sends its filters as query params and omits absent ones", async () => {
    const { api, calls } = fakeApi(ok([]));
    const range = { from: 1, to: 2, tz: "UTC" };

    await projectHeatmap(api, 5, range, { trackId: 9 });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe("/api/projects/{id}/heatmap");
    const init = calls[0]?.init as {
      params: { path: { id: string }; query: Record<string, unknown> };
    };
    expect(init.params.path.id).toBe("5");
    expect(init.params.query).toEqual({ ...range, trackId: 9 });
    expect(init.params.query).not.toHaveProperty("collectionId");
    expect(init.params.query).not.toHaveProperty("labelId");
    expect(init.params.query).not.toHaveProperty("daw");
  });

  it("omits filters entirely when none are given", async () => {
    const { api, calls } = fakeApi(ok([]));
    const range = { from: 1, to: 2, tz: "UTC" };

    await projectHeatmap(api, 5, range);

    const init = calls[0]?.init as {
      params: { query: Record<string, unknown> };
    };
    expect(init.params.query).toEqual(range);
  });
});
