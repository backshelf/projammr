import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
  mock,
} from "bun:test";
import { advanceTimersByTimeAsync } from "@workspace/test/timers";
import type { ReactNode } from "react";
import { z } from "zod";

/*
 * The appearance and editor keys mirror onto `<html>`, but none takes its
 * highest value at project scope, so the registry gains two fixtures here:
 * `fixture.density` (personal, painted as `data-density`) and `fixture.layout`
 * (a project key).
 */
const registry = await import("@workspace/settings");
const FIXTURE = {
  group: "fixture",
  label: "Fixture",
  description: "A setting declared by a test.",
  keywords: [],
  control: { kind: "text" },
  audience: "all",
} as const;
const density = registry.defineSetting({
  ...FIXTURE,
  key: "fixture.density",
  scopes: ["user", "instance"],
  schema: z.enum(["comfortable", "compact"]),
  default: "comfortable",
  document: { attribute: "data-density", value: (v) => v },
});
const layout = registry.defineSetting({
  ...FIXTURE,
  key: "fixture.layout",
  scopes: ["project", "instance"],
  schema: z.string(),
  default: "grid",
});
const SETTINGS = {
  ...registry.SETTINGS,
  [density.key]: density,
  [layout.key]: layout,
};
mock.module("@workspace/settings", () => ({
  ...registry,
  SETTINGS,
  isSettingKey: (key: string) => Object.hasOwn(SETTINGS, key),
}));

type Result = { data?: unknown; error?: unknown; response: Response };
const PATCH = mock<(path: string, init: unknown) => Promise<Result>>();
const GET = mock<(path: string, init: unknown) => Promise<Result>>();
mock.module("@/lib/browser-api", () => ({ browserApi: { PATCH, GET } }));

// Nothing here may refresh the route; these stand in for every way to.
const routerRefresh = mock();
const cacheRefresh = mock();
mock.module("next/navigation", () => ({
  useRouter: () => ({ refresh: routerRefresh }),
}));
mock.module("next/cache", () => ({ refresh: cacheRefresh }));

const {
  SettingsProvider,
  useSetting,
  useSettings,
  useSettingsRefresh,
  useSettingsWrite,
  useUserSettingsWrite,
} = await import("./provider");
type UserSettingsWriteFn = import("./provider").UserSettingsWriteFn;
const { effectiveSettings } = await import("./effective");
const { SettingsWriteError } = await import("./write-queue");
type SettingsWrite = ReturnType<typeof useSettingsWrite>;
type SettingKey = import("@workspace/settings").SettingKey;

const DENSITY = density.key as SettingKey;
const LAYOUT = layout.key as SettingKey;
const RHYME = "editor.rhymePrefix";
const SYNONYM = "editor.synonymPrefix";

const read = (values: Record<string, unknown> = {}, version = "v1") =>
  effectiveSettings(values, version);

const ok = (data: unknown): Result => ({
  data,
  response: new Response(null, { status: 200 }),
});

/** The hub row the server answers a write with, reduced to what the provider reads. */
const row = (effective: unknown) => ({
  effective,
  source: "user",
  writable: {},
  values: {},
});

const refused = (status: number, code: string): Result => ({
  error: { error: "Refused", code, details: { scope: "user", by: "instance" } },
  response: new Response(null, { status }),
});

/** The body of the `index`th PATCH. */
const sent = (index = 0) =>
  PATCH.mock.calls[index]?.[1] as {
    params: { path: { scope: string; id: string } };
    body: Record<string, unknown>;
  };

/** Every `useSettingsWrite()` result `CaptureWrite` rendered with, latest last. */
const captured: SettingsWrite[] = [];
function CaptureWrite() {
  captured.push(useSettingsWrite());
  return null;
}
const writer = {
  get write() {
    return captured.at(-1)!.write;
  },
  get pending() {
    return captured.at(-1)!.pending;
  },
};

function Probe({ id, setting }: { id: string; setting: SettingKey }) {
  return <span data-testid={id}>{String(useSetting(setting))}</span>;
}

const shown = (id: string) => screen.getByTestId(id).textContent;

const html = () => document.documentElement;

/** Starts a write and keeps its outcome, so a refusal is never unhandled. */
function start(write: () => Promise<unknown>) {
  let outcome!: Promise<unknown>;
  act(() => {
    outcome = write().then(
      () => "saved",
      (error: unknown) => error
    );
  });
  return outcome;
}

const settle = (ms = 300) =>
  act(async () => {
    await advanceTimersByTimeAsync(ms);
  });

beforeEach(() => {
  jest.useFakeTimers();
  captured.length = 0;
  PATCH.mockReset();
  GET.mockReset();
  routerRefresh.mockReset();
  cacheRefresh.mockReset();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  html().removeAttribute("data-density");
});

describe("useSetting", () => {
  it("returns the initial value, typed by its key", () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <SettingsProvider
        initial={read({
          [RHYME]: "!",
          "instance-access.registration": "closed",
        })}
      >
        {children}
      </SettingsProvider>
    );

    const prefix = renderHook(() => useSetting(RHYME), { wrapper });
    const mode = renderHook(() => useSetting("instance-access.registration"), {
      wrapper,
    });

    const text: string = prefix.result.current;
    const registration: "open" | "closed" = mode.result.current;
    expect(text).toBe("!");
    expect(registration).toBe("closed");
  });

  it("reads the registry default outside a provider", () => {
    const { result } = renderHook(() => useSetting(RHYME));

    expect(result.current).toBe("\\");
  });

  it("reads a nested project provider's values in place of the outer ones", () => {
    render(
      <SettingsProvider initial={read({ [RHYME]: "!", [SYNONYM]: "=" })}>
        <Probe id="outer" setting={SYNONYM} />
        <SettingsProvider initial={read({ [RHYME]: "?" }, "p5")} projectId={5}>
          <Probe id="rhyme" setting={RHYME} />
          <Probe id="synonym" setting={SYNONYM} />
        </SettingsProvider>
      </SettingsProvider>
    );

    expect(shown("rhyme")).toBe("?");
    // Wholesale: the project read resolved every key, so nothing falls
    // through to the outer provider's value.
    expect(shown("synonym")).toBe("~");
    expect(shown("outer")).toBe("=");
  });

  it("takes a newer server read and keeps its own values for the same version", () => {
    const seen: ReturnType<typeof useSettings>[] = [];
    const rhyme = () => seen.at(-1)?.[RHYME];
    function All() {
      seen.push(useSettings());
      return null;
    }
    const tree = (initial: ReturnType<typeof read>) => (
      <SettingsProvider initial={initial}>
        <All />
      </SettingsProvider>
    );
    const view = render(tree(read({ [RHYME]: "!" }, "v1")));

    view.rerender(tree(read({ [RHYME]: "?" }, "v1")));
    expect(rhyme()).toBe("!");

    view.rerender(tree(read({ [RHYME]: "?" }, "v2")));
    expect(rhyme()).toBe("?");
  });
});

describe("useSettingsWrite", () => {
  const mount = (initial = read()) =>
    render(
      <SettingsProvider initial={initial}>
        <Probe id="rhyme" setting={RHYME} />
        <Probe id="synonym" setting={SYNONYM} />
        <Probe id="density" setting={DENSITY} />
        <CaptureWrite />
      </SettingsProvider>
    );

  it("applies a write at once and sends it once writes pause for 300 ms", async () => {
    mount();
    PATCH.mockResolvedValue(ok({ [RHYME]: row("!") }));

    const outcome = start(() => writer.write("user", "u1", { [RHYME]: "!" }));

    expect(shown("rhyme")).toBe("!");
    await settle(299);
    expect(PATCH).not.toHaveBeenCalled();

    await settle(1);
    expect(PATCH).toHaveBeenCalledTimes(1);
    expect(sent().params.path).toEqual({ scope: "user", id: "u1" });
    expect(sent().body).toEqual({ [RHYME]: "!" });
    expect(await outcome).toBe("saved");
  });

  it("sends a scope's writes within the window as one request, the last value per key", async () => {
    mount();
    PATCH.mockResolvedValue(ok({ [RHYME]: row("c"), [SYNONYM]: row("b") }));

    const first = start(() => writer.write("user", "u1", { [RHYME]: "a" }));
    await settle(200);
    const second = start(() => writer.write("user", "u1", { [SYNONYM]: "b" }));
    await settle(200);
    const third = start(() => writer.write("user", "u1", { [RHYME]: "c" }));
    await settle(300);

    expect(PATCH).toHaveBeenCalledTimes(1);
    expect(sent().body).toEqual({ [RHYME]: "c", [SYNONYM]: "b" });
    expect(await Promise.all([first, second, third])).toEqual([
      "saved",
      "saved",
      "saved",
    ]);
    expect(shown("rhyme")).toBe("c");
  });

  it("sends each scope's writes as a request of its own", async () => {
    mount();
    PATCH.mockResolvedValue(ok({}));

    start(() => writer.write("user", "u1", { [RHYME]: "!" }));
    start(() => writer.write("instance", "instance", { [SYNONYM]: "=" }));
    await settle();

    expect(PATCH).toHaveBeenCalledTimes(2);
    expect(
      [sent(0), sent(1)].map(({ params, body }) => [params.path, body])
    ).toEqual([
      [{ scope: "user", id: "u1" }, { [RHYME]: "!" }],
      [{ scope: "instance", id: "instance" }, { [SYNONYM]: "=" }],
    ]);
  });

  it("holds a target's next request until the one before it has answered", async () => {
    mount();
    let answer!: (result: Result) => void;
    PATCH.mockImplementationOnce(
      () => new Promise<Result>((resolve) => (answer = resolve))
    );
    PATCH.mockResolvedValue(ok({ [RHYME]: row("b") }));

    start(() => writer.write("user", "u1", { [RHYME]: "a" }));
    await settle();
    start(() => writer.write("user", "u1", { [RHYME]: "b" }));
    await settle();
    expect(PATCH).toHaveBeenCalledTimes(1);

    await act(async () => answer(ok({ [RHYME]: row("a") })));
    await settle(1);
    expect(PATCH).toHaveBeenCalledTimes(2);
    expect(shown("rhyme")).toBe("b");
  });

  it("paints a written value onto <html> at once", () => {
    mount(read({ [DENSITY]: "comfortable" }));
    expect(html().getAttribute("data-density")).toBe("comfortable");

    start(() => writer.write("user", "u1", { [DENSITY]: "compact" }));

    expect(html().getAttribute("data-density")).toBe("compact");
  });

  it("restores the values and the <html> attributes, then rejects, when the server refuses", async () => {
    mount(read({ [RHYME]: "!", [DENSITY]: "comfortable" }));
    PATCH.mockResolvedValue(refused(409, "setting_locked"));

    const outcome = start(() =>
      writer.write("user", "u1", { [RHYME]: "?", [DENSITY]: "compact" })
    );
    expect(shown("rhyme")).toBe("?");
    expect(html().getAttribute("data-density")).toBe("compact");

    await settle();

    expect(shown("rhyme")).toBe("!");
    expect(shown("density")).toBe("comfortable");
    expect(html().getAttribute("data-density")).toBe("comfortable");
    const error = await outcome;
    expect(error).toBeInstanceOf(SettingsWriteError);
    expect(error).toMatchObject({
      status: 409,
      code: "setting_locked",
      details: { scope: "user", by: "instance" },
      keys: [RHYME, DENSITY],
    });
  });

  it("reports an unreachable server as a refusal", async () => {
    mount(read({ [RHYME]: "!" }));
    PATCH.mockRejectedValue(new TypeError("fetch failed"));

    const outcome = start(() => writer.write("user", "u1", { [RHYME]: "?" }));
    await settle();

    expect(shown("rhyme")).toBe("!");
    expect(await outcome).toBeInstanceOf(SettingsWriteError);
  });

  it("keeps a newer write to a key when an earlier one is refused", async () => {
    mount(read({ [RHYME]: "!" }));
    let answer!: (result: Result) => void;
    PATCH.mockImplementationOnce(
      () => new Promise<Result>((resolve) => (answer = resolve))
    );
    PATCH.mockResolvedValue(ok({ [RHYME]: row("b") }));

    const first = start(() => writer.write("user", "u1", { [RHYME]: "a" }));
    await settle();
    start(() => writer.write("user", "u1", { [RHYME]: "b" }));
    await act(async () => answer(refused(400, "invalid_request")));

    expect(shown("rhyme")).toBe("b");
    expect(await first).toBeInstanceOf(SettingsWriteError);
  });

  it("settles with the rows the server answered, the same for every write in the request", async () => {
    mount();
    const rows = { [RHYME]: row("!"), [SYNONYM]: row("?") };
    PATCH.mockResolvedValue(ok(rows));

    let first!: Promise<unknown>;
    let second!: Promise<unknown>;
    act(() => {
      first = writer.write("user", "u1", { [RHYME]: "!" });
      second = writer.write("user", "u1", { [SYNONYM]: "?" });
    });
    await settle();

    expect(await first).toEqual(rows);
    expect(await second).toEqual(rows);
  });

  it("takes the value the server resolved once a write lands", async () => {
    mount();
    PATCH.mockResolvedValue(ok({ [RHYME]: row("!!") }));

    start(() => writer.write("user", "u1", { [RHYME]: "!" }));
    await settle();

    expect(shown("rhyme")).toBe("!!");
  });

  it("waits for the server on a write below the key's highest scope", async () => {
    mount(read({ [RHYME]: "!" }));
    PATCH.mockResolvedValue(ok({ [RHYME]: row("!") }));

    start(() => writer.write("instance", "instance", { [RHYME]: "?" }));
    expect(shown("rhyme")).toBe("!");
    await settle();

    expect(shown("rhyme")).toBe("!");
  });

  it("waits for the server on a cleared key, then shows what it inherits", async () => {
    mount(read({ [RHYME]: "!" }));
    PATCH.mockResolvedValue(ok({ [RHYME]: row("\\") }));

    start(() => writer.write("user", "u1", { [RHYME]: "?" }));
    start(() => writer.write("user", "u1", { [RHYME]: null }));
    expect(shown("rhyme")).toBe("!");
    await settle();

    expect(sent().body).toEqual({ [RHYME]: null });
    expect(shown("rhyme")).toBe("\\");
  });

  it("is pending from the first write until the server answers", async () => {
    mount();
    PATCH.mockResolvedValue(ok({ [RHYME]: row("!") }));
    expect(writer.pending).toBe(false);

    start(() => writer.write("user", "u1", { [RHYME]: "!" }));
    expect(writer.pending).toBe(true);

    await settle();
    expect(writer.pending).toBe(false);
  });

  it("never refreshes the route", async () => {
    mount();
    PATCH.mockResolvedValue(ok({ [RHYME]: row("!") }));

    start(() => writer.write("user", "u1", { [RHYME]: "!" }));
    await settle();

    expect(PATCH).toHaveBeenCalledTimes(1);
    expect(routerRefresh).not.toHaveBeenCalled();
    expect(cacheRefresh).not.toHaveBeenCalled();
  });

  it("rejects outside a provider, where nobody is signed in", async () => {
    const { result } = renderHook(() => useSettingsWrite());

    const error = await result.current
      .write("user", "u1", { [RHYME]: "!" })
      .catch((e: unknown) => e);

    expect(error).toMatchObject({ status: 401 });
    expect(PATCH).not.toHaveBeenCalled();
  });
});

describe("a nested project provider", () => {
  const tree = (showProject: boolean, projectValues = read({}, "p5")) => (
    <SettingsProvider initial={read({ [DENSITY]: "comfortable" })}>
      <Probe id="outer" setting={RHYME} />
      <Probe id="outer-layout" setting={LAYOUT} />
      {showProject && (
        <SettingsProvider initial={projectValues} projectId={5}>
          <Probe id="inner" setting={RHYME} />
          <Probe id="inner-layout" setting={LAYOUT} />
          <CaptureWrite />
        </SettingsProvider>
      )}
    </SettingsProvider>
  );

  it("paints its own attributes on mount and gives the outer ones back on unmount", () => {
    const view = render(tree(true, read({ [DENSITY]: "compact" }, "p5")));
    expect(html().getAttribute("data-density")).toBe("compact");

    view.rerender(tree(false));

    expect(html().getAttribute("data-density")).toBe("comfortable");
  });

  it("carries a personal write to the outer provider, then re-reads its own", async () => {
    const view = render(tree(true));
    PATCH.mockResolvedValue(ok({ [RHYME]: row("!") }));
    GET.mockResolvedValue(
      ok({ values: { [RHYME]: "!", [LAYOUT]: "grid" }, version: "p5-2" })
    );

    start(() => writer.write("user", "u1", { [RHYME]: "!" }));
    expect(shown("inner")).toBe("!");
    expect(shown("outer")).toBe("!");
    await settle();

    expect(GET).toHaveBeenCalledTimes(1);
    expect(GET.mock.calls[0]?.[1]).toEqual({
      params: { query: { project: "5" } },
    });
    expect(shown("inner")).toBe("!");

    view.rerender(tree(false));
    expect(shown("outer")).toBe("!");
  });

  it("keeps a project write to that project's provider, taking the server's answer", async () => {
    render(tree(true));
    PATCH.mockResolvedValue(ok({ [LAYOUT]: row("list") }));

    start(() => writer.write("project", 5, { [LAYOUT]: "list" }));
    expect(shown("inner-layout")).toBe("list");
    expect(shown("outer-layout")).toBe("grid");
    await settle();

    expect(sent().params.path).toEqual({ scope: "project", id: "5" });
    expect(shown("inner-layout")).toBe("list");
    expect(shown("outer-layout")).toBe("grid");
    expect(GET).not.toHaveBeenCalled();
  });

  it("leaves another project's write alone", async () => {
    render(tree(true));
    PATCH.mockResolvedValue(ok({ [LAYOUT]: row("list") }));

    start(() => writer.write("project", 7, { [LAYOUT]: "list" }));
    await settle();

    expect(shown("inner-layout")).toBe("grid");
    expect(GET).not.toHaveBeenCalled();
  });
});

describe("useUserSettingsWrite", () => {
  const writes: UserSettingsWriteFn[] = [];
  function CaptureUserWrite() {
    writes.push(useUserSettingsWrite());
    return null;
  }

  beforeEach(() => {
    writes.length = 0;
  });

  it("writes at the signed-in member's own scope, a nested provider keeping the id", async () => {
    render(
      <SettingsProvider initial={read()} userId="u1">
        <SettingsProvider initial={read()} projectId={7}>
          <Probe id="rhyme" setting={RHYME} />
          <CaptureUserWrite />
        </SettingsProvider>
      </SettingsProvider>
    );
    PATCH.mockResolvedValue(ok({ [RHYME]: row("!") }));
    // The project's store reads its values again after a personal write.
    GET.mockResolvedValue(ok({ values: { [RHYME]: "!" }, version: "v2" }));

    const outcome = start(() => writes.at(-1)!({ [RHYME]: "!" }));
    expect(shown("rhyme")).toBe("!");
    await settle();

    expect(sent().params.path).toEqual({ scope: "user", id: "u1" });
    expect(sent().body).toEqual({ [RHYME]: "!" });
    expect(await outcome).toBe("saved");
  });

  it("rejects with a 401 and sends nothing when nobody is signed in", async () => {
    render(
      <SettingsProvider initial={read()} userId={null}>
        <Probe id="rhyme" setting={RHYME} />
        <CaptureUserWrite />
      </SettingsProvider>
    );
    const before = shown("rhyme");

    const error = await start(() => writes.at(-1)!({ [RHYME]: "!" }));
    await settle();

    expect(error).toBeInstanceOf(SettingsWriteError);
    expect((error as InstanceType<typeof SettingsWriteError>).status).toBe(401);
    expect(shown("rhyme")).toBe(before);
    expect(PATCH).not.toHaveBeenCalled();
  });
});

describe("useSettingsRefresh", () => {
  const refreshes: (() => Promise<void>)[] = [];
  function CaptureRefresh() {
    refreshes.push(useSettingsRefresh());
    return null;
  }

  beforeEach(() => {
    refreshes.length = 0;
  });

  /** Answers each effective read with the values for the project it names. */
  const answerReads = (byProject: Record<string, Record<string, unknown>>) =>
    GET.mockImplementation(async (_path, init) => {
      const project =
        (init as { params: { query: { project?: string } } }).params.query
          .project ?? "none";
      return ok({ values: byProject[project], version: `${project}-2` });
    });

  it("re-reads the nearest provider and every provider above it", async () => {
    render(
      <SettingsProvider initial={read()}>
        <Probe id="outer" setting={RHYME} />
        <SettingsProvider initial={read({}, "p5")} projectId={5}>
          <Probe id="inner" setting={RHYME} />
          <CaptureRefresh />
        </SettingsProvider>
      </SettingsProvider>
    );
    answerReads({ none: { [RHYME]: "!" }, "5": { [RHYME]: "#" } });

    await act(() => refreshes.at(-1)!());

    expect(GET).toHaveBeenCalledTimes(2);
    expect(shown("outer")).toBe("!");
    expect(shown("inner")).toBe("#");
  });

  it("keeps the values it holds when a read fails", async () => {
    render(
      <SettingsProvider initial={read({ [RHYME]: "!" })}>
        <Probe id="rhyme" setting={RHYME} />
        <CaptureRefresh />
      </SettingsProvider>
    );
    GET.mockResolvedValue(refused(500, "internal"));
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

    await act(() => refreshes.at(-1)!());

    expect(shown("rhyme")).toBe("!");
    warn.mockRestore();
  });

  it("reads nothing outside a provider", async () => {
    const { result } = renderHook(() => useSettingsRefresh());

    await result.current();

    expect(GET).not.toHaveBeenCalled();
  });
});
