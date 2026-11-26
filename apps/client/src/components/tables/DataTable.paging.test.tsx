import type { TableStateSource } from "./DataTable";
import type { PageResult } from "./generic-table-types";
import type { LoadCall, Row, TestDataTableProps } from "./test-support";
import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { useLayoutEffect } from "react";
import { useDataTableConfig } from "./data-table-context";

// The loaded window: the rows the root holds. The `data` prop seeds page 1,
// `loadMore` appends through `serverPage.load`, a new `data` prop under the
// same view refetches what is loaded, and a view change starts over. A table
// without `serverPage` holds exactly its `data` prop.

const toastError = mock();
mock.module("sonner", () => ({
  toast: { success: mock(), error: toastError },
}));

const { deferredLoad, pressHotkey, renderGrid, rowsOf, stateProbe } =
  await import("./test-support");

/** The server's page size in these suites; small, so a view spans pages. */
const PAGE = 5;

const pageResult = (rows: Row[], rowCount: number): PageResult<Row> => ({
  rows,
  rowCount,
  pageSize: PAGE,
});

// happy-dom starts on about:blank, where `history.replaceState` is ignored, so
// the location is set through the window's own controller.
type HappyWindow = { happyDOM: { setURL(url: string): void } };
const happyDOM = (window as unknown as HappyWindow).happyDOM;
const START_URL = window.location.href;

function locate(search: string) {
  happyDOM.setURL(`http://localhost/project/1/tracks${search}`);
}

beforeEach(() => toastError.mockClear());
afterEach(() => happyDOM.setURL(START_URL));

const footer = () => screen.getByText(/^\d+ rows?( in \d+ groups)?$/);

const titles = (container: HTMLElement) =>
  Array.from(
    container.querySelectorAll<HTMLElement>('[data-cell$="::title"]')
  ).map((cell) => cell.textContent);

const titlesOf = (rows: Row[]) => rows.map((row) => row.title);

const renamed = (rows: Row[], prefix: string) =>
  rows.map((row) => ({ ...row, title: `${prefix} ${row.id}` }));

/**
 * Renders the table with a probe on its state half, beside any `children`,
 * then lets it adopt the URL once it has hydrated. `rerenderWith` hands the
 * table new props.
 */
async function renderWindow(overrides: Partial<TestDataTableProps<Row>>) {
  const probe = stateProbe();
  const result = renderGrid(undefined, undefined, {
    ...overrides,
    children: (
      <>
        <probe.Probe />
        {overrides.children}
      </>
    ),
  });
  await act(async () => {});
  const rerenderWith = (next: Partial<TestDataTableProps<Row>>) =>
    act(async () => {
      result.rerender(result.gridFor(next));
    });
  return { ...result, state: probe.state, rerenderWith };
}

/** A page's own table: its view lives in the URL, and the server renders `data` for it. */
function urlTable(
  load: ReturnType<typeof deferredLoad>["load"],
  rowCount = 12
): Partial<TestDataTableProps<Row>> {
  locate("");
  return {
    data: rowsOf(PAGE),
    persistStateInUrl: true,
    serverPage: { rowCount, load },
  };
}

/** An embedded table: its view is React state, and `data` is page 1 of the view it mounted with. */
function embeddedTable(
  load: ReturnType<typeof deferredLoad>["load"],
  rowCount = 12
): Partial<TestDataTableProps<Row>> {
  return {
    data: rowsOf(PAGE),
    persistStateInUrl: false,
    serverPage: { rowCount, load },
  };
}

/** Calls a loader inside `act`, and hands back its promise unawaited. */
async function begin<T>(run: () => Promise<T>) {
  let promise: Promise<T> | undefined;
  await act(async () => {
    promise = run();
  });
  return { promise: promise! };
}

/**
 * Sorts by genre. The stubbed router goes nowhere: a suite lands the
 * navigation by moving the location to `SORTED_BY_GENRE` and handing the
 * table the server's rows for it, as Next does in one commit.
 */
const sortByGenre = () =>
  act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /Genre/ }));
  });

const SORTED_BY_GENRE = "?sort=genre.asc";

/**
 * A child that hands out the root's view state, for a suite to change the
 * view the way a control does.
 */
function viewProbe() {
  let view: TableStateSource | undefined;
  function ViewProbe() {
    const { urlState } = useDataTableConfig<Row>();
    useLayoutEffect(() => {
      view = urlState;
    });
    return null;
  }
  return {
    ViewProbe,
    view: () => {
      if (!view) throw new Error("the view probe has not rendered");
      return view;
    },
  };
}

/** Loads page 2 through `loadMore` and waits for it to land. */
async function appendPage(
  state: ReturnType<typeof stateProbe>["state"],
  call: () => LoadCall | undefined,
  settle: ReturnType<typeof deferredLoad>["settle"],
  rowCount = 12
) {
  const { promise } = await begin(() => state().loadMore());
  await settle(call(), pageResult(rowsOf(PAGE, PAGE + 1), rowCount));
  await promise;
}

describe("DataTable loaded window: seeding and appending", () => {
  it("seeds page 1 from the data prop and counts the server's total", async () => {
    const { load } = deferredLoad();
    const { container, state } = await renderWindow(urlTable(load));

    expect(titles(container)).toEqual(titlesOf(rowsOf(PAGE)));
    expect(footer().textContent).toBe("12 rows");
    expect(state().loaded).toEqual({
      count: PAGE,
      hasMore: true,
      state: "idle",
    });
    expect(load).not.toHaveBeenCalled();
  });

  it("appends the next page for the current view, merging it by id", async () => {
    const { load, calls, settle } = deferredLoad();
    const { container, state } = await renderWindow(urlTable(load));

    const { promise } = await begin(() => state().loadMore());
    expect(calls.map(({ page, view }) => [page, view])).toEqual([[2, {}]]);
    expect(state().loaded.state).toBe("loading");

    // Row 5 comes back again, renamed; rows 6 to 9 are new.
    const edited = { ...rowsOf(1, PAGE)[0]!, title: "Renamed" };
    await settle(calls[0], pageResult([edited, ...rowsOf(4, PAGE + 1)], 12));
    await promise;

    expect(titles(container)).toEqual([
      ...titlesOf(rowsOf(PAGE - 1)),
      "Renamed",
      ...titlesOf(rowsOf(4, PAGE + 1)),
    ]);
    expect(state().loaded).toEqual({ count: 9, hasMore: true, state: "idle" });
  });

  it("shares one request between loadMore calls made while a page loads", async () => {
    const { load, calls, settle } = deferredLoad();
    const { state } = await renderWindow(urlTable(load));

    const first = await begin(() => state().loadMore());
    const second = await begin(() => state().loadMore());

    expect(second.promise).toBe(first.promise);
    expect(load).toHaveBeenCalledTimes(1);

    await settle(calls[0], pageResult(rowsOf(PAGE, PAGE + 1), 12));
    await first.promise;
    expect(state().loaded.count).toBe(2 * PAGE);
  });

  it("marks a failed page, and fetches that page again on retryLoad", async () => {
    const { load, calls, settle } = deferredLoad();
    const { state } = await renderWindow(urlTable(load));

    const failed = await begin(() => state().loadMore());
    await settle(calls[0]);
    await failed.promise;
    expect(state().loaded).toEqual({
      count: PAGE,
      hasMore: true,
      state: "error",
    });

    // A failed page is not fetched again by the next loadMore.
    await (
      await begin(() => state().loadMore())
    ).promise;
    expect(load).toHaveBeenCalledTimes(1);

    const retried = await begin(() => state().retryLoad());
    expect(calls[1]?.page).toBe(2);
    expect(state().loaded.state).toBe("loading");

    await settle(calls[1], pageResult(rowsOf(PAGE, PAGE + 1), 12));
    await retried.promise;
    expect(state().loaded).toEqual({
      count: 2 * PAGE,
      hasMore: true,
      state: "idle",
    });
  });

  it("loads until a row exists, and reports a row past the total as missing", async () => {
    const { load, calls, settle } = deferredLoad();
    const { state } = await renderWindow(urlTable(load, 8));

    const loadedAlready = await begin(() => state().ensureLoaded(PAGE - 1));
    expect(await loadedAlready.promise).toBe(true);
    expect(load).not.toHaveBeenCalled();

    const found = await begin(() => state().ensureLoaded(6));
    expect(calls[0]?.page).toBe(2);
    await settle(calls[0], pageResult(rowsOf(3, PAGE + 1), 8));
    expect(await found.promise).toBe(true);

    const missing = await begin(() => state().ensureLoaded(8));
    expect(await missing.promise).toBe(false);
    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe("DataTable loaded window: a new data prop under the same view", () => {
  it("refetches every loaded page in parallel and replaces the window", async () => {
    const { load, calls, settle } = deferredLoad();
    const { container, state, rerenderWith } = await renderWindow(
      urlTable(load)
    );
    await appendPage(state, () => calls[0], settle);

    await rerenderWith({
      data: rowsOf(PAGE),
      serverPage: { rowCount: 12, load },
    });

    expect(calls.slice(1).map(({ page }) => page)).toEqual([1, 2]);
    // Nothing lands until every page has.
    await settle(
      calls[2],
      pageResult(renamed(rowsOf(PAGE, PAGE + 1), "Fresh"), 12)
    );
    expect(titles(container)).toEqual(titlesOf(rowsOf(2 * PAGE)));

    await settle(calls[1], pageResult(renamed(rowsOf(PAGE), "Fresh"), 12));
    expect(titles(container)).toEqual(
      titlesOf(renamed(rowsOf(2 * PAGE), "Fresh"))
    );
    expect(state().loaded).toEqual({
      count: 2 * PAGE,
      hasMore: true,
      state: "idle",
    });
  });

  it("takes the data prop itself while a URL table holds only page 1", async () => {
    const { load } = deferredLoad();
    const { container, rerenderWith } = await renderWindow(urlTable(load));

    await rerenderWith({
      data: renamed(rowsOf(PAGE), "Edited"),
      serverPage: { rowCount: 11, load },
    });

    expect(load).not.toHaveBeenCalled();
    expect(titles(container)).toEqual(
      titlesOf(renamed(rowsOf(PAGE), "Edited"))
    );
    expect(footer().textContent).toBe("11 rows");
  });

  it("keeps the window and says so when the refetch fails", async () => {
    const { load, calls, settle } = deferredLoad();
    const { container, state, rerenderWith } = await renderWindow(
      urlTable(load)
    );
    await appendPage(state, () => calls[0], settle);

    await rerenderWith({
      data: rowsOf(PAGE),
      serverPage: { rowCount: 12, load },
    });
    await settle(calls[1]);
    await settle(calls[2], pageResult(rowsOf(PAGE, PAGE + 1), 12));

    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith("Couldn't refresh the table");
    expect(titles(container)).toEqual(titlesOf(rowsOf(2 * PAGE)));
    expect(state().loaded.count).toBe(2 * PAGE);
  });

  it("lets the refetch win over an append in flight, then runs the append on the refetched window", async () => {
    const { load, calls, settle } = deferredLoad();
    const { container, state, rerenderWith } = await renderWindow(
      urlTable(load, 15)
    );
    await appendPage(state, () => calls[0], settle, 15);
    const third = await begin(() => state().loadMore());
    expect(calls[1]?.page).toBe(3);

    await rerenderWith({
      data: rowsOf(PAGE),
      serverPage: { rowCount: 15, load },
    });
    expect(calls.slice(2).map(({ page }) => page)).toEqual([1, 2]);

    // Page 3 answers before the refetch: it describes the old window, so it
    // does not land, and it is not asked for again until the refetch has.
    await settle(calls[1], pageResult(rowsOf(PAGE, 2 * PAGE + 1), 15));
    expect(state().loaded.count).toBe(2 * PAGE);
    expect(calls).toHaveLength(4);

    await settle(calls[2], pageResult(renamed(rowsOf(PAGE), "Fresh"), 15));
    await settle(
      calls[3],
      pageResult(renamed(rowsOf(PAGE, PAGE + 1), "Fresh"), 15)
    );
    expect(calls[4]?.page).toBe(3);
    expect(titles(container)).toEqual(
      titlesOf(renamed(rowsOf(2 * PAGE), "Fresh"))
    );

    await settle(calls[4], pageResult(rowsOf(PAGE, 2 * PAGE + 1), 15));
    await third.promise;
    expect(titles(container)).toEqual([
      ...titlesOf(renamed(rowsOf(2 * PAGE), "Fresh")),
      ...titlesOf(rowsOf(PAGE, 2 * PAGE + 1)),
    ]);
    expect(state().loaded).toEqual({
      count: 3 * PAGE,
      hasMore: false,
      state: "idle",
    });
  });

  it("claims no more rows once the server's count falls below the window", async () => {
    const { load, calls, settle } = deferredLoad();
    const { container, state, rerenderWith } = await renderWindow(
      urlTable(load)
    );
    await appendPage(state, () => calls[0], settle);

    await rerenderWith({
      data: rowsOf(PAGE),
      serverPage: { rowCount: 7, load },
    });
    await settle(calls[1], pageResult(rowsOf(PAGE), 7));
    await settle(calls[2], pageResult(rowsOf(2, PAGE + 1), 7));

    expect(titles(container)).toEqual(titlesOf(rowsOf(7)));
    expect(footer().textContent).toBe("7 rows");
    expect(state().loaded).toEqual({ count: 7, hasMore: false, state: "idle" });
  });
});

describe("DataTable loaded window: a view change", () => {
  it("resets a URL table to the data prop and drops the page in flight", async () => {
    const { load, calls, settle } = deferredLoad();
    const { container, state, rerenderWith } = await renderWindow(
      urlTable(load, 15)
    );
    await appendPage(state, () => calls[0], settle, 15);
    const third = await begin(() => state().loadMore());

    await sortByGenre();

    // Until the navigation lands, the prop is still the old view's page 1:
    // shown, but not paged under the new view.
    expect(titles(container)).toEqual(titlesOf(rowsOf(PAGE)));
    expect(state().loaded).toEqual({
      count: PAGE,
      hasMore: false,
      state: "idle",
    });

    await settle(calls[1], pageResult(rowsOf(PAGE, 2 * PAGE + 1), 15));
    await third.promise;
    expect(state().loaded.count).toBe(PAGE);
    // The server renders the new view's page 1 as props; nothing is fetched.
    expect(load).toHaveBeenCalledTimes(2);

    locate(SORTED_BY_GENRE);
    await rerenderWith({
      data: renamed(rowsOf(PAGE), "Sorted"),
      serverPage: { rowCount: 15, load },
    });
    expect(titles(container)).toEqual(
      titlesOf(renamed(rowsOf(PAGE), "Sorted"))
    );
    expect(state().loaded.hasMore).toBe(true);
  });

  it("does not page a URL table's old rows under its new view", async () => {
    const { load } = deferredLoad();
    const { state } = await renderWindow(urlTable(load, 15));

    await sortByGenre();

    await (
      await begin(() => state().loadMore())
    ).promise;
    const reached = await begin(() => state().ensureLoaded(PAGE + 1));
    expect(await reached.promise).toBe(false);
    expect(load).not.toHaveBeenCalled();
  });

  // Rows the server rendered for the location (an earlier navigation landing
  // late, or a refresh) arrive after the view has moved on, and the view then
  // returns to theirs with no navigation to come.
  it("pages rows that landed after the view moved on, once the view returns to theirs", async () => {
    const { load } = deferredLoad();
    const { ViewProbe, view } = viewProbe();
    const { state, rerenderWith } = await renderWindow({
      ...urlTable(load, 15),
      children: <ViewProbe />,
    });

    await sortByGenre();
    await rerenderWith({
      data: renamed(rowsOf(PAGE), "Late"),
      serverPage: { rowCount: 15, load },
    });
    expect(state().loaded.hasMore).toBe(false);

    await act(async () => view().setSorting([]));
    expect(state().loaded.hasMore).toBe(true);
  });

  it("pages the rows browser back restores, once the view returns to theirs", async () => {
    const { load } = deferredLoad();
    const { ViewProbe, view } = viewProbe();
    const { state, rerenderWith } = await renderWindow({
      ...urlTable(load, 15),
      children: <ViewProbe />,
    });
    await sortByGenre();
    locate(SORTED_BY_GENRE);
    await rerenderWith({
      data: renamed(rowsOf(PAGE), "Sorted"),
      serverPage: { rowCount: 15, load },
    });
    expect(state().loaded.hasMore).toBe(true);

    // Back renders the unsorted rows and leaves the table's view sorted.
    locate("");
    await rerenderWith({
      data: rowsOf(PAGE),
      serverPage: { rowCount: 15, load },
    });
    expect(state().loaded.hasMore).toBe(false);

    await act(async () => view().setSorting([]));
    expect(state().loaded.hasMore).toBe(true);
  });

  it("starts a fresh append for the new window after a view change interrupts one", async () => {
    const { load, calls, settle } = deferredLoad();
    const { state, rerenderWith } = await renderWindow(urlTable(load, 15));
    await appendPage(state, () => calls[0], settle, 15);
    const third = await begin(() => state().loadMore());
    expect(calls[1]?.page).toBe(3);

    await sortByGenre();
    locate(SORTED_BY_GENRE);
    await rerenderWith({
      data: renamed(rowsOf(PAGE), "Sorted"),
      serverPage: { rowCount: 15, load },
    });

    // The sentinel is still visible under the new window and calls loadMore
    // again while the dropped page is in flight; it must not get back that
    // page's promise, which settles without loading anything and would leave
    // paging stuck.
    const fourth = await begin(() => state().loadMore());
    expect(fourth.promise).not.toBe(third.promise);
    expect(calls[2]?.page).toBe(2);

    await settle(calls[1], pageResult(rowsOf(PAGE, 2 * PAGE + 1), 15));
    await third.promise;
    await settle(calls[2], pageResult(rowsOf(PAGE, PAGE + 1), 15));
    await fourth.promise;

    expect(state().loaded).toEqual({
      count: 2 * PAGE,
      hasMore: true,
      state: "idle",
    });
  });

  it("fetches page 1 of an embedded table's new view", async () => {
    const { load, calls, settle } = deferredLoad();
    const { container, state } = await renderWindow(embeddedTable(load));

    await sortByGenre();

    expect(calls.map(({ page }) => page)).toEqual([1]);
    expect(calls[0]?.view.sort).toBeDefined();

    const sorted = rowsOf(PAGE, 21);
    await settle(calls[0], pageResult(sorted, 9));

    expect(titles(container).toSorted()).toEqual(titlesOf(sorted).toSorted());
    expect(state().loaded).toEqual({
      count: PAGE,
      hasMore: true,
      state: "idle",
    });
  });

  it("does not page an embedded table's mount rows when its new view's refetch fails", async () => {
    const { load, calls, settle } = deferredLoad();
    const { state } = await renderWindow(embeddedTable(load));

    await sortByGenre();
    await settle(calls[0]);

    expect(toastError).toHaveBeenCalledWith("Couldn't refresh the table");
    expect(state().loaded.hasMore).toBe(false);
    await (
      await begin(() => state().loadMore())
    ).promise;
    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe("DataTable loaded window: a table without serverPage", () => {
  it("renders every row of a 60-row table and has nothing more to load", async () => {
    const { container, state } = await renderWindow({ data: rowsOf(60) });

    expect(titles(container)).toHaveLength(60);
    expect(footer().textContent).toBe("60 rows");
    expect(state().loaded).toEqual({
      count: 60,
      hasMore: false,
      state: "idle",
    });

    const last = await begin(() => state().ensureLoaded(59));
    expect(await last.promise).toBe(true);
    const past = await begin(() => state().ensureLoaded(60));
    expect(await past.promise).toBe(false);
  });

  it("uses the singular for one row", async () => {
    await renderWindow({ data: rowsOf(1) });

    expect(footer().textContent).toBe("1 row");
  });
});

describe("DataTable footer while grouped", () => {
  const grouped: Partial<TestDataTableProps<Row>> = {
    persistStateInUrl: true,
    groupByOptions: [{ id: "genre", label: "Genre" }],
    getRowGroupKey: (row) => row.genre,
    serverGroups: [
      { key: "Rock", label: "Rock", count: 30 },
      { key: "Pop", label: "Pop", count: 30 },
    ],
  };

  it("counts plain rows when no group is active", async () => {
    locate("");
    await renderWindow({ ...grouped, data: rowsOf(60) });

    expect(footer().textContent).toBe("60 rows");
  });

  it("counts the groups when a grouping is active", async () => {
    locate("?group=genre");
    await renderWindow({ ...grouped, data: rowsOf(60) });

    expect(footer().textContent).toBe("60 rows in 2 groups");
  });

  // A grouped page is each group's preview, and the server answers every page
  // with the same preview, so there is never a next page to fetch.
  it("has nothing more to load while grouped, whatever the server's count", async () => {
    const { load } = deferredLoad();
    locate("?group=genre");
    const { state } = await renderWindow({
      ...grouped,
      data: rowsOf(PAGE),
      serverPage: { rowCount: 60, load },
    });

    expect(state().loaded.hasMore).toBe(false);
    await (
      await begin(() => state().loadMore())
    ).promise;
    const reached = await begin(() => state().ensureLoaded(PAGE + 1));
    expect(await reached.promise).toBe(false);
    expect(load).not.toHaveBeenCalled();
  });

  // The server pages normally for a group key it does not know, so the
  // window must too.
  it("still pages for a ?group= the table does not offer", async () => {
    const { load } = deferredLoad();
    locate("?group=unknown");
    const { state } = await renderWindow({
      ...grouped,
      data: rowsOf(PAGE),
      serverPage: { rowCount: 60, load },
    });

    expect(state().loaded.hasMore).toBe(true);
  });

  // The grouping toggle flips `grouped` to false on the same render that
  // clears it, before the server's ungrouped rows have replaced the data
  // prop: the window still holds the grouped preview, now under the
  // ungrouped viewKey.
  it("refuses to page a grouped preview left under the view once grouping turns off", async () => {
    const { load } = deferredLoad();
    const { ViewProbe, view } = viewProbe();

    locate("?group=genre");
    const { state } = await renderWindow({
      ...grouped,
      data: rowsOf(PAGE),
      serverPage: { rowCount: 60, load },
      children: <ViewProbe />,
    });
    expect(state().loaded.hasMore).toBe(false);

    await act(async () => view().setGrouping([]));

    expect(state().loaded.hasMore).toBe(false);
    await (
      await begin(() => state().loadMore())
    ).promise;
    expect(load).not.toHaveBeenCalled();
  });
});

describe("DataTable row cursor: a local filter shorter than the loaded window", () => {
  // PAGE is 5, alternating Rock/Pop by position: rows 1, 3, 5 are Rock and
  // rows 2, 4 are Pop, so filtering the loaded window to "Pop" leaves 2 of
  // its 5 rows visible — the shape the root's `ensureLoaded` must page past
  // rather than trust the window's own length for.
  it("keeps the cursor put rather than stranding it on a row a later, unrelated load can land it on", async () => {
    const { load, calls, settle } = deferredLoad();
    const { container, state } = await renderWindow(embeddedTable(load, 10));

    fireEvent.change(screen.getAllByLabelText("Search the table")[0]!, {
      target: { value: "Pop" },
    });
    await act(async () => {});
    expect(titles(container)).toEqual(["Track 2", "Track 4"]);

    // Onto the last visible row.
    pressHotkey("j");
    pressHotkey("j");
    expect(state().cursorRowId).toBe("4");

    // One more: nothing in the loaded 5-row window satisfies the filter past
    // here, but the window's own `hasMore` is still true, so this must load
    // rather than take the window's length for the row model's. `ensureLoaded`
    // awaits its own "loading" state committing before it calls `load`, so the
    // press needs a flush past that commit, not just the sync `act` a press is.
    await act(async () => {
      pressHotkey("j");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(calls[0]?.page).toBe(2);

    // The next page holds no row that matches the filter either, and it is
    // the server's last one: once it lands there is truly nothing left, and
    // the move must give up rather than wait on a row that will never come.
    await settle(
      calls[0],
      pageResult(
        rowsOf(PAGE, PAGE + 1).map((row) => ({ ...row, genre: "Rock" })),
        10
      )
    );

    expect(load).toHaveBeenCalledTimes(1);
    expect(state().cursorRowId).toBe("4");
    expect(titles(container)).toEqual(["Track 2", "Track 4"]);

    // Nothing was left pending to fire later: a further, unrelated append
    // (a scroll sentinel, say) that does bring in a matching row must not
    // yank the cursor onto it on its own.
    expect(state().loaded.hasMore).toBe(false);
  });
});
