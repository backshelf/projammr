import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  spyOn,
} from "bun:test";
import { isSignedOut, type SessionState } from "@/lib/session-state";

mock.module("server-only", () => ({}));

/*
 * React's `cache` memoises only inside a server render, so this stands in for
 * one: an entry per argument list (its length included, as React's is) that
 * lasts until `nextRequest()`.
 */
let request = new Map<unknown, Map<string, unknown>>();
const nextRequest = () => {
  request = new Map();
};
const react = await import("react");
mock.module("react", () => ({
  ...react,
  cache:
    <A extends unknown[], R>(fn: (...args: A) => R) =>
    (...args: A): R => {
      const entries = request.get(fn) ?? new Map<string, unknown>();
      request.set(fn, entries);
      const key = JSON.stringify(args);
      if (!entries.has(key)) entries.set(key, fn(...args));
      return entries.get(key) as R;
    },
}));

type Result = { data?: unknown; error?: unknown; response: Response };
const GET = mock<(path: string, init: unknown) => Promise<Result>>();
mock.module("@/lib/server-api", () => ({ serverApi: { GET } }));

const cachedInstance = mock<() => Promise<unknown>>();
mock.module("@/lib/server-data", () => ({ cachedInstance }));

const getCachedSession = mock<() => Promise<SessionState>>();
mock.module("@/lib/session", () => ({ getCachedSession, isSignedOut }));

const { cachedEffectiveSettings, cachedSettingsHub } = await import("./server");
const { DEFAULT_SETTINGS } = await import("./effective");

const member = {
  kind: "member",
  user: { id: "u1" },
  session: { id: "s1" },
} as unknown as SessionState;

const ok = (data: unknown): Result => ({
  data,
  response: new Response(null, { status: 200 }),
});

const effective = ok({
  values: {
    "editor.rhymePrefix": "!",
    "editor.synonymPrefix": "=",
    "instance-access.registration": "closed",
  },
  version: "abc123",
});

let warn: ReturnType<typeof spyOn<Console, "warn">>;

beforeEach(() => {
  nextRequest();
  GET.mockReset();
  cachedInstance.mockReset();
  getCachedSession.mockReset();
  getCachedSession.mockResolvedValue(member);
  warn = spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

describe("cachedEffectiveSettings", () => {
  it("reads once per request however often it is asked", async () => {
    GET.mockResolvedValue(effective);

    const reads = await Promise.all([
      cachedEffectiveSettings(),
      cachedEffectiveSettings(),
      cachedEffectiveSettings(undefined),
    ]);

    expect(GET).toHaveBeenCalledTimes(1);
    expect(GET).toHaveBeenCalledWith("/api/settings/effective", {
      params: { query: {} },
    });
    expect(reads[0]).toEqual({
      values: {
        ...DEFAULT_SETTINGS,
        "editor.rhymePrefix": "!",
        "editor.synonymPrefix": "=",
        "instance-access.registration": "closed",
      },
      version: "abc123",
    });
    expect(reads[1]).toBe(reads[0]);
    expect(reads[2]).toBe(reads[0]);

    nextRequest();
    await cachedEffectiveSettings();
    expect(GET).toHaveBeenCalledTimes(2);
  });

  it("reads a project's layer once per project", async () => {
    GET.mockResolvedValue(effective);

    await cachedEffectiveSettings(5);
    await cachedEffectiveSettings(5);
    await cachedEffectiveSettings();

    expect(GET.mock.calls.map(([, init]) => init)).toEqual([
      { params: { query: { project: "5" } } },
      { params: { query: {} } },
    ]);
  });

  it("reads a key the server did not send as its registry default", async () => {
    GET.mockResolvedValue(
      ok({ values: { "editor.rhymePrefix": "!" }, version: "v" })
    );

    const { values } = await cachedEffectiveSettings();

    expect(values["editor.rhymePrefix"]).toBe("!");
    expect(values["instance-access.registration"]).toBe("open");
  });

  it("renders from the registry defaults, with a warning, when the API answers with a failure", async () => {
    GET.mockResolvedValue({
      error: { error: "Internal" },
      response: new Response(null, { status: 500 }),
    });

    const { values } = await cachedEffectiveSettings();

    expect(values).toEqual(DEFAULT_SETTINGS);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("renders from the registry defaults, with a warning, when the API is unreachable", async () => {
    GET.mockRejectedValue(new TypeError("fetch failed"));

    const { values } = await cachedEffectiveSettings();

    expect(values).toEqual(DEFAULT_SETTINGS);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("holds the instance's public settings over the defaults when signed out, with no authenticated read", async () => {
    getCachedSession.mockResolvedValue({ kind: "signed-out" });
    cachedInstance.mockResolvedValue({
      registration: "closed",
      hasUsers: true,
      emailEnabled: false,
      version: "1.0.0",
      updateCheck: false,
      settings: { "instance-access.registration": "closed" },
    });

    const read = await cachedEffectiveSettings();

    expect(GET).not.toHaveBeenCalled();
    expect(read).toEqual({
      values: {
        ...DEFAULT_SETTINGS,
        "instance-access.registration": "closed",
      },
      version: 'public:{"instance-access.registration":"closed"}',
    });
  });

  it("reads a guest's settings as a signed-out visitor's", async () => {
    getCachedSession.mockResolvedValue({
      ...member,
      kind: "guest",
    } as SessionState);
    cachedInstance.mockResolvedValue({ settings: {} });

    await cachedEffectiveSettings();

    expect(GET).not.toHaveBeenCalled();
    expect(cachedInstance).toHaveBeenCalledTimes(1);
  });

  it("renders from the registry defaults when signed out and the instance cannot be read", async () => {
    getCachedSession.mockResolvedValue({ kind: "signed-out" });
    cachedInstance.mockRejectedValue(new TypeError("fetch failed"));

    const { values } = await cachedEffectiveSettings();

    expect(values).toEqual(DEFAULT_SETTINGS);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("cachedSettingsHub", () => {
  const hubRow = {
    effective: "!",
    source: "user",
    writable: { user: true, instance: false },
    values: { user: "!" },
  };

  it("reads the hub once per request and project, naming the project it layers", async () => {
    GET.mockResolvedValue(ok({ "editor.rhymePrefix": hubRow }));

    const [plain, again, inProject] = await Promise.all([
      cachedSettingsHub(),
      cachedSettingsHub(),
      cachedSettingsHub(7),
    ]);

    expect<unknown>(plain).toEqual({ "editor.rhymePrefix": hubRow });
    expect(again).toBe(plain);
    expect(inProject).toEqual(plain);
    expect(GET.mock.calls).toEqual([
      ["/api/settings", { params: { query: {} } }],
      ["/api/settings", { params: { query: { project: "7" } } }],
    ]);
  });

  it("hands a refusal back rather than falling back", async () => {
    GET.mockResolvedValue({
      error: { error: "Not found" },
      response: new Response(null, { status: 404 }),
    });

    expect(await cachedSettingsHub(7)).toMatchObject({ status: 404 });
  });

  it("reports an unreachable API as an error", async () => {
    GET.mockRejectedValue(new TypeError("fetch failed"));

    expect(await cachedSettingsHub()).toEqual({ error: "fetch failed" });
  });
});
