import { describe, expect, it } from "bun:test";
import { collectionApi, pageQueryOf } from "@/entities/collection/api";
import type { TableSearchParams } from "@/lib/table-params";
import type { ApiClient } from "@workspace/api/lib/authed-client";

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

/** A fake `ApiClient` whose `GET` records every `(path, init)` call and resolves to `result`. */
function fakeApi(result: CannedResult): { api: ApiClient; calls: Call[] } {
  const calls: Call[] = [];
  const api = {
    GET: (path: string, init: unknown) => {
      calls.push({ path, init });
      return Promise.resolve(result);
    },
  } as unknown as ApiClient;

  return { api, calls };
}

const FULL_VIEW: TableSearchParams = {
  q: "loud",
  sort: "title.asc",
  group: "status",
  status: 1,
  priority: "14",
  cf_7: "true",
};

describe("pageQueryOf", () => {
  it("maps every TableSearchParams member the action forwards", () => {
    const query = pageQueryOf(FULL_VIEW);

    expect(query).toEqual({
      q: "loud",
      sort: "title.asc",
      groupBy: "status",
      status: 1,
      priority: "14",
      cf_7: "true",
    } as typeof query);
  });

  it("leaves every field undefined for a view with no filters", () => {
    const query = pageQueryOf({});

    expect(query.q).toBeUndefined();
    expect(query.sort).toBeUndefined();
    expect(query.groupBy).toBeUndefined();
    expect(query.status).toBeUndefined();
    expect(query.priority).toBeUndefined();
  });
});

describe("collectionApi.page", () => {
  it("sends the query to the paginated route and returns the envelope", async () => {
    const envelope = {
      rows: [{ id: 1, title: "Collection" }],
      rowCount: 1,
      page: 1,
      pageSize: 50,
      facets: {},
      groups: [],
    };
    const { api, calls } = fakeApi(ok(envelope));

    const result = await collectionApi.page(api, 7, {
      ...pageQueryOf(FULL_VIEW),
      page: 1,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe("/api/projects/{id}/collections/paginated");
    const init = calls[0]?.init as {
      params: { path: { id: string }; query: Record<string, unknown> };
    };
    expect(init.params.path.id).toBe("7");
    expect(init.params.query).toEqual({
      q: "loud",
      sort: "title.asc",
      groupBy: "status",
      status: 1,
      priority: "14",
      cf_7: "true",
      page: 1,
    });
    expect(result).toEqual(envelope as never);
  });
});
