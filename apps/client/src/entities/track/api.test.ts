import { describe, expect, it } from "bun:test";
import { pageQueryOf, trackApi } from "@/entities/track/api";
import type { TableSearchParams } from "@/lib/table-params";
import type { ApiClient } from "@workspace/api/lib/authed-client";
import { TRACK_FILTER_PARAMS } from "@workspace/api/lib/enums";

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
  collection: 2,
  relation: "remix",
  label: 3,
  artist: "Someone",
  explicit: "true",
  cf_12: "3..9",
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
      collection: 2,
      relation: "remix",
      label: 3,
      artist: "Someone",
      explicit: "true",
      cf_12: "3..9",
    } as typeof query);
  });

  it("forwards every filter the tracks route declares", () => {
    const view = Object.fromEntries(
      TRACK_FILTER_PARAMS.map((param) => [param, FULL_VIEW[param]])
    ) as TableSearchParams;
    const query = pageQueryOf(view) as Record<string, unknown>;

    for (const param of TRACK_FILTER_PARAMS) {
      expect(query[param]).toBe(FULL_VIEW[param]);
    }
  });

  it("leaves every field undefined for a view with no filters", () => {
    const query = pageQueryOf({});

    expect(query.q).toBeUndefined();
    expect(query.sort).toBeUndefined();
    expect(query.groupBy).toBeUndefined();
    expect(query.status).toBeUndefined();
    expect(query.priority).toBeUndefined();
    expect(query.collection).toBeUndefined();
    expect(query.relation).toBeUndefined();
    expect(query.label).toBeUndefined();
    expect(query.artist).toBeUndefined();
  });

  it("scopes to the given collection over the view's own filter", () => {
    const query = pageQueryOf(FULL_VIEW, { collectionId: 9, collections: [] });

    expect(query.collection).toBe(9);
  });

  it("falls back to the view's collection filter with no scope", () => {
    const query = pageQueryOf(FULL_VIEW);

    expect(query.collection).toBe(2);
  });
});

describe("trackApi.page", () => {
  it("sends the query to the paginated route and returns the envelope", async () => {
    const envelope = {
      rows: [{ id: 1, title: "Track" }],
      rowCount: 1,
      page: 1,
      pageSize: 50,
      facets: {},
      groups: [],
    };
    const { api, calls } = fakeApi(ok(envelope));

    const result = await trackApi.page(api, 7, {
      ...pageQueryOf(FULL_VIEW),
      page: 1,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe("/api/projects/{id}/tracks/paginated");
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
      collection: 2,
      relation: "remix",
      label: 3,
      artist: "Someone",
      explicit: "true",
      cf_12: "3..9",
      page: 1,
    });
    expect(result).toEqual(envelope as never);
  });
});
