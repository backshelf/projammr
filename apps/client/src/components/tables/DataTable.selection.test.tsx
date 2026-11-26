import type { BulkSelection } from "@/entities/api";
import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import type { Label } from "@workspace/api/api";
import { DATA, mixing, renderGrid } from "./test-support";

// Selection, the bulk bar and "select all N matching". The selection lives in
// the table root and is written by the checkbox column, the bar's handlers and
// a bulk action's outcome, so what each of them does to it is pinned here.

const ROW_CHECKBOX = "Select row";
const LOADED_CHECKBOX = "Select all loaded rows";

const clientFav: Label = {
  id: 3,
  name: "Client Fav",
  // eslint-disable-next-line no-restricted-syntax -- a label's own colourHex, not a class name
  colourHex: "#94A3B8",
  projectId: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

type BulkPatch = (
  selection: BulkSelection,
  patch: Record<string, unknown>
) => Promise<{ ok: boolean; count?: number }>;

type BulkSetLabels = (
  selection: BulkSelection,
  labels: { add: number[]; remove: number[] }
) => Promise<{ ok: boolean; count?: number }>;

const okPatch = () => mock<BulkPatch>(async () => ({ ok: true, count: 2 }));
const okSetLabels = () =>
  mock<BulkSetLabels>(async () => ({ ok: true, count: 2 }));

/** A server-paged table whose page holds `DATA` and whose filter matches five rows. */
const serverPaged = (
  overrides: Parameters<typeof renderGrid>[2] = {}
): Parameters<typeof renderGrid>[2] => ({
  enableSelection: true,
  bulkStatuses: [mixing],
  persistStateInUrl: true,
  serverPage: {
    rowCount: 5,
    load: () => Promise.reject(new Error("not wired")),
  },
  ...overrides,
});

const rowCheckboxes = () => screen.getAllByLabelText(ROW_CHECKBOX);
const bar = () => screen.queryByLabelText("Clear selection");
// The bar's own count, not the status region that announces the same words.
const barCount = (text: string) =>
  screen.getByText(text, { ignore: "script, style, [role=status]" });
const announced = () => screen.getByRole("status").textContent;

// Radix opens a trigger on pointerdown or a key; happy-dom's pointer event
// does not carry the button it checks, so the key is what opens it here. The
// chip renders the name in capitals, hence the case-insensitive match.
async function chooseStatus() {
  const name = new RegExp(mixing.name, "i");
  const trigger = screen.getByRole("button", { name: "Set status" });
  await act(async () => {
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
  });
  await act(async () => {
    fireEvent.click(await screen.findByRole("menuitem", { name }));
  });
}

/** Opens the bar's Labels menu, its "Add label…" sub-menu, and picks `label`. */
async function chooseAddLabel(label: Label) {
  const trigger = screen.getByRole("button", { name: "Labels" });
  await act(async () => {
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
  });
  await act(async () => {
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Add label…" })
    );
  });
  await act(async () => {
    fireEvent.click(await screen.findByRole("menuitem", { name: label.name }));
  });
}

// The table reads its filters from the address bar, and happy-dom's document
// starts on `about:blank`, where `history.replaceState` changes nothing.
const setUrl = (url: string) =>
  (
    window as unknown as { happyDOM: { setURL: (url: string) => void } }
  ).happyDOM.setURL(url);

// The bar leaves through an exit animation the harness does not run to the
// end, so it stays in the DOM after the selection empties. A fresh tick reads
// "1 row selected" only when nothing stale is left behind it.
function expectSelectionEmpty() {
  for (const box of rowCheckboxes()) {
    expect((box as HTMLInputElement).checked).toBe(false);
  }
  fireEvent.click(rowCheckboxes()[0]!);
  expect(barCount("1 row selected")).toBeDefined();
}

afterEach(() => {
  setUrl("about:blank");
});

describe("DataTable selection", () => {
  it("shows the bar with a count of one when a row checkbox is ticked", () => {
    renderGrid(undefined, undefined, { enableSelection: true });
    expect(bar()).toBeNull();

    fireEvent.click(rowCheckboxes()[0]!);

    expect(barCount("1 row selected")).toBeDefined();
  });

  it("selects every row on the page from the header checkbox", () => {
    renderGrid(undefined, undefined, { enableSelection: true });

    fireEvent.click(screen.getByLabelText(LOADED_CHECKBOX));

    expect(barCount("2 rows selected")).toBeDefined();
    for (const box of rowCheckboxes()) {
      expect((box as HTMLInputElement).checked).toBe(true);
    }
  });

  it("announces the count from a region that outlives the bar", () => {
    renderGrid(undefined, undefined, { enableSelection: true });
    expect(announced()).toBe("");

    fireEvent.click(rowCheckboxes()[0]!);
    expect(announced()).toBe("1 row selected");

    fireEvent.click(screen.getByLabelText(LOADED_CHECKBOX));
    expect(announced()).toBe("2 rows selected");
  });

  it("empties the selection on clear", () => {
    renderGrid(undefined, undefined, { enableSelection: true });
    fireEvent.click(screen.getByLabelText(LOADED_CHECKBOX));

    fireEvent.click(screen.getByLabelText("Clear selection"));

    expectSelectionEmpty();
  });

  it("calls onBulkPatch with the ticked ids for a bulk status change", async () => {
    const onBulkPatch = okPatch();
    renderGrid(undefined, undefined, {
      enableSelection: true,
      bulkStatuses: [mixing],
      onBulkPatch,
    });
    fireEvent.click(rowCheckboxes()[1]!);

    await chooseStatus();

    const selection: BulkSelection = { ids: [DATA[1]!.id] };
    expect(onBulkPatch).toHaveBeenCalledTimes(1);
    expect(onBulkPatch).toHaveBeenCalledWith(selection, { statusId: 2 });
  });

  it("clears the selection once a bulk status change succeeds", async () => {
    renderGrid(undefined, undefined, {
      enableSelection: true,
      bulkStatuses: [mixing],
      onBulkPatch: okPatch(),
    });
    fireEvent.click(screen.getByLabelText(LOADED_CHECKBOX));

    await chooseStatus();
    await act(async () => {});

    expectSelectionEmpty();
  });

  it("keeps the selection and the bar when a bulk status change fails", async () => {
    const onBulkPatch = mock<BulkPatch>(async () => ({ ok: false }));
    renderGrid(undefined, undefined, {
      enableSelection: true,
      bulkStatuses: [mixing],
      onBulkPatch,
    });
    fireEvent.click(rowCheckboxes()[0]!);

    await chooseStatus();
    await act(async () => {});

    expect(onBulkPatch).toHaveBeenCalledTimes(1);
    expect(barCount("1 row selected")).toBeDefined();
    expect((rowCheckboxes()[0] as HTMLInputElement).checked).toBe(true);
  });

  it("gives a viewer no checkbox column and no bar", () => {
    renderGrid("viewer", undefined, {
      enableSelection: true,
      bulkStatuses: [mixing],
      onBulkPatch: okPatch(),
    });

    expect(screen.queryByLabelText(ROW_CHECKBOX)).toBeNull();
    expect(screen.queryByLabelText(LOADED_CHECKBOX)).toBeNull();
    expect(bar()).toBeNull();
  });

  it("gives an editor the checkbox column", () => {
    renderGrid("editor", undefined, { enableSelection: true });

    expect(rowCheckboxes()).toHaveLength(DATA.length);
  });
});

describe("DataTable select all matching", () => {
  it("offers all N only once the whole page is selected", () => {
    renderGrid(undefined, undefined, serverPaged());

    fireEvent.click(rowCheckboxes()[0]!);
    expect(screen.queryByText("Select all matching")).toBeNull();

    fireEvent.click(screen.getByLabelText(LOADED_CHECKBOX));
    expect(screen.getByText("Select all matching")).toBeDefined();
  });

  it("shows N as the count once all matching is chosen and hides the offer", () => {
    renderGrid(undefined, undefined, serverPaged());
    fireEvent.click(screen.getByLabelText(LOADED_CHECKBOX));

    fireEvent.click(screen.getByText("Select all matching"));

    expect(barCount("5 rows selected")).toBeDefined();
    expect(screen.queryByText("Select all matching")).toBeNull();
  });

  it("calls onBulkPatch with the all-matching form and the current filter params", async () => {
    setUrl("http://localhost/?q=demo");
    const onBulkPatch = okPatch();
    renderGrid(undefined, undefined, serverPaged({ onBulkPatch }));
    fireEvent.click(screen.getByLabelText(LOADED_CHECKBOX));
    fireEvent.click(screen.getByText("Select all matching"));

    await chooseStatus();

    const selection: BulkSelection = { all: true, q: "demo" };
    expect(onBulkPatch).toHaveBeenCalledTimes(1);
    expect(onBulkPatch).toHaveBeenCalledWith(selection, { statusId: 2 });
  });

  it("clears all matching once the bulk status change succeeds", async () => {
    renderGrid(undefined, undefined, serverPaged({ onBulkPatch: okPatch() }));
    fireEvent.click(screen.getByLabelText(LOADED_CHECKBOX));
    fireEvent.click(screen.getByText("Select all matching"));

    await chooseStatus();
    await act(async () => {});

    expectSelectionEmpty();
  });

  it("keeps all matching chosen when the bulk status change fails", async () => {
    renderGrid(
      undefined,
      undefined,
      serverPaged({ onBulkPatch: mock<BulkPatch>(async () => ({ ok: false })) })
    );
    fireEvent.click(screen.getByLabelText(LOADED_CHECKBOX));
    fireEvent.click(screen.getByText("Select all matching"));

    await chooseStatus();
    await act(async () => {});

    expect(barCount("5 rows selected")).toBeDefined();
  });

  it("never offers all N when serverPage.selectAllMatching is false", () => {
    renderGrid(
      undefined,
      undefined,
      serverPaged({
        serverPage: {
          rowCount: 5,
          selectAllMatching: false,
          load: () => Promise.reject(new Error("not wired")),
        },
      })
    );

    fireEvent.click(screen.getByLabelText(LOADED_CHECKBOX));

    expect(barCount("2 rows selected")).toBeDefined();
    expect(screen.queryByText("Select all matching")).toBeNull();
  });

  it("never offers all N when the page already holds every match", () => {
    renderGrid(
      undefined,
      undefined,
      serverPaged({
        serverPage: {
          rowCount: 2,
          load: () => Promise.reject(new Error("not wired")),
        },
      })
    );

    fireEvent.click(screen.getByLabelText(LOADED_CHECKBOX));

    expect(screen.queryByText("Select all matching")).toBeNull();
  });

  it("never offers all N to a table that filters locally", () => {
    // An embedded table: the server holds more rows than are loaded, but the
    // view is filtered in React, so there are no filter params to send.
    renderGrid(undefined, undefined, serverPaged({ persistStateInUrl: false }));

    fireEvent.click(screen.getByLabelText(LOADED_CHECKBOX));

    expect(barCount("2 rows selected")).toBeDefined();
    expect(screen.queryByText("Select all matching")).toBeNull();
  });

  it("drops back to ids when a checkbox changes after choosing all N", async () => {
    const onBulkPatch = okPatch();
    renderGrid(undefined, undefined, serverPaged({ onBulkPatch }));
    fireEvent.click(screen.getByLabelText(LOADED_CHECKBOX));
    fireEvent.click(screen.getByText("Select all matching"));
    expect(barCount("5 rows selected")).toBeDefined();

    fireEvent.click(rowCheckboxes()[0]!);

    expect(barCount("1 row selected")).toBeDefined();

    await chooseStatus();
    const selection: BulkSelection = { ids: [DATA[1]!.id] };
    expect(onBulkPatch).toHaveBeenCalledWith(selection, { statusId: 2 });
  });

  it("calls onBulkSetLabels with the all-matching form when adding a label", async () => {
    setUrl("http://localhost/?q=demo");
    const onBulkSetLabels = okSetLabels();
    renderGrid(
      undefined,
      undefined,
      serverPaged({ bulkLabels: [clientFav], onBulkSetLabels })
    );
    fireEvent.click(screen.getByLabelText(LOADED_CHECKBOX));
    fireEvent.click(screen.getByText("Select all matching"));

    await chooseAddLabel(clientFav);

    const selection: BulkSelection = { all: true, q: "demo" };
    expect(onBulkSetLabels).toHaveBeenCalledTimes(1);
    expect(onBulkSetLabels).toHaveBeenCalledWith(selection, {
      add: [clientFav.id],
      remove: [],
    });
  });
});
