import type { DataTableProps } from "@/components/tables/generic-table-types";
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
import { stubGlobal } from "@workspace/test/globals";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { useRef, type ReactNode } from "react";

// The card list is the phone's presentation of the same rows: the root picks
// it over the grid, and the `Cards` part builds the cards, sections, selection
// and expansion wiring. `test-support` restores the globals stubbed here.

const peek = {
  toPeekRow: (row: Row) => ({ id: row.id, title: row.title }),
  href: (row: Row) => `/track/${row.id}`,
  titleField: "title",
};

type Kid = { id: number; title: string };
const KIDS: Record<number, Kid[]> = {
  10: [
    { id: 101, title: "One (demo)" },
    { id: 102, title: "One (radio edit)" },
  ],
};

// The table types its child rows as `never` unless a suite names them, so the
// hierarchy reaches it through the one cast that hands over the child type.
const hierarchy: Pick<DataTableProps<Row>, "cards" | "subRows"> = {
  cards: {
    childCard: (child: Kid) => ({ id: child.id, title: child.title }),
  },
  subRows: {
    getRows: (row) => KIDS[row.id] as never[] | undefined,
    cells: {},
  },
};

/**
 * `useIsMobile` reads `window.matchMedia` to subscribe and `innerWidth` for its
 * answer, and the test DOM provides the first of them not at all.
 */
function stubViewport(phone: boolean) {
  stubGlobal("innerWidth", phone ? 400 : 1024);
  stubGlobal("matchMedia", () => ({
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

/** The server snapshot is desktop, so the list appears a tick after mount. */
async function renderCards(overrides: Parameters<typeof renderGrid>[2] = {}) {
  stubViewport(true);
  const result = renderGrid(undefined, undefined, {
    peek,
    cards: {},
    ...overrides,
  });
  await screen.findAllByRole("list");
  return result;
}

// happy-dom starts on about:blank, where the table's URL state never sees a
// query, so the location is set through the window's own controller.
type HappyWindow = { happyDOM: { setURL(url: string): void } };
const happyDOM = (window as unknown as HappyWindow).happyDOM;
const START_URL = window.location.href;

const rowItems = () => screen.getAllByRole("listitem");

describe("Cards", () => {
  it("replaces the grid with the card list on the phone tier", async () => {
    const { container } = await renderCards();

    expect(screen.queryByRole("grid")).toBeNull();
    expect(rowItems().map((item) => item.textContent)).toEqual(["One", "Two"]);
    expect(container.querySelector("[data-cell]")).toBeNull();
  });

  it("links a card to its row's page", async () => {
    await renderCards();

    expect(screen.getByRole("link", { name: "Two" }).getAttribute("href")).toBe(
      "/track/11"
    );
  });

  it("drops Open from a card's action sheet and keeps the page and Rename", async () => {
    await renderCards({
      rowActions: { label: (row) => row.title },
      onCellSave: async () => true,
    });

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Actions for row One" })
      );
    });

    expect(
      await screen.findByRole("button", { name: "Open page" })
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Rename" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open" })).toBeNull();
  });

  it("expands a card with children to show them, and collapses it again", async () => {
    await renderCards(hierarchy);

    expect(screen.queryByText("One (demo)")).toBeNull();
    expect(screen.queryByRole("button", { name: /Expand row Two/ })).toBeNull();

    const expand = screen.getByRole("button", { name: "Expand row One" });
    await act(async () => {
      fireEvent.click(expand);
    });

    expect(screen.getByText("One (demo)")).toBeTruthy();
    expect(screen.getByText("One (radio edit)")).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Collapse row One" }));
    });

    expect(screen.queryByText("One (demo)")).toBeNull();
  });

  describe("grouped", () => {
    afterEach(() => happyDOM.setURL(START_URL));

    const grouped = {
      persistStateInUrl: true,
      groupByOptions: [{ id: "genre", label: "Genre", filterParam: "genre" }],
      getRowGroupKey: (row: Row) => row.genre,
      serverGroups: [
        { key: "Rock", label: "Rock", count: 30 },
        { key: "Pop", label: "Pop", count: 1 },
      ],
    };

    it("draws a headed section per group, with Show all only where the page holds part of it", async () => {
      happyDOM.setURL("http://localhost/project/1/tracks?group=genre");
      await renderCards(grouped);

      expect(
        screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)
      ).toEqual(["Rock30Show all 30 →", "Pop1"]);
      expect(screen.getByRole("list", { name: "Rock" }).textContent).toBe(
        "One"
      );
      expect(screen.getByRole("list", { name: "Pop" }).textContent).toBe("Two");
    });

    it("drops the grouping when Show all narrows to a group", async () => {
      happyDOM.setURL("http://localhost/project/1/tracks?group=genre");
      await renderCards(grouped);

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Show all 30 →" }));
      });

      expect(screen.queryByRole("heading", { level: 3 })).toBeNull();
      expect(rowItems()).toHaveLength(2);
    });
  });

  describe("select mode", () => {
    // The phone toolbar's Filter sheet is the only way in, so the tests go
    // through it.
    async function enterSelectMode() {
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Filter" }));
      });
      await act(async () => {
        fireEvent.click(
          await screen.findByRole("switch", { name: /Select rows/ })
        );
      });
    }

    const checkbox = (title: string) =>
      screen.getByRole<HTMLInputElement>("checkbox", {
        name: `Select row ${title}`,
      });

    it("selects cards instead of opening them, and Done leaves the mode", async () => {
      await renderCards({ enableSelection: true });

      expect(screen.queryByRole("checkbox")).toBeNull();
      await enterSelectMode();

      expect(screen.queryByRole("link", { name: "One" })).toBeNull();
      await act(async () => {
        fireEvent.click(checkbox("One"));
      });
      expect(checkbox("One").checked).toBe(true);
      expect(checkbox("Two").checked).toBe(false);
      expect(screen.getByLabelText("Clear selection")).toBeTruthy();

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Done" }));
      });

      // The bar leaves through an exit animation the harness does not run to
      // the end, so the checkbox going is what shows the mode is over.
      expect(screen.queryByRole("checkbox")).toBeNull();
      expect(screen.getByRole("link", { name: "One" })).toBeTruthy();
    });

    it("ticks a card from a tap on its title", async () => {
      await renderCards({ enableSelection: true });
      await enterSelectMode();

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Two" }));
      });

      expect(checkbox("Two").checked).toBe(true);
    });
  });

  it("renders no list on the desktop tier", async () => {
    stubViewport(false);
    renderGrid(undefined, undefined, { peek, cards: {} });
    await act(async () => {});

    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.getByRole("grid")).toBeTruthy();
  });

  it("renders no list on the phone tier without a peek config", async () => {
    stubViewport(true);
    renderGrid(undefined, undefined, { cards: {} });
    await act(async () => {});

    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.getByRole("grid")).toBeTruthy();
  });
});

// The virtualised window: only a screenful plus overscan mounts, the sentinel
// appends the next page at the loaded end (never while grouped), and a failed
// page shows a retry line. happy-dom does no layout, so the scroll element and
// every card need a fixed size stood in for it, or the virtualiser sees a
// zero-height world and renders either nothing or everything.
describe("Cards virtualised", () => {
  const CARD_HEIGHT = 56;
  // Stands in for the toolbar and select-mode bar above the list, so
  // `scrollMargin` is exercised at a non-zero value — happy-dom's rects are
  // all zero otherwise, which would let a `scrollMargin` sign error (see
  // below) pass silently.
  const SCROLL_MARGIN = 64;
  let restoreCardOffsetHeight: () => void;
  let restoreGetBoundingClientRect: () => void;

  beforeAll(() => {
    const proto = HTMLDivElement.prototype;
    const original = Object.getOwnPropertyDescriptor(proto, "offsetHeight");
    Object.defineProperty(proto, "offsetHeight", {
      configurable: true,
      get: () => CARD_HEIGHT,
    });
    restoreCardOffsetHeight = () => {
      if (original) Object.defineProperty(proto, "offsetHeight", original);
    };

    const rectProto = Element.prototype;
    const originalRect = rectProto.getBoundingClientRect;
    rectProto.getBoundingClientRect = function (this: Element) {
      return {
        top: SCROLL_MARGIN,
        left: 0,
        right: 0,
        bottom: SCROLL_MARGIN,
        width: 0,
        height: 0,
        x: 0,
        y: SCROLL_MARGIN,
        toJSON: () => {},
      } as DOMRect;
    };
    restoreGetBoundingClientRect = () => {
      rectProto.getBoundingClientRect = originalRect;
    };
  });
  afterAll(() => {
    restoreCardOffsetHeight();
    restoreGetBoundingClientRect();
  });
  afterEach(() => happyDOM.setURL(START_URL));

  /** Publishes a scroll root of a fixed size — happy-dom never measures a
   *  real one — so the list inside it virtualises instead of falling back to
   *  rendering every card unwindowed. Its own rect reads `top: 0` (unlike
   *  every other element, stubbed above to `SCROLL_MARGIN`), so the list's
   *  offset inside it comes out to exactly `SCROLL_MARGIN`. */
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
      Object.defineProperty(node, "getBoundingClientRect", {
        configurable: true,
        value: () => ({
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          width: 0,
          height,
          x: 0,
          y: 0,
          toJSON: () => {},
        }),
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

  it("mounts far fewer cards than a 200-row list holds", async () => {
    stubViewport(true);
    const { container } = render(
      <VirtualCanvas height={320}>
        <TestDataTable
          data={rowsOf(200)}
          columns={columns}
          persistStateInUrl={false}
          peek={peek}
          cards={{}}
        />
      </VirtualCanvas>
    );
    await screen.findAllByRole("list");

    const mounted = container.querySelectorAll("[data-index]");
    expect(mounted.length).toBeGreaterThan(0);
    expect(mounted.length).toBeLessThan(100);
  });

  it("positions the first card flush with the list, scrollMargin subtracted out", async () => {
    stubViewport(true);
    const { container } = render(
      <VirtualCanvas height={320}>
        <TestDataTable
          data={rowsOf(PAGE)}
          columns={columns}
          persistStateInUrl={false}
          peek={peek}
          cards={{}}
        />
      </VirtualCanvas>
    );
    await screen.findAllByRole("list");
    await act(async () => {});

    // `virtualItem.start` carries `SCROLL_MARGIN` baked in; a wrong sign
    // there would put the first card at `translateY(64px)` instead, with a
    // matching gap above it.
    const first = container.querySelector('[data-index="0"]');
    expect((first as HTMLElement | null)?.style.transform).toBe(
      "translateY(0px)"
    );
  });

  it("calls loadMore once when the window reaches the loaded end", async () => {
    stubViewport(true);
    const { load, calls } = deferredLoad();

    render(
      <VirtualCanvas height={500}>
        <TestDataTable
          data={rowsOf(PAGE)}
          columns={columns}
          persistStateInUrl={false}
          peek={peek}
          cards={{}}
          serverPage={{ rowCount: 20, load }}
        />
      </VirtualCanvas>
    );
    await screen.findAllByRole("list");
    await act(async () => {});

    expect(calls).toHaveLength(1);
    expect(calls[0]?.page).toBe(2);
  });

  it("calls no loadMore at the end of a grouped view", async () => {
    stubViewport(true);
    happyDOM.setURL("http://localhost/project/1/tracks?group=genre");
    const { load, calls } = deferredLoad();

    render(
      <VirtualCanvas height={500}>
        <TestDataTable
          data={rowsOf(PAGE)}
          columns={columns}
          peek={peek}
          cards={{}}
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
    await screen.findAllByRole("list");
    await act(async () => {});

    expect(calls).toHaveLength(0);
  });

  it("shows a loading strip under the window while the next page fetches", async () => {
    stubViewport(true);
    const { load } = deferredLoad();

    const { container } = render(
      <VirtualCanvas height={500}>
        <TestDataTable
          data={rowsOf(PAGE)}
          columns={columns}
          persistStateInUrl={false}
          peek={peek}
          cards={{}}
          serverPage={{ rowCount: 20, load }}
        />
      </VirtualCanvas>
    );
    await screen.findAllByRole("list");

    const skeletons = container.querySelectorAll('[data-slot="skeleton"]');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it("shows a retry line on a failed page, and refetches it on Retry", async () => {
    stubViewport(true);
    const { load, calls, settle } = deferredLoad();

    render(
      <VirtualCanvas height={500}>
        <TestDataTable
          data={rowsOf(PAGE)}
          columns={columns}
          persistStateInUrl={false}
          peek={peek}
          cards={{}}
          serverPage={{ rowCount: 20, load }}
        />
      </VirtualCanvas>
    );
    await screen.findAllByRole("list");
    await act(async () => {});

    await settle(calls[0]);

    expect(screen.getByText("Couldn't load more rows")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await act(async () => {});

    expect(calls).toHaveLength(2);
    expect(calls[1]?.page).toBe(2);
  });
});
