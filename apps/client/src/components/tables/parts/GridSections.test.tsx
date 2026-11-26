import type { NewRowConfig } from "@/components/tables/DraftRow";
import {
  columns,
  deferredLoad,
  renderGrid,
  rowsOf,
  TestDataTable,
  type Row,
} from "@/components/tables/test-support";
import { CanvasRootProvider } from "@workspace/ui/components/layout/scroll-root";
import { act, fireEvent, render, screen } from "@testing-library/react";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  mock,
} from "bun:test";
import { useRef, type ReactNode } from "react";

// The grid's body is the `GridSections` part: a header per group with its
// count, drill-in and add-in-group, the rows under each, and the draft rows.
// `test-support` restores the globals and unmounts after each case.

// happy-dom starts on about:blank, where the table's URL state never sees a
// query, so the location is set through the window's own controller.
type HappyWindow = { happyDOM: { setURL(url: string): void } };
const happyDOM = (window as unknown as HappyWindow).happyDOM;
const START_URL = window.location.href;

const onCreate = mock(async () => true);

const newRow: NewRowConfig = {
  fields: { title: { type: "text" }, genre: { type: "text" } },
  onCreate,
  groupSeed: (groupParam, groupKey) =>
    groupParam === "genre" ? { field: "genre", value: groupKey } : null,
};

const grouped = {
  persistStateInUrl: true,
  entityLabel: "track",
  groupByOptions: [{ id: "genre", label: "Genre", filterParam: "genre" }],
  getRowGroupKey: (row: Row) => row.genre,
  serverGroups: [
    { key: "Rock", label: "Rock", count: 30 },
    { key: "Pop", label: "Pop", count: 1 },
  ],
};

const GROUPED_URL = "http://localhost/project/1/tracks?group=genre";

/** The grid body's section headers: the only cells that span the row. */
const headers = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("tbody td[colspan]")).map(
    (cell) => cell.textContent
  );

/** The text inputs of whatever draft rows the body holds; the rows' own checkboxes are not. */
const draftInputs = (container: HTMLElement) =>
  Array.from(
    container.querySelectorAll<HTMLInputElement>(
      'tbody input[type="text"], tbody input:not([type])'
    )
  );

afterEach(() => {
  happyDOM.setURL(START_URL);
  onCreate.mockClear();
});

describe("GridSections", () => {
  describe("grouped", () => {
    it("draws a header per group with its count, and Show all only where the page holds part of it", () => {
      happyDOM.setURL(GROUPED_URL);
      const { container } = renderGrid(undefined, undefined, grouped);

      expect(headers(container)).toEqual(["Rock30Show all 30 →", "Pop1"]);
    });

    it("draws each group's rows under its header", () => {
      happyDOM.setURL(GROUPED_URL);
      const { container } = renderGrid(undefined, undefined, grouped);

      const order = Array.from(container.querySelectorAll("tbody tr")).map(
        (tr) => (tr.querySelector("td[colspan]") ? "header" : "row")
      );
      expect(order).toEqual(["header", "row", "header", "row"]);
    });

    it("draws a row that belongs to two groups under both, with no key clash", () => {
      happyDOM.setURL(GROUPED_URL);
      const consoleError = mock<(...args: unknown[]) => void>(() => {});
      const original = console.error;
      console.error = consoleError;
      try {
        const { container } = renderGrid(undefined, undefined, {
          ...grouped,
          // The first row carries both genres, as a track with two labels does.
          getRowGroupKey: (row: Row) =>
            row.id === 10 ? ["Rock", "Pop"] : row.genre,
        });

        const order = Array.from(container.querySelectorAll("tbody tr")).map(
          (tr) => (tr.querySelector("td[colspan]") ? "header" : "row")
        );
        expect(order).toEqual(["header", "row", "header", "row", "row"]);
        expect(
          consoleError.mock.calls.some((call) =>
            String(call[0]).includes("same key")
          )
        ).toBe(false);
      } finally {
        console.error = original;
      }
    });

    it("offers no add-in-group without a newRow config", () => {
      happyDOM.setURL(GROUPED_URL);
      renderGrid(undefined, undefined, grouped);

      expect(screen.queryByRole("button", { name: /^Add to/ })).toBeNull();
    });

    it("offers a viewer no add-in-group", () => {
      happyDOM.setURL(GROUPED_URL);
      renderGrid("viewer", undefined, { ...grouped, newRow });

      expect(screen.queryByRole("button", { name: /^Add to/ })).toBeNull();
    });

    it("opens a draft seeded and locked to the group under its header", () => {
      happyDOM.setURL(GROUPED_URL);
      const { container } = renderGrid(undefined, undefined, {
        ...grouped,
        newRow,
      });

      fireEvent.click(screen.getByRole("button", { name: "Add to Pop" }));

      const seeded = draftInputs(container).find((input) => input.value);
      expect(seeded?.value).toBe("Pop");
      expect(seeded?.closest("[inert]")).not.toBeNull();
      expect(
        screen.getByRole("button", { name: "Add to Pop" }).textContent
      ).toBe("Cancel");
      expect(
        screen.getByRole("button", { name: "Add to Rock" }).textContent
      ).toBe("+ Add");
    });

    it("creates the row in the group, then closes the draft", async () => {
      happyDOM.setURL(GROUPED_URL);
      const { container } = renderGrid(undefined, undefined, {
        ...grouped,
        newRow,
      });
      fireEvent.click(screen.getByRole("button", { name: "Add to Pop" }));

      const title = draftInputs(container).find((input) => !input.value);
      fireEvent.change(title!, { target: { value: "Fresh" } });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Create row" }));
      });

      expect(onCreate).toHaveBeenCalledWith({ title: "Fresh", genre: "Pop" });
      expect(
        screen.getByRole("button", { name: "Add to Pop" }).textContent
      ).toBe("+ Add");
    });

    it("cancels an open draft from the same button", () => {
      happyDOM.setURL(GROUPED_URL);
      renderGrid(undefined, undefined, {
        ...grouped,
        newRow,
      });
      const add = screen.getByRole("button", { name: "Add to Pop" });

      fireEvent.click(add);
      fireEvent.click(add);

      expect(add.textContent).toBe("+ Add");
      expect(onCreate).not.toHaveBeenCalled();
    });

    it("keeps the toggle's ungrouped draft under the sections", () => {
      happyDOM.setURL(GROUPED_URL);
      const { container } = renderGrid(undefined, undefined, {
        ...grouped,
        newRow,
      });

      fireEvent.click(screen.getByRole("button", { name: "+ Add track" }));

      const rows = Array.from(container.querySelectorAll("tbody tr"));
      expect(rows.at(-1)?.querySelector("input")).not.toBeNull();
      expect(draftInputs(container).every((input) => !input.value)).toBe(true);
    });
  });

  describe("ungrouped", () => {
    it("draws the rows with no headers", () => {
      const { container } = renderGrid();

      expect(headers(container)).toEqual([]);
      expect(container.querySelectorAll("tbody tr")).toHaveLength(2);
    });

    it("opens the draft from the toggle and closes it again", () => {
      const { container } = renderGrid(undefined, undefined, {
        newRow,
        entityLabel: "track",
      });
      const toggle = screen.getByRole("button", { name: "+ Add track" });
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      expect(draftInputs(container)).toHaveLength(0);

      fireEvent.click(toggle);

      expect(toggle.getAttribute("aria-expanded")).toBe("true");
      expect(toggle.textContent).toBe("Cancel");
      expect(draftInputs(container)).toHaveLength(2);

      fireEvent.click(toggle);

      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      expect(toggle.textContent).toBe("+ Add track");
      expect(document.activeElement).toBe(toggle);
    });

    it("still opens the draft when the table has no rows", () => {
      const { container } = renderGrid(undefined, undefined, {
        data: [],
        newRow,
        entityLabel: "track",
      });

      fireEvent.click(screen.getByRole("button", { name: "+ Add track" }));

      expect(draftInputs(container)).toHaveLength(2);
    });

    it("shows a viewer no toggle", () => {
      renderGrid("viewer", undefined, { newRow, entityLabel: "track" });

      expect(screen.queryByRole("button", { name: "+ Add track" })).toBeNull();
    });

    it("shows no toggle without a newRow config", () => {
      renderGrid(undefined, undefined, { entityLabel: "track" });

      expect(screen.queryByRole("button", { name: "+ Add track" })).toBeNull();
    });
  });
});

describe("GridSections aria grid indices", () => {
  it("counts the header and every row, and indexes rows and cells from it", () => {
    const { container } = renderGrid(undefined, undefined, {
      data: rowsOf(3),
    });

    const grid = container.querySelector('[role="grid"]');
    expect(grid?.getAttribute("aria-rowcount")).toBe("4");
    expect(
      container.querySelector("thead tr")?.getAttribute("aria-rowindex")
    ).toBe("1");

    const bodyRows = Array.from(
      container.querySelectorAll('tbody tr[role="row"]')
    );
    expect(bodyRows.map((row) => row.getAttribute("aria-rowindex"))).toEqual([
      "2",
      "3",
      "4",
    ]);

    const firstRowCells = Array.from(
      bodyRows[0]!.querySelectorAll('[role="gridcell"]')
    );
    expect(
      firstRowCells.map((cell) => cell.getAttribute("aria-colindex"))
    ).toEqual(["1", "2", "3", "4", "5"]);
  });
});

// The virtualised window: only a screenful plus overscan mounts, a spacer
// stands in for the rest, the sentinel appends the next page at the loaded
// end (never while grouped), and a failed page shows a retry row. happy-dom
// does no layout, so the scroll element and every row need a fixed size
// stood in for it, or the virtualiser sees a zero-height world and renders
// either nothing or everything.
describe("GridSections virtualised", () => {
  const ROW_HEIGHT = 32;
  let restoreRowOffsetHeight: () => void;

  beforeAll(() => {
    const proto = HTMLTableRowElement.prototype;
    const original = Object.getOwnPropertyDescriptor(proto, "offsetHeight");
    Object.defineProperty(proto, "offsetHeight", {
      configurable: true,
      get: () => ROW_HEIGHT,
    });
    restoreRowOffsetHeight = () => {
      if (original) Object.defineProperty(proto, "offsetHeight", original);
    };
  });
  afterAll(() => restoreRowOffsetHeight());

  /** Publishes a scroll root of a fixed size — happy-dom never measures a
   *  real one — so the grid inside it virtualises instead of falling back to
   *  rendering every row unwindowed. */
  function VirtualCanvas({
    height,
    children,
  }: {
    height: number;
    children: ReactNode;
  }): ReactNode {
    const containerRef = useRef<HTMLDivElement>(null);
    const setRef = (node: HTMLDivElement | null) => {
      containerRef.current = node;
      if (!node) return;
      Object.defineProperty(node, "offsetHeight", {
        configurable: true,
        value: height,
      });
      Object.defineProperty(node, "clientHeight", {
        configurable: true,
        value: height,
      });
    };
    return (
      <CanvasRootProvider containerRef={containerRef}>
        <div ref={setRef}>{children}</div>
      </CanvasRootProvider>
    );
  }

  /** Also the seed page's length, so a small fixture already holds a whole
   *  page and the window's `hasMore` is true from the first render. */
  const PAGE = 15;

  it("mounts far fewer tr's than a 4,000-row table holds", () => {
    const { container } = render(
      <VirtualCanvas height={320}>
        <TestDataTable
          data={rowsOf(4000)}
          columns={columns}
          persistStateInUrl={false}
        />
      </VirtualCanvas>
    );

    const mounted = container.querySelectorAll("tbody tr[data-index]");
    expect(mounted.length).toBeGreaterThan(0);
    expect(mounted.length).toBeLessThan(100);
  });

  it("calls loadMore once when the window reaches the loaded end", async () => {
    const { load, calls } = deferredLoad();

    render(
      <VirtualCanvas height={500}>
        <TestDataTable
          data={rowsOf(PAGE)}
          columns={columns}
          persistStateInUrl={false}
          serverPage={{ rowCount: 20, load }}
        />
      </VirtualCanvas>
    );
    // The sentinel's `loadMore()` sets `loaded.state` to "loading"
    // synchronously but calls `serverPage.load` only after that state commits
    // one render later; nothing else in this test awaits that, so it needs
    // its own flush.
    await act(async () => {});

    expect(calls).toHaveLength(1);
    expect(calls[0]?.page).toBe(2);
  });

  it("calls no loadMore at the end of a grouped view", async () => {
    // Grouping only activates from the URL's `group` param, so this one case
    // needs the URL-owning table the rest of the suite avoids.
    happyDOM.setURL(GROUPED_URL);
    const { load, calls } = deferredLoad();

    render(
      <VirtualCanvas height={500}>
        <TestDataTable
          data={rowsOf(PAGE)}
          columns={columns}
          serverPage={{ rowCount: 20, load }}
          entityLabel="track"
          groupByOptions={[
            { id: "genre", label: "Genre", filterParam: "genre" },
          ]}
          getRowGroupKey={(row: Row) => row.genre}
          serverGroups={[
            { key: "Rock", label: "Rock", count: 8 },
            { key: "Pop", label: "Pop", count: 7 },
          ]}
        />
      </VirtualCanvas>
    );
    await act(async () => {});

    expect(calls).toHaveLength(0);
  });

  it("shows a loading strip under the window while the next page fetches", () => {
    const { load } = deferredLoad();

    const { container } = render(
      <VirtualCanvas height={500}>
        <TestDataTable
          data={rowsOf(PAGE)}
          columns={columns}
          persistStateInUrl={false}
          serverPage={{ rowCount: 20, load }}
        />
      </VirtualCanvas>
    );

    const skeletons = container.querySelectorAll(
      'tbody tr[aria-hidden] [data-slot="skeleton"]'
    );
    expect(skeletons).toHaveLength(5);
  });

  it("shows a retry row on a failed page, and refetches it on Retry", async () => {
    const { load, calls, settle } = deferredLoad();

    render(
      <VirtualCanvas height={500}>
        <TestDataTable
          data={rowsOf(PAGE)}
          columns={columns}
          persistStateInUrl={false}
          serverPage={{ rowCount: 20, load }}
        />
      </VirtualCanvas>
    );
    await act(async () => {});

    await settle(calls[0]);

    expect(screen.getByText("Couldn't load more rows")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await act(async () => {});

    expect(calls).toHaveLength(2);
    expect(calls[1]?.page).toBe(2);
  });
});
