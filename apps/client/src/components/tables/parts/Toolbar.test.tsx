import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";

import type { DataTableProps } from "../generic-table-types";
import { renderGrid, type Row } from "../test-support";

// Both toolbar rows are always in the DOM — which of them shows is CSS — so a
// control the desktop and phone rows share is found twice.

// happy-dom starts on about:blank, where `history.replaceState` is ignored, so
// the location is set through the window's own controller.
type HappyWindow = { happyDOM: { setURL(url: string): void } };
const happyDOM = (window as unknown as HappyWindow).happyDOM;
const START_URL = window.location.href;

function locate(search = "") {
  happyDOM.setURL(`http://localhost/project/1/tracks${search}`);
}

afterEach(() => happyDOM.setURL(START_URL));

const filterColumns: NonNullable<DataTableProps<Row>["filterColumns"]> = [
  {
    id: "status",
    label: "Stage",
    param: "status",
    options: [{ value: "2", label: "Mixing" }],
  },
  {
    id: "genre",
    label: "Style",
    param: "genre",
    options: [{ value: "Rock", label: "Rock" }],
  },
];

const groupByOptions = [{ id: "genre", label: "Genre" }];

const savedViews: NonNullable<DataTableProps<Row>["savedViews"]> = {
  views: [],
  me: "user-1",
  onSave: mock(async () => true),
  onDelete: mock(async () => true),
  onShare: mock(async () => true),
  defaultViewId: null,
  onSetDefault: mock(async () => true),
  onClearDefault: mock(async () => true),
};

/** Renders a table that owns the URL, once it has adopted it. */
async function renderOwningUrl(overrides: Partial<DataTableProps<Row>>) {
  locate();
  const result = renderGrid(undefined, undefined, {
    persistStateInUrl: true,
    ...overrides,
  });
  await act(async () => {});
  return result;
}

describe("Toolbar search", () => {
  it("filters a local table's rows as the search box is typed in", () => {
    renderGrid();
    expect(screen.getByText("One")).toBeTruthy();
    expect(screen.getByText("Two")).toBeTruthy();

    const [search] = screen.getAllByLabelText("Search the table");
    fireEvent.change(search!, { target: { value: "Two" } });

    expect(screen.queryByText("One")).toBeNull();
    expect(screen.getByText("Two")).toBeTruthy();
  });

  it("keeps the desktop and phone search boxes on the same text", () => {
    renderGrid();

    const [desktop, phone] = screen.getAllByLabelText("Search the table");
    fireEvent.change(desktop!, { target: { value: "Two" } });

    expect((phone as HTMLInputElement).value).toBe("Two");
  });
});

describe("Toolbar column settings", () => {
  it("removes a column's header when it is hidden in the settings menu", async () => {
    renderGrid();
    expect(screen.getByRole("columnheader", { name: /genre/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /columns/i }));
    await act(async () => {});
    fireEvent.click(screen.getByRole("checkbox", { name: /genre/i }));

    expect(screen.queryByRole("columnheader", { name: /genre/i })).toBeNull();
  });

  it("moves a column past its neighbour from the settings menu", async () => {
    renderGrid();
    const headers = () =>
      screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers().findIndex((t) => /title/i.test(t ?? ""))).toBeLessThan(
      headers().findIndex((t) => /status/i.test(t ?? ""))
    );

    fireEvent.click(screen.getByRole("button", { name: /columns/i }));
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: /move title down/i }));

    expect(headers().findIndex((t) => /title/i.test(t ?? ""))).toBeGreaterThan(
      headers().findIndex((t) => /status/i.test(t ?? ""))
    );
  });
});

describe("a table that does not own the URL", () => {
  it("offers no filter, group-by or views menu", () => {
    renderGrid(undefined, undefined, {
      persistStateInUrl: false,
      filterColumns,
      groupByOptions,
      savedViews,
    });

    expect(screen.queryByRole("button", { name: /stage/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /style/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /group by/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /views/i })).toBeNull();
    expect(screen.getByRole("button", { name: /columns/i })).toBeTruthy();
  });

  it("does not count a column filter that is not its own to show", () => {
    renderGrid(undefined, undefined, {
      persistStateInUrl: false,
      filterColumns,
    });

    expect(screen.getByRole("button", { name: "Filter" })).toBeTruthy();
  });
});

describe("a table that owns the URL", () => {
  it("offers a filter menu for each filter column", async () => {
    await renderOwningUrl({ filterColumns });

    expect(screen.getByRole("button", { name: /stage/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /style/i })).toBeTruthy();
  });

  it("offers group-by and saved views when they are configured", async () => {
    await renderOwningUrl({ groupByOptions, savedViews });

    expect(screen.getByRole("button", { name: /group by/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /views/i })).toBeTruthy();
  });

  it("offers neither when none is configured", async () => {
    await renderOwningUrl({});

    expect(screen.queryByRole("button", { name: /group by/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /views/i })).toBeNull();
  });

  it("counts the active column filters on the phone's Filter button", async () => {
    locate("?status=2");
    renderGrid(undefined, undefined, {
      persistStateInUrl: true,
      filterColumns,
    });
    await act(async () => {});

    expect(
      screen.getByRole("button", { name: "Filter (1 active)" })
    ).toBeTruthy();
  });

  it("offers no reset view button when it does not own the URL", () => {
    renderGrid(undefined, undefined, { persistStateInUrl: false });
    expect(screen.queryByText("Reset view")).toBeNull();
  });

  it("clears the search filter when Reset view is clicked", async () => {
    locate("?q=demo");
    renderGrid(undefined, undefined, { persistStateInUrl: true });
    await act(async () => {});
    const [search] = screen.getAllByLabelText("Search the table");
    expect((search as HTMLInputElement).value).toBe("demo");

    fireEvent.click(screen.getByText("Reset view"));
    await act(async () => {});

    expect((search as HTMLInputElement).value).toBe("");
  });
});
