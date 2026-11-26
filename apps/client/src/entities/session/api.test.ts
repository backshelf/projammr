import { describe, expect, it } from "bun:test";
import { pageQueryOf, sessionApi } from "@/entities/session/api";
import { parseTableQuery, type TableSearchParams } from "@/lib/table-params";
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
  priority: "14",
  daw: "ableton",
  track: 2,
};

describe("pageQueryOf", () => {
  it("maps every TableSearchParams member the action forwards", () => {
    const query = pageQueryOf(FULL_VIEW);

    expect(query).toEqual({
      q: "loud",
      sort: "title.asc",
      groupBy: "status",
      priority: "14",
      daw: "ableton",
      track: 2,
    });
  });

  it("forwards the In dit filter as the URL spells it", () => {
    expect(pageQueryOf({ inDit: "false" }).inDit).toBe("false");
  });

  it("drops an In dit value the server would refuse", () => {
    expect(
      pageQueryOf(parseTableQuery({ inDit: "maybe" })).inDit
    ).toBeUndefined();
  });

  it("leaves every field undefined for a view with no filters", () => {
    const query = pageQueryOf({});

    expect(query.q).toBeUndefined();
    expect(query.sort).toBeUndefined();
    expect(query.groupBy).toBeUndefined();
    expect(query.priority).toBeUndefined();
    expect(query.daw).toBeUndefined();
    expect(query.track).toBeUndefined();
  });

  it("scopes to the given track over the view's own filter", () => {
    const query = pageQueryOf(FULL_VIEW, {
      trackId: 9,
      tracks: [],
      daws: [],
      machines: [],
    });

    expect(query.track).toBe(9);
  });

  it("includes an archived track's sessions when scoped to a track", () => {
    const query = pageQueryOf(
      {},
      { trackId: 9, tracks: [], daws: [], machines: [] }
    );

    expect(query.archived).toBe("include");
  });

  it("leaves archived sessions hidden when not scoped to a track", () => {
    expect(pageQueryOf(FULL_VIEW).archived).toBeUndefined();
    expect(
      pageQueryOf(FULL_VIEW, {
        collectionId: 4,
        tracks: [],
        daws: [],
        machines: [],
      }).archived
    ).toBeUndefined();
  });

  it("falls back to the view's track filter with no scope", () => {
    const query = pageQueryOf(FULL_VIEW);

    expect(query.track).toBe(2);
  });

  it("drops a DAW filter that is not a well-formed id, as page 1's action does", () => {
    const query = pageQueryOf({ ...FULL_VIEW, daw: "Ableton Live" });

    expect(query.daw).toBeUndefined();
  });
});

describe("sessionApi.page", () => {
  it("sends the query to the paginated route and returns the envelope", async () => {
    const envelope = {
      rows: [{ id: 1, title: "Session" }],
      rowCount: 1,
      page: 1,
      pageSize: 50,
      facets: {},
      groups: [],
    };
    const { api, calls } = fakeApi(ok(envelope));

    const result = await sessionApi.page(api, 7, {
      ...pageQueryOf(FULL_VIEW),
      page: 1,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe("/api/projects/{id}/sessions/paginated");
    const init = calls[0]?.init as {
      params: { path: { id: string }; query: Record<string, unknown> };
    };
    expect(init.params.path.id).toBe("7");
    expect(init.params.query).toEqual({
      q: "loud",
      sort: "title.asc",
      groupBy: "status",
      priority: "14",
      daw: "ableton",
      track: 2,
      page: 1,
    });
    expect(result).toEqual(envelope as never);
  });
});
