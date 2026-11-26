import { act, fireEvent, render } from "@testing-library/react";
import { describe, expect, it, mock } from "bun:test";
import { defineCommands, GLOBAL } from "@/components/commands/define";
import { SEEDED_SCALE } from "@/fields/priority-fixture";
import type { ComponentProps } from "react";
import {
  columns,
  DATA,
  EDITABLE,
  NAVIGABLE,
  press,
  pressHotkey,
  routerMock,
  type Row,
  TestDataTable,
} from "./test-support";

// The grid's keys share combos with the table's `Enter` ("Open row") and the
// player's arrow seek. The grid wins by being the innermost push.
const seek = mock();
const SEEK = defineCommands(GLOBAL, [
  {
    id: "seek-forward",
    label: "Seek",
    group: "Playback",
    keys: ["ArrowRight"],
    run: seek,
  },
]);

function renderKeys() {
  const result = render(
    <TestDataTable
      enableSelection
      data={DATA}
      columns={columns}
      persistStateInUrl={false}
      editableCells={EDITABLE}
      navigableColumns={NAVIGABLE}
      onCellSave={mock(async () => true)}
      extraCommands={SEEK}
      peek={{
        toPeekRow: (row) => ({ id: row.id, title: row.title }),
        href: (row) => `/track/${row.id}`,
        titleField: "title",
      }}
    />
  );
  const cell = (key: string) => {
    const element = result.container.querySelector<HTMLElement>(
      `[data-cell="${key}"]`
    );
    if (!element) throw new Error(`no cell ${key}`);
    return element;
  };
  return { ...result, cell };
}

const { createDataTableHelper } =
  await import("@workspace/ui/lib/table-config");
const priorityHelper = createDataTableHelper<Row>();
const withPriority = [
  ...columns,
  priorityHelper.accessor(() => null, { id: "priority", header: "Priority" }),
];
const PRIORITY_EDITABLE = {
  ...EDITABLE,
  priority: { type: "priority" as const, priorityLevels: SEEDED_SCALE },
};

function renderRowKeys(
  overrides: Partial<ComponentProps<typeof TestDataTable<Row>>> = {}
) {
  const result = render(
    <TestDataTable
      data={DATA}
      columns={withPriority}
      persistStateInUrl={false}
      editableCells={PRIORITY_EDITABLE}
      navigableColumns={[...NAVIGABLE, "priority"]}
      onCellSave={mock(async () => true)}
      {...overrides}
    />
  );
  const cell = (key: string) => {
    const element = result.container.querySelector<HTMLElement>(
      `[data-cell="${key}"]`
    );
    if (!element) throw new Error(`no cell ${key}`);
    return element;
  };
  return { ...result, cell };
}

// A cell's own control is clicked a frame after the key, once the row is in the DOM.
const settle = () =>
  act(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  );
const statusMenu = () => document.querySelector('[role="menu"]');

describe("the table's status and priority keys", () => {
  it("opens the cursor row's status control on s", async () => {
    renderRowKeys();
    pressHotkey("j");

    pressHotkey("s");
    await settle();

    expect(statusMenu()).not.toBeNull();
  });

  it("opens the cursor row's priority editor on !", () => {
    const { cell } = renderRowKeys();
    pressHotkey("j");
    pressHotkey("j");

    pressHotkey("!");

    expect(
      cell("11::priority").querySelector("[role=combobox]")
    ).not.toBeNull();
    expect(cell("10::priority").querySelector("[role=combobox]")).toBeNull();
  });

  it("does nothing on s or ! with no cursor row", async () => {
    const { cell } = renderRowKeys();

    pressHotkey("s");
    pressHotkey("!");
    await settle();

    expect(statusMenu()).toBeNull();
    expect(cell("10::priority").querySelector("[role=combobox]")).toBeNull();
  });

  it("does nothing on s or ! while their columns are hidden", async () => {
    const { container } = renderRowKeys({
      initiallyHiddenColumns: ["status", "priority"],
    });
    pressHotkey("j");

    pressHotkey("s");
    pressHotkey("!");
    await settle();

    expect(statusMenu()).toBeNull();
    expect(container.querySelector("[role=combobox]")).toBeNull();
  });

  it("has no ! for a table whose config has no priority cell", () => {
    const { cell } = renderRowKeys({ editableCells: EDITABLE });
    pressHotkey("j");

    pressHotkey("!");

    expect(cell("10::priority").querySelector("[role=combobox]")).toBeNull();
  });
});

describe("the grid's keys against the table's and the player's", () => {
  it("opens the editor on Enter for an editable focused cell, not the row", () => {
    const { cell } = renderKeys();
    pressHotkey("j");
    press(cell("10::title"));

    fireEvent.keyDown(cell("10::title"), { key: "Enter" });

    expect(cell("10::title").querySelector("input")).not.toBeNull();
    expect(routerMock.push).not.toHaveBeenCalled();
  });

  it("still opens the editor when the pointer was already in the grid before the cell took focus", () => {
    const { cell, container } = renderKeys();
    pressHotkey("j");
    const wrapper = container
      .querySelector('[role="grid"]')
      ?.closest('[data-slot="table-container"]')?.parentElement;
    if (wrapper) fireEvent.pointerEnter(wrapper);
    press(cell("10::title"));

    fireEvent.keyDown(cell("10::title"), { key: "Enter" });

    expect(cell("10::title").querySelector("input")).not.toBeNull();
    expect(routerMock.push).not.toHaveBeenCalled();
  });

  it("moves the cell selection on ArrowRight and does not seek the player", () => {
    const { cell } = renderKeys();
    seek.mockClear();
    press(cell("10::title"));

    fireEvent.keyDown(cell("10::title"), { key: "ArrowRight" });

    expect(seek).not.toHaveBeenCalled();
    expect(cell("10::status").hasAttribute("data-selected")).toBe(true);
  });

  it("leaves ArrowRight to the player when no cell holds focus", () => {
    renderKeys();
    seek.mockClear();

    fireEvent.keyDown(document.body, { key: "ArrowRight" });

    expect(seek).toHaveBeenCalledTimes(1);
  });

  it("selects every row on mod+a while no cell holds focus", () => {
    const { getAllByLabelText } = renderKeys();
    pressHotkey("mod+a");

    const boxes = getAllByLabelText("Select row") as HTMLInputElement[];
    expect(boxes.length).toBeGreaterThan(0);
    expect(boxes.every((box) => box.checked)).toBe(true);
  });

  it("selects the cells, not the rows, on mod+a while a cell holds focus", () => {
    const { cell, getAllByLabelText } = renderKeys();
    pressHotkey("j");
    press(cell("10::title"));

    fireEvent.keyDown(cell("10::title"), { key: "a", ctrlKey: true });

    expect(cell("11::status").hasAttribute("data-selected")).toBe(true);
    const boxes = getAllByLabelText("Select row") as HTMLInputElement[];
    expect(boxes.some((box) => box.checked)).toBe(false);
  });

  it("leaves Enter on a read-only focused cell to the table's open-row", () => {
    const { cell } = renderKeys();
    pressHotkey("j");
    press(cell("10::notes"));

    fireEvent.keyDown(cell("10::notes"), { key: "Enter" });

    expect(cell("10::notes").querySelector("input")).toBeNull();
    expect(routerMock.push).toHaveBeenCalledWith("/track/10");
  });
});
