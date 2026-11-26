import { beforeEach, describe, expect, it, mock } from "bun:test";

type Result = { data?: unknown; error?: unknown; response: Response };
const GET = mock<(path: string, init: unknown) => Promise<Result>>();
mock.module("@/lib/browser-api", () => ({ browserApi: { GET } }));

const { readSettingsHub } = await import("./api");

beforeEach(() => GET.mockReset());

describe("readSettingsHub", () => {
  it("names the project when there is one, and nothing otherwise", async () => {
    GET.mockResolvedValue({
      data: {},
      response: new Response(null, { status: 200 }),
    });

    await readSettingsHub(null);
    await readSettingsHub(7);

    expect(GET.mock.calls).toEqual([
      ["/api/settings", { params: { query: {} } }],
      ["/api/settings", { params: { query: { project: "7" } } }],
    ]);
  });
});
