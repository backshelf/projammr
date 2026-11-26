import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
  mock,
  spyOn,
} from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";

const PATHNAME = "/project/1/tracks";
const router = {
  push: mock(),
  replace: mock(),
  refresh: mock(),
  prefetch: mock(),
};

mock.module("next/navigation", () => ({
  useRouter: mock(() => router),
  usePathname: mock(() => PATHNAME),
  useSearchParams: mock(() => new URLSearchParams()),
}));

const { useTableUrlState } = await import("./use-table-url-state");

type Options = { navigate?: boolean; emptyQuery?: string };

// happy-dom starts on `about:blank`, where the History API ignores every path.
const setOrigin = () =>
  (
    window as unknown as { happyDOM: { setURL(url: string): void } }
  ).happyDOM.setURL("http://localhost/");

// Points the location at `search` without going through the spied history
// methods, so only the hook's own writes are counted.
const nativeReplaceState = window.history.replaceState.bind(window.history);
const setLocation = (search: string) =>
  nativeReplaceState(null, "", `${PATHNAME}${search}`);
const currentUrl = () => window.location.pathname + window.location.search;

let pushState: ReturnType<typeof spyOn<History, "pushState">>;
let replaceState: ReturnType<typeof spyOn<History, "replaceState">>;

// Installed once for the file: bun's fake clock leaves zero-delay timers
// unfired in every test after the first when it is re-installed per test.
beforeAll(() => jest.useFakeTimers());
afterAll(() => jest.useRealTimers());

beforeEach(() => {
  router.push.mockClear();
  router.replace.mockClear();
  setOrigin();
  setLocation("");
  pushState = spyOn(window.history, "pushState");
  replaceState = spyOn(window.history, "replaceState");
});

afterEach(() => {
  cleanup();
  pushState.mockRestore();
  replaceState.mockRestore();
});

/** Renders the hook against `search` and lets the hydration tick settle. */
async function mount(search = "", options: Options = {}) {
  setLocation(search);
  replaceState.mockClear();
  const view = renderHook((props: Options) => useTableUrlState(props), {
    initialProps: options,
  });
  await act(async () => {});
  return view;
}

/** Runs the timers a URL write is waiting on, inside `act`. */
const advance = (ms: number) =>
  act(() => {
    jest.advanceTimersByTime(ms);
  });

describe("useTableUrlState adoption", () => {
  it("starts from the feature defaults when the URL carries nothing", async () => {
    const { result } = await mount();
    expect(result.current.state).toEqual({
      globalFilter: "",
      sorting: [],
      columnVisibility: {},
      columnOrder: [],
      columnSizing: {},
      columnFilters: {},
      grouping: [],
    });
  });

  it("adopts the search term from q", async () => {
    const { result } = await mount("?q=demo%20mix");
    expect(result.current.state.globalFilter).toBe("demo mix");
  });

  it("adopts sort as id.dir pairs, anything but desc reading as ascending", async () => {
    const { result } = await mount("?sort=title.desc,bpm.asc,key,.desc");
    expect(result.current.state.sorting).toEqual([
      { id: "title", desc: true },
      { id: "bpm", desc: false },
      { id: "key", desc: false },
    ]);
  });

  it("adopts cols with a leading - as hidden and the rest as visible", async () => {
    const { result } = await mount("?cols=-isrc,title,-iswc,");
    expect(result.current.state.columnVisibility).toEqual({
      isrc: false,
      title: true,
      iswc: false,
    });
  });

  it("adopts order as the listed column ids", async () => {
    const { result } = await mount("?order=bpm,,title,key");
    expect(result.current.state.columnOrder).toEqual(["bpm", "title", "key"]);
  });

  it("adopts w as id:px pairs, dropping entries whose width is not a number", async () => {
    const { result } = await mount("?w=title:240,bpm:80.4,key:wide,bare");
    expect(result.current.state.columnSizing).toEqual({
      title: 240,
      bpm: 80.4,
    });
  });

  it("reads an empty width as 0px", async () => {
    const { result } = await mount("?w=title:");
    expect(result.current.state.columnSizing).toEqual({ title: 0 });
  });

  it("adopts group as the listed column ids", async () => {
    const { result } = await mount("?group=status,,collection");
    expect(result.current.state.grouping).toEqual(["status", "collection"]);
  });

  it("adopts every filter param and ignores unknown or empty ones", async () => {
    const { result } = await mount(
      "?status=2&collection=7&relation=owner&label=4&artist=Ada&daw=Ableton&track=9&colour=red&genre="
    );
    expect(result.current.state.columnFilters).toEqual({
      status: "2",
      collection: "7",
      relation: "owner",
      label: "4",
      artist: "Ada",
      daw: "Ableton",
      track: "9",
    });
  });

  it("adopts the Explicit filter and a custom field's cf_ filter, ignoring a key that only looks like one", async () => {
    const { result } = await mount("?explicit=true&cf_12=3..9&cf_x=1");
    expect(result.current.state.columnFilters).toEqual({
      explicit: "true",
      cf_12: "3..9",
    });
    expect(result.current.viewParams()).toMatchObject({
      explicit: "true",
      cf_12: "3..9",
    });
  });
});

describe("useTableUrlState custom field filters", () => {
  it("writes a cf_ filter to the URL and clears it again", async () => {
    const { result } = await mount();
    await act(async () => result.current.setColumnFilter("cf_4", "unset"));
    await advance(0);
    expect(currentUrl()).toBe(`${PATHNAME}?cf_4=unset`);

    await act(async () => result.current.setColumnFilter("cf_4", null));
    await advance(0);
    expect(currentUrl()).toBe(PATHNAME);
  });

  it("round-trips the Explicit and cf_ filters through a saved view", async () => {
    const { result } = await mount("?explicit=false&cf_2=..5&page=3");
    const saved = result.current.viewQuery();
    expect(saved).toBe("explicit=false&cf_2=..5");

    await act(async () => result.current.applyViewQuery(""));
    expect(result.current.state.columnFilters).toEqual({});
    await act(async () => result.current.applyViewQuery(saved));
    expect(result.current.state.columnFilters).toEqual({
      explicit: "false",
      cf_2: "..5",
    });
  });

  it("round-trips the sessions' In dit filter through the URL and a saved view", async () => {
    const { result } = await mount("?inDit=false&page=2");
    expect(result.current.state.columnFilters).toEqual({ inDit: "false" });
    const saved = result.current.viewQuery();
    expect(saved).toBe("inDit=false");

    await act(async () => result.current.applyViewQuery(""));
    expect(result.current.state.columnFilters).toEqual({});
    await act(async () => result.current.applyViewQuery(saved));
    expect(result.current.state.columnFilters).toEqual({ inDit: "false" });
  });
});

describe("useTableUrlState writes: first run", () => {
  it("leaves a canonical URL alone", async () => {
    await mount("?q=demo&sort=title.desc");
    advance(1000);
    expect(pushState).not.toHaveBeenCalled();
    expect(replaceState).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("rewrites a non-canonical URL by replacing, after 0ms, keeping unrelated params", async () => {
    await mount("?utm=1&page=abc&w=title:240.6");
    expect(currentUrl()).toBe(`${PATHNAME}?utm=1&page=abc&w=title:240.6`);
    advance(0);
    expect(pushState).not.toHaveBeenCalled();
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(currentUrl()).toBe(`${PATHNAME}?utm=1&w=title%3A241`);
  });

  it("goes through router.replace in navigate mode, since the first run is not layout-only", async () => {
    await mount("?page=0", { navigate: true });
    advance(0);
    expect(router.replace).toHaveBeenCalledWith(PATHNAME, { scroll: false });
    expect(router.push).not.toHaveBeenCalled();
    expect(replaceState).not.toHaveBeenCalled();
  });

  it("consumes the first run even when the URL already matches, so the next change pushes", async () => {
    const { result } = await mount("?q=demo");
    act(() => result.current.setSorting([{ id: "title", desc: true }]));
    advance(0);
    expect(pushState).toHaveBeenCalledTimes(1);
    expect(replaceState).not.toHaveBeenCalled();
  });
});

describe("useTableUrlState emptyQuery", () => {
  it("canonicalises a bare first render to emptyQuery, by replace, never a navigation", async () => {
    await mount("", { navigate: true, emptyQuery: "view=list" });
    advance(0);
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(currentUrl()).toBe(`${PATHNAME}?view=list`);
    expect(router.replace).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("leaves a bare URL alone with no emptyQuery given", async () => {
    await mount("", { navigate: true });
    advance(0);
    expect(replaceState).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("writes emptyQuery instead of a bare URL when a later change empties the projection", async () => {
    const { result } = await mount("?q=demo", {
      navigate: true,
      emptyQuery: "view=list",
    });
    await act(async () => result.current.applyViewQuery(""));
    advance(0);
    expect(router.push).toHaveBeenCalledWith(`${PATHNAME}?view=list`, {
      scroll: false,
    });
    expect(replaceState).not.toHaveBeenCalled();
  });
});

describe("useTableUrlState setters: push or replace", () => {
  it("pushes on a sort change", async () => {
    const { result } = await mount();
    act(() => result.current.setSorting([{ id: "title", desc: true }]));
    advance(0);
    expect(pushState).toHaveBeenCalledTimes(1);
    expect(replaceState).not.toHaveBeenCalled();
    expect(currentUrl()).toBe(`${PATHNAME}?sort=title.desc`);
  });

  it("pushes on a column filter change", async () => {
    const { result } = await mount();
    act(() => result.current.setColumnFilter("status", "2"));
    advance(0);
    expect(pushState).toHaveBeenCalledTimes(1);
    expect(currentUrl()).toBe(`${PATHNAME}?status=2`);
  });

  it("pushes on a grouping change", async () => {
    const { result } = await mount();
    act(() => result.current.setGrouping(["status"]));
    advance(0);
    expect(pushState).toHaveBeenCalledTimes(1);
    expect(currentUrl()).toBe(`${PATHNAME}?group=status`);
  });

  it("pushes on a column visibility change", async () => {
    const { result } = await mount();
    act(() => result.current.setColumnVisibility({ isrc: false, bpm: true }));
    advance(0);
    expect(pushState).toHaveBeenCalledTimes(1);
    expect(currentUrl()).toBe(`${PATHNAME}?cols=-isrc%2Cbpm`);
  });

  it("pushes on a column order change", async () => {
    const { result } = await mount();
    act(() => result.current.setColumnOrder(["bpm", "title"]));
    advance(0);
    expect(pushState).toHaveBeenCalledTimes(1);
    expect(currentUrl()).toBe(`${PATHNAME}?order=bpm%2Ctitle`);
  });

  it("pushes on drillIntoGroup", async () => {
    const { result } = await mount("?group=status");
    act(() => result.current.drillIntoGroup("status", "3"));
    advance(0);
    expect(pushState).toHaveBeenCalledTimes(1);
    expect(currentUrl()).toBe(`${PATHNAME}?status=3`);
  });

  it("replaces on a search change, after 150ms", async () => {
    const { result } = await mount();
    act(() => result.current.setGlobalFilter("demo"));
    advance(149);
    expect(currentUrl()).toBe(PATHNAME);
    advance(1);
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(pushState).not.toHaveBeenCalled();
    expect(currentUrl()).toBe(`${PATHNAME}?q=demo`);
  });

  it("replaces on a column resize, after 150ms, writing rounded widths", async () => {
    const { result } = await mount();
    act(() => result.current.setColumnSizing({ title: 240.6, bpm: 80.2 }));
    advance(149);
    expect(currentUrl()).toBe(PATHNAME);
    advance(1);
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(pushState).not.toHaveBeenCalled();
    expect(currentUrl()).toBe(`${PATHNAME}?w=title%3A241%2Cbpm%3A80`);
  });

  it("collapses a burst of searches into one write of the last value", async () => {
    const { result } = await mount();
    act(() => result.current.setGlobalFilter("d"));
    advance(100);
    act(() => result.current.setGlobalFilter("de"));
    advance(100);
    act(() => result.current.setGlobalFilter("dem"));
    advance(150);
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(currentUrl()).toBe(`${PATHNAME}?q=dem`);
  });

  it("lets a push swallow a search write still waiting to replace", async () => {
    const { result } = await mount();
    act(() => result.current.setGlobalFilter("demo"));
    advance(50);
    act(() => result.current.setSorting([{ id: "title", desc: false }]));
    advance(0);
    expect(replaceState).not.toHaveBeenCalled();
    expect(pushState).toHaveBeenCalledTimes(1);
    expect(currentUrl()).toBe(`${PATHNAME}?q=demo&sort=title.asc`);
    advance(1000);
    expect(pushState).toHaveBeenCalledTimes(1);
  });
});

describe("useTableUrlState setters: no page param", () => {
  it("drops a stale page param from the URL on the first projection", async () => {
    await mount("?q=demo&page=4");
    advance(0);
    expect(currentUrl()).toBe(`${PATHNAME}?q=demo`);
  });

  it("returns from viewParams() the same fields viewQuery() serialises", async () => {
    const { result } = await mount(
      "?q=demo&sort=title.desc&status=2&artist=Ada&cols=-isrc&order=bpm&w=title:200&group=status"
    );
    expect(result.current.viewParams()).toEqual({
      q: "demo",
      sort: "title.desc",
      status: 2,
      artist: "Ada",
      group: "status",
    });
    expect(result.current.viewQuery()).toBe(
      "q=demo&sort=title.desc&cols=-isrc&order=bpm&w=title%3A200&group=status&status=2&artist=Ada"
    );
  });

  it("keeps every other param on a sort change", async () => {
    const { result } = await mount("?q=demo&status=2&cols=-isrc");
    act(() => result.current.setSorting([{ id: "title", desc: true }]));
    advance(0);
    expect(currentUrl()).toBe(
      `${PATHNAME}?q=demo&status=2&cols=-isrc&sort=title.desc`
    );
  });
});

describe("useTableUrlState setter arguments", () => {
  it("passes the previous value to an updater function", async () => {
    const { result } = await mount("?sort=title.asc&cols=-isrc");
    act(() =>
      result.current.setSorting((prev: { id: string; desc: boolean }[]) => [
        ...prev,
        { id: "bpm", desc: true },
      ])
    );
    expect(result.current.state.sorting).toEqual([
      { id: "title", desc: false },
      { id: "bpm", desc: true },
    ]);
    act(() =>
      result.current.setColumnVisibility((prev: Record<string, boolean>) => ({
        ...prev,
        iswc: false,
      }))
    );
    expect(result.current.state.columnVisibility).toEqual({
      isrc: false,
      iswc: false,
    });
  });

  it("stringifies a non-string search value and reads null as empty", async () => {
    const { result } = await mount();
    act(() => result.current.setGlobalFilter(42));
    expect(result.current.state.globalFilter).toBe("42");
    act(() => result.current.setGlobalFilter(null));
    expect(result.current.state.globalFilter).toBe("");
  });

  it("removes a column filter set to null or an empty string", async () => {
    const { result } = await mount("?status=2&daw=Ableton");
    act(() => result.current.setColumnFilter("status", null));
    expect(result.current.state.columnFilters).toEqual({ daw: "Ableton" });
    act(() => result.current.setColumnFilter("daw", ""));
    expect(result.current.state.columnFilters).toEqual({});
    advance(0);
    expect(currentUrl()).toBe(PATHNAME);
  });
});

describe("useTableUrlState navigate mode", () => {
  it("sends a sort change through router.push, after 0ms", async () => {
    const { result } = await mount("", { navigate: true });
    act(() => result.current.setSorting([{ id: "title", desc: true }]));
    advance(0);
    expect(router.push).toHaveBeenCalledWith(`${PATHNAME}?sort=title.desc`, {
      scroll: false,
    });
    expect(router.replace).not.toHaveBeenCalled();
    expect(pushState).not.toHaveBeenCalled();
  });

  it("sends a search change through router.replace, after 300ms", async () => {
    const { result } = await mount("", { navigate: true });
    act(() => result.current.setGlobalFilter("demo"));
    advance(299);
    expect(router.replace).not.toHaveBeenCalled();
    advance(1);
    expect(router.replace).toHaveBeenCalledWith(`${PATHNAME}?q=demo`, {
      scroll: false,
    });
    expect(router.push).not.toHaveBeenCalled();
    expect(replaceState).not.toHaveBeenCalled();
  });

  it("sends filter and grouping changes through router.push", async () => {
    const { result } = await mount("", { navigate: true });
    act(() => result.current.setColumnFilter("status", "2"));
    advance(0);
    act(() => result.current.setGrouping(["status"]));
    advance(0);
    expect(router.push).toHaveBeenCalledTimes(2);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("writes a visibility change through history.pushState, never the router", async () => {
    const { result } = await mount("", { navigate: true });
    act(() => result.current.setColumnVisibility({ isrc: false }));
    advance(0);
    expect(pushState).toHaveBeenCalledTimes(1);
    expect(currentUrl()).toBe(`${PATHNAME}?cols=-isrc`);
    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("writes a column order change through history.pushState, never the router", async () => {
    const { result } = await mount("", { navigate: true });
    act(() => result.current.setColumnOrder(["bpm", "title"]));
    advance(0);
    expect(pushState).toHaveBeenCalledTimes(1);
    expect(router.push).not.toHaveBeenCalled();
  });

  it("writes a resize through history.replaceState after 300ms, never the router", async () => {
    const { result } = await mount("", { navigate: true });
    act(() => result.current.setColumnSizing({ title: 200 }));
    advance(299);
    expect(replaceState).not.toHaveBeenCalled();
    advance(1);
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(currentUrl()).toBe(`${PATHNAME}?w=title%3A200`);
    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("does not use the router when navigate is off", async () => {
    const { result } = await mount();
    act(() => result.current.setSorting([{ id: "title", desc: true }]));
    act(() => result.current.setGlobalFilter("demo"));
    advance(1000);
    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });
});

describe("useTableUrlState popstate", () => {
  it("re-adopts a canonical URL without writing it back", async () => {
    const { result } = await mount("?q=first");
    setLocation("?q=second&sort=bpm.desc");
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(result.current.state.globalFilter).toBe("second");
    expect(result.current.state.sorting).toEqual([{ id: "bpm", desc: true }]);
    advance(1000);
    expect(pushState).not.toHaveBeenCalled();
    expect(replaceState).not.toHaveBeenCalled();
  });

  it("purges a stale page param a popstate lands back on", async () => {
    const { result } = await mount("?q=first");
    setLocation("?q=second&sort=bpm.desc&page=3");
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(result.current.state.globalFilter).toBe("second");
    advance(0);
    expect(currentUrl()).toBe(`${PATHNAME}?q=second&sort=bpm.desc`);
  });

  it("is ignored in navigate mode, where the router owns back and forward", async () => {
    const { result } = await mount("?q=first", { navigate: true });
    setLocation("?q=second");
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(result.current.state.globalFilter).toBe("first");
  });
});

describe("useTableUrlState applyViewQuery", () => {
  it("replaces the whole view with the saved one", async () => {
    const { result } = await mount(
      "?q=demo&sort=title.asc&page=4&status=2&cols=-isrc&order=bpm&w=title:200&group=status"
    );
    act(() =>
      result.current.applyViewQuery("sort=bpm.desc&daw=Logic&page=5&junk=1")
    );
    expect(result.current.state).toEqual({
      globalFilter: "",
      sorting: [{ id: "bpm", desc: true }],
      columnVisibility: {},
      columnOrder: [],
      columnSizing: {},
      columnFilters: { daw: "Logic" },
      grouping: [],
    });
  });

  it("clears the params the view omits from the URL, pushing after 0ms", async () => {
    const { result } = await mount(
      "?keep=1&q=demo&sort=title.asc&page=4&status=2&cols=-isrc&order=bpm&w=title:200&group=status"
    );
    act(() => result.current.applyViewQuery("sort=bpm.desc"));
    advance(0);
    expect(pushState).toHaveBeenCalledTimes(1);
    expect(currentUrl()).toBe(`${PATHNAME}?keep=1&sort=bpm.desc`);
  });

  it("goes through router.push in navigate mode", async () => {
    const { result } = await mount("?q=demo&page=2", { navigate: true });
    act(() => result.current.applyViewQuery("status=3"));
    advance(0);
    expect(router.push).toHaveBeenCalledWith(`${PATHNAME}?status=3`, {
      scroll: false,
    });
  });

  it("clears everything for an empty saved view", async () => {
    const { result } = await mount("?q=demo&page=2");
    act(() => result.current.applyViewQuery(""));
    expect(result.current.state.globalFilter).toBe("");
    advance(0);
    expect(currentUrl()).toBe(PATHNAME);
  });
});

describe("useTableUrlState viewQuery", () => {
  it("is empty for a default view", async () => {
    const { result } = await mount();
    expect(result.current.viewQuery()).toBe("");
  });

  it("carries the view params in canonical order and leaves the page out", async () => {
    const { result } = await mount(
      "?page=4&group=status&w=title:200&order=bpm,title&cols=-isrc&status=2&sort=title.desc&q=demo&utm=1"
    );
    expect(result.current.viewQuery()).toBe(
      "q=demo&sort=title.desc&cols=-isrc&order=bpm%2Ctitle&w=title%3A200&group=status&status=2"
    );
  });

  it("rounds widths and follows state changes", async () => {
    const { result } = await mount("?page=2");
    act(() => result.current.setColumnSizing({ title: 240.6 }));
    act(() => result.current.setColumnFilter("daw", "Logic"));
    expect(result.current.viewQuery()).toBe("w=title%3A241&daw=Logic");
  });

  it("round-trips through applyViewQuery", async () => {
    const { result } = await mount(
      "?q=demo&sort=title.desc&cols=-isrc&order=bpm&w=title:200&group=status&daw=Logic"
    );
    const saved = result.current.viewQuery();
    act(() => result.current.applyViewQuery(""));
    expect(result.current.viewQuery()).toBe("");
    act(() => result.current.applyViewQuery(saved));
    expect(result.current.viewQuery()).toBe(saved);
  });
});
