import type { TableSearchParams } from "@/lib/table-params";
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "bun:test";

const { deferredLoad, rowsOf } = await import("./test-support");
const { useLoadedWindow } = await import("./use-loaded-window");
const { locationViewParams } = await import("./use-table-url-state");

// happy-dom starts on about:blank, where `history.replaceState` is ignored, so
// the location is set through the window's own controller.
type HappyWindow = { happyDOM: { setURL(url: string): void } };
const happyDOM = (window as unknown as HappyWindow).happyDOM;
const START_URL = window.location.href;
afterEach(() => happyDOM.setURL(START_URL));

const PAGE = 5;

// A URL table's `rows` prop is what the server rendered for the location, so
// a view that lands on the location's view needs no navigation to page.
describe("useLoadedWindow: a URL table's rows prop and its view", () => {
  function renderUrlWindow(initial: TableSearchParams) {
    const { load } = deferredLoad();
    const rows = rowsOf(PAGE);
    const serverPage = { rowCount: 12, load };
    const hook = renderHook(
      ({ view }: { view: TableSearchParams }) =>
        useLoadedWindow({
          rows,
          serverPage,
          viewParams: () => view,
          serverDriven: true,
          grouped: false,
        }),
      { initialProps: { view: initial } }
    );
    return { ...hook, load };
  }

  it("still pages after adopting the location's view over the server's rows", () => {
    happyDOM.setURL("http://localhost/project/1/tracks?sort=title");
    const urlView = locationViewParams();
    expect(urlView).not.toEqual({});

    // The hydration render starts from the default view; the next adopts the URL's.
    const { result, rerender } = renderUrlWindow({});
    rerender({ view: urlView });

    expect(result.current.loaded.hasMore).toBe(true);
  });

  it("holds paging on another view, and resumes on returning to the prop's own", () => {
    happyDOM.setURL("http://localhost/project/1/tracks");
    const { result, rerender } = renderUrlWindow({});

    rerender({ view: { q: "a" } });
    expect(result.current.loaded.hasMore).toBe(false);

    rerender({ view: {} });
    expect(result.current.loaded.hasMore).toBe(true);
  });
});
