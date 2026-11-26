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

const { useTableLocalState } = await import("./use-table-local-state");
const { SEARCH_DEBOUNCE_MS } = await import("./use-table-url-state");

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
async function mount(search = "") {
  setLocation(search);
  const view = renderHook(() => useTableLocalState());
  await act(async () => {});
  return view;
}

/** Runs any timer a URL write could be waiting on, inside `act`. */
const advance = (ms: number) =>
  act(() => {
    jest.advanceTimersByTime(ms);
  });

describe("useTableLocalState", () => {
  it("does not adopt the URL", async () => {
    const { result } = await mount("?q=demo&sort=title.desc&page=4");
    expect(result.current.state.globalFilter).toBe("");
    expect(result.current.state.sorting).toEqual([]);
  });

  it("never touches the URL or the router", async () => {
    const { result } = await mount("?keep=1");
    act(() => {
      result.current.setGlobalFilter("demo");
      result.current.setSorting([{ id: "title", desc: true }]);
      result.current.setColumnFilter("status", "2");
      result.current.setColumnVisibility({ isrc: false });
    });
    advance(1000);
    expect(pushState).not.toHaveBeenCalled();
    expect(replaceState).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    expect(currentUrl()).toBe(`${PATHNAME}?keep=1`);
  });

  it("keeps the state in React", async () => {
    const { result } = await mount();
    act(() => result.current.setSorting([{ id: "title", desc: true }]));
    expect(result.current.state.sorting).toEqual([{ id: "title", desc: true }]);
  });

  it("ignores popstate", async () => {
    const { result } = await mount();
    setLocation("?q=back");
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(result.current.state.globalFilter).toBe("");
  });

  it("applies and reports a saved view without writing the URL", async () => {
    const { result } = await mount();
    act(() => result.current.applyViewQuery("sort=title.desc&status=2"));
    expect(result.current.state.sorting).toEqual([{ id: "title", desc: true }]);
    expect(result.current.state.columnFilters).toEqual({ status: "2" });
    expect(result.current.viewQuery()).toBe("sort=title.desc&status=2");
    advance(1000);
    expect(pushState).not.toHaveBeenCalled();
    expect(replaceState).not.toHaveBeenCalled();
  });

  it("keeps typing responsive but debounces the search viewParams reports", async () => {
    const { result } = await mount();
    act(() => result.current.setGlobalFilter("demo"));

    // The input keeps reading the live value...
    expect(result.current.state.globalFilter).toBe("demo");
    // ...but a load fired right now would still see the old view: without
    // this, an embedded table's `serverPage.load` would fire once per
    // keystroke.
    expect(result.current.viewParams().q).toBeUndefined();

    advance(SEARCH_DEBOUNCE_MS);
    expect(result.current.viewParams().q).toBe("demo");
  });

  it("drops an emptied search from viewParams once the debounce settles", async () => {
    const { result } = await mount();
    act(() => result.current.setGlobalFilter("demo"));
    advance(SEARCH_DEBOUNCE_MS);
    expect(result.current.viewParams().q).toBe("demo");

    act(() => result.current.setGlobalFilter(""));
    advance(SEARCH_DEBOUNCE_MS);
    expect(result.current.viewParams().q).toBeUndefined();
  });
});
