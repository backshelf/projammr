import { act, fireEvent, screen, within } from "@testing-library/react";
import { customField } from "@/fields/custom-field-fixture";
import { describe, expect, it, mock } from "bun:test";

import { press, renderGrid, type Row } from "./test-support";

const { createAppColumnHelper } = await import("./data-table-hook");
const { customFieldColumns, CUSTOM_FIELDS_GROUP } =
  await import("./custom-field-columns");
const { customFieldCells, customFieldKeys } =
  await import("./custom-field-parts");

type FieldRow = Row & { fields: Record<string, string | number | boolean> };

const field = customField;

const FIELDS = [
  field(4, "Cleared", "checkbox"),
  field(6, "Notes", "text"),
  field(1, "Mood", "select", [
    { id: "a1", label: "Dark" },
    { id: "b2", label: "Mellow" },
  ]),
];

const helper = createAppColumnHelper<FieldRow>();
const COLUMNS = helper.columns([
  helper.accessor((row) => row.title, { id: "title", header: "Title" }),
  ...customFieldColumns(helper, FIELDS),
]);

const DATA: FieldRow[] = [
  {
    id: 10,
    title: "One",
    statusId: null,
    genre: "Rock",
    mastered: false,
    notes: "",
    fields: { cf_4: true, cf_6: "vocal comp", cf_1: "gone9" },
  },
  {
    id: 11,
    title: "Two",
    statusId: null,
    genre: "Pop",
    mastered: false,
    notes: "",
    fields: {},
  },
];

function renderFields(onCellSave = mock(async () => true)) {
  const result = renderGrid(undefined, undefined, {
    data: DATA as Row[],
    columns: COLUMNS as never,
    editableCells: customFieldCells(FIELDS),
    onCellSave,
  });
  return { ...result, onCellSave };
}

describe("a custom field column", () => {
  it("is keyed cf_<id>, headed by the field's name and listed under Fields", () => {
    const [cleared] = customFieldColumns(helper, FIELDS);
    expect(cleared?.id).toBe("cf_4");
    expect(cleared?.header).toBe("Cleared");
    expect(cleared?.meta?.group).toBe(CUSTOM_FIELDS_GROUP);
    expect(customFieldKeys(FIELDS)).toEqual(["cf_4", "cf_6", "cf_1"]);
  });

  it("draws a value from the row's fields bag, and a dash for an unset one", () => {
    const { cell } = renderFields();
    expect(cell("10::cf_6").textContent).toContain("vocal comp");
    expect(cell("11::cf_6").textContent).toContain("—");
  });

  it("shows a select value whose option was removed as its raw id", () => {
    const { cell } = renderFields();
    expect(cell("10::cf_1").textContent).toContain("gone9");
  });

  it("is listed under Fields in the column menu, after the table's own columns", async () => {
    renderFields();
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: /Columns/ })[0]!);
    });
    const group = screen.getByRole("group", { name: CUSTOM_FIELDS_GROUP });
    expect(within(group).getByText("Cleared")).toBeTruthy();
    expect(within(group).queryByText("Title")).toBeNull();
    expect(
      within(group).getByRole("button", { name: "Move Cleared up" })
    ).toHaveProperty("disabled", true);
  });
});

describe("a custom checkbox cell", () => {
  const control = (element: HTMLElement) => {
    const found = element.querySelector<HTMLElement>("[data-cell-control]");
    if (!found) throw new Error("no cell control");
    return found;
  };

  it("flips the value the bag holds: a ticked box saves false", () => {
    const { cell, onCellSave } = renderFields();
    press(control(cell("10::cf_4")));
    expect(onCellSave).toHaveBeenCalledWith(10, "cf_4", false);
  });

  it("ticks an unset box", () => {
    const { cell, onCellSave } = renderFields();
    press(control(cell("11::cf_4")));
    expect(onCellSave).toHaveBeenCalledWith(11, "cf_4", true);
  });

  it("names its control by the field, not its key", () => {
    const { cell } = renderFields();
    expect(control(cell("10::cf_4")).textContent).toContain("Toggle Cleared");
  });
});

describe("the bulk bar's Set field…", () => {
  it("patches the selection's fields bag in one call", async () => {
    const onBulkPatch = mock(async () => ({ ok: true, count: 2 }));
    renderGrid(undefined, undefined, {
      data: DATA as Row[],
      columns: COLUMNS as never,
      editableCells: customFieldCells(FIELDS),
      enableSelection: true,
      bulkFields: FIELDS,
      onBulkPatch,
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("checkbox", { name: "Select all loaded rows" })
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Set field…" }));
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Apply to selection" })
      );
    });

    // The first field is Cleared, a box: unticked, every row takes false.
    expect(onBulkPatch).toHaveBeenCalledWith(
      { ids: [10, 11] },
      { fields: { cf_4: false } }
    );
  });
});

describe("a custom field's optimistic save", () => {
  /** Opens the text editor on `key`, types `value` and commits it. */
  async function edit(
    cell: (key: string) => HTMLElement,
    key: string,
    value: string
  ) {
    press(cell(key));
    fireEvent.keyDown(cell(key), { key: "Enter" });
    const input = cell(key).querySelector("input");
    if (!input) throw new Error("no editor");
    fireEvent.change(input, { target: { value } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
  }

  // The harness never refetches, so what a cell shows once its save has
  // settled is the row as the table patched it.
  it("writes the new value into the row's bag", async () => {
    const { cell, onCellSave } = renderFields();

    await edit(cell, "11::cf_6", "needs a master");

    expect(onCellSave).toHaveBeenCalledWith(11, "cf_6", "needs a master");
    expect(cell("11::cf_6").textContent).toContain("needs a master");
  });

  it("drops the key from the bag when the value is cleared", async () => {
    const { cell, onCellSave } = renderFields();

    await edit(cell, "10::cf_6", "");

    expect(onCellSave).toHaveBeenCalledWith(10, "cf_6", null);
    expect(cell("10::cf_6").textContent).toContain("—");
  });

  it("rolls the bag back when the save fails", async () => {
    const { cell } = renderFields(mock(async () => false));

    await edit(cell, "10::cf_6", "rejected");
    const input = cell("10::cf_6").querySelector("input");
    if (!input) throw new Error("no editor");
    await act(async () => {
      fireEvent.keyDown(input, { key: "Escape" });
    });

    expect(cell("10::cf_6").textContent).toContain("vocal comp");
  });
});
