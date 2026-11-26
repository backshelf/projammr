import type { Row } from "@/components/tables/test-support";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, mock } from "bun:test";

// The panel has its own suite; this one is about the handle in the id cell.
mock.module("@/components/tables/PeekPanel", () => ({
  PeekPanel: () => null,
}));

const { DATA, renderGrid } = await import("@/components/tables/test-support");
const { idColumn } = await import("@/components/tables/columns");
const { createAppColumnHelper } =
  await import("@/components/tables/data-table-hook");

const helper = createAppColumnHelper<Row>();
const columns = helper.columns([
  idColumn(helper),
  helper.accessor((row) => row.title, { id: "title", header: "Title" }),
]);

const peek = {
  toPeekRow: (row: Row) => ({ id: row.id, title: row.title }),
  href: (row: Row) => `/track/${row.id}`,
  titleField: "title",
};

function renderIds(overrides: Parameters<typeof renderGrid>[2] = {}) {
  return renderGrid(undefined, undefined, {
    columns,
    entityLabel: "track",
    editableCells: {},
    ...overrides,
  });
}

const handle = (id: number) =>
  screen.getByRole<HTMLButtonElement>("button", { name: `Peek track ${id}` });

const press = (id: number) =>
  act(async () => {
    fireEvent.click(handle(id));
  });

describe("the id cell's peek handle", () => {
  it("is a button labelled for its row that reads collapsed until the row opens", () => {
    renderIds({ peek });

    for (const { id } of DATA) {
      expect(handle(id).getAttribute("aria-expanded")).toBe("false");
      expect(within(handle(id)).getByText(String(id))).toBeTruthy();
    }
  });

  it("opens its row and reflects it in aria-expanded, leaving the others closed", async () => {
    renderIds({ peek });

    await press(10);

    expect(handle(10).getAttribute("aria-expanded")).toBe("true");
    expect(handle(11).getAttribute("aria-expanded")).toBe("false");
  });

  it("closes the row when pressed again", async () => {
    renderIds({ peek });

    await press(10);
    await press(10);

    expect(handle(10).getAttribute("aria-expanded")).toBe("false");
  });

  it("moves to another row when that row's handle is pressed", async () => {
    renderIds({ peek });

    await press(10);
    await press(11);

    expect(handle(10).getAttribute("aria-expanded")).toBe("false");
    expect(handle(11).getAttribute("aria-expanded")).toBe("true");
  });

  it("renders the id as plain text when the table has no peek", () => {
    renderIds();

    expect(screen.queryByRole("button", { name: /^Peek track/ })).toBeNull();
    for (const { id } of DATA) {
      expect(screen.getByText(String(id))).toBeTruthy();
    }
  });
});
