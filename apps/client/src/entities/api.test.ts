import { describe, expect, it, mock } from "bun:test";
import { ENTITIES } from "@/entities";
import { ENTITY_API } from "@/entities/api";
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

const ROW_ROUTES = {
  project: "/api/projects/{id}",
  collection: "/api/collections/{id}",
  track: "/api/tracks/{id}",
  session: "/api/sessions/{id}",
} as const;

type RowKind = keyof typeof ROW_ROUTES;

describe("patch", () => {
  for (const kind of Object.keys(ROW_ROUTES) as RowKind[]) {
    it(`hits ${kind}'s own route with the id as a string`, async () => {
      const { api, calls } = fakeApi(ok({ id: 5 }));

      await ENTITY_API[kind].patch(api, 5, { title: "New" });

      expect(calls).toHaveLength(1);
      expect(calls[0]?.path).toBe(ROW_ROUTES[kind]);
      expect(
        (calls[0]?.init as { params: { path: { id: string } } }).params.path.id
      ).toBe("5");
    });
  }
});

describe("remove", () => {
  // The delete routes answer 204, so `data` is undefined even though nothing
  // went wrong. `toActionOutcome` reports its own success value instead.
  for (const kind of Object.keys(ROW_ROUTES) as RowKind[]) {
    it(`treats ${kind}'s empty 204 body as success`, async () => {
      const { api } = fakeApi({
        response: new Response(null, { status: 204 }),
      });

      expect(await ENTITY_API[kind].remove(api, 5)).toEqual({ ok: true });
    });
  }
});

describe("table kinds", () => {
  it("expose create, bulk patch, bulk remove, bulk labels, bulk move, move and labels; project does not", () => {
    for (const kind of ["collection", "track", "session"] as const) {
      const api = ENTITY_API[kind];
      expect(typeof api.create).toBe("function");
      expect(typeof api.bulkPatch).toBe("function");
      expect(typeof api.bulkRemove).toBe("function");
      expect(typeof api.bulkSetLabels).toBe("function");
      expect(typeof api.bulkMove).toBe("function");
      expect(typeof api.move).toBe("function");
      expect(typeof api.setLabels).toBe("function");
    }

    expect("create" in ENTITY_API.project).toBe(false);
    expect("bulkPatch" in ENTITY_API.project).toBe(false);
    expect("bulkRemove" in ENTITY_API.project).toBe(false);
    expect("bulkSetLabels" in ENTITY_API.project).toBe(false);
    expect("bulkMove" in ENTITY_API.project).toBe(false);
    expect("move" in ENTITY_API.project).toBe(false);
    expect("setLabels" in ENTITY_API.project).toBe(false);
  });
});

describe("move", () => {
  const fellBack = [{ from: "High", to: "None", count: 3 }];

  for (const kind of ["collection", "track", "session"] as const) {
    it(`reports the priority levels a ${kind} move fell back on, as the server answered them`, async () => {
      const { api, calls } = fakeApi(
        ok({ id: 1, title: "Moved", priorityFallbacks: fellBack })
      );

      const result = await ENTITY_API[kind].move(api, 1, 2);

      expect(calls[0]?.path).toBe(`${ROW_ROUTES[kind]}/move`);
      expect(isActionError(result)).toBe(false);
      if (!isActionError(result)) {
        expect(result.priorityFallbacks).toEqual(fellBack);
      }
    });
  }

  it("reports a bulk move's count and its fallbacks together", async () => {
    const { api } = fakeApi(
      ok({ moved: 4, droppedFields: [], priorityFallbacks: fellBack })
    );

    const result = await ENTITY_API.track.bulkMove(api, 1, { ids: [1] }, 2);

    expect(result).toEqual({
      moved: 4,
      droppedFields: [],
      priorityFallbacks: fellBack,
    });
  });
});

describe("failures", () => {
  it("resolves a failed call to an ActionError carrying the status", async () => {
    const { api } = fakeApi(failure(400, "Bad request"));

    const result = await ENTITY_API.track.patch(api, 1, {});

    expect(isActionError(result)).toBe(true);
    if (isActionError(result)) {
      expect(result.status).toBe(400);
    }
  });

  it("maps a 403 on move to the both-projects message", async () => {
    const { api } = fakeApi(failure(403, "Forbidden"));

    const result = await ENTITY_API.track.move(api, 1, 2);

    expect(isActionError(result)).toBe(true);
    if (isActionError(result)) {
      expect(result.error).toBe(
        "You need edit access in both projects to move this"
      );
    }
  });
});

describe("ENTITY_API", () => {
  it("has API calls for every kind in the entity registry", () => {
    expect(Object.keys(ENTITY_API).sort()).toEqual(
      Object.keys(ENTITIES).sort()
    );
  });
});
