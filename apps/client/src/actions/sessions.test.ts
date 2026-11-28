import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";

mock.module("server-only", () => ({}));

const { serverApi } = await import("@/lib/server-api");
const { getSessionsPageForProject } = await import("@/actions/sessions");

let restore: (() => void) | null = null;

afterEach(() => {
  restore?.();
  restore = null;
});

describe("getSessionsPageForProject", () => {
  it("forwards unassigned query param to /api/projects/{id}/sessions/paginated", async () => {
    const spy = spyOn(serverApi, "GET").mockResolvedValue({
      data: { rows: [], rowCount: 0, facets: {} },
      response: new Response(null, { status: 200 }),
    } as never);
    restore = () => spy.mockRestore();

    await getSessionsPageForProject(7, { unassigned: "true" });

    expect(spy).toHaveBeenCalledWith("/api/projects/{id}/sessions/paginated", {
      params: {
        path: { id: "7" },
        query: expect.objectContaining({ unassigned: "true" }),
      },
    });
  });
});
