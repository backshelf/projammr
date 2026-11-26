import type { MemberRole } from "@workspace/api/api";
import { stubGlobal } from "@workspace/test/globals";
import { createDataTableHelper } from "@workspace/ui/lib/table-config";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, mock } from "bun:test";
import { effectiveSettings } from "@/lib/settings/effective";
import { SettingsProvider } from "@/lib/settings/provider";
import {
  type DataTableConfigValue,
  useDataTableConfig,
} from "./data-table-context";
import {
  columns,
  DATA,
  DataTable,
  EDITABLE,
  TestDataTable,
  type TestDataTableProps,
  NAVIGABLE,
  press,
  pressHotkey,
  ProjectProvider,
  renderGrid,
  routerMock,
  type Row,
} from "./test-support";

// While a cell is editing the machine ignores every gesture on every cell, and
// only `editEnd` releases it. React fires no blur on unmount, so an editor
// whose row leaves the data without a gesture would leave `editing` pointing at
// a cell that no longer exists and the whole grid dead.
describe("DataTable editing outlives its row", () => {
  const gridFor = (data: Row[], onCellSave: () => Promise<boolean>) => (
    <TestDataTable
      data={data}
      columns={columns}
      persistStateInUrl={false}
      editableCells={EDITABLE}
      onCellSave={onCellSave}
    />
  );

  it("still edits another cell after the editing row leaves the data", async () => {
    const onCellSave = mock(async () => true);
    const { container, rerender } = render(gridFor(DATA, onCellSave));
    const cell = (key: string) => {
      const element = container.querySelector<HTMLElement>(
        `[data-cell="${key}"]`
      );
      if (!element) throw new Error(`no cell ${key}`);
      return element;
    };

    press(cell("10::title"));
    press(cell("10::title"));
    expect(cell("10::title").querySelector("input")).not.toBeNull();

    // No gesture, so no blur: a background refresh drops the edited row.
    await act(async () => {
      rerender(gridFor([DATA[1]!], onCellSave));
    });

    press(cell("11::title"));
    press(cell("11::title"));
    expect(cell("11::title").querySelector("input")).not.toBeNull();
  });
});

describe("DataTable cell interaction", () => {
  it("selects a text cell on the first click and edits it on the second", () => {
    const { cell } = renderGrid();

    press(cell("10::title"));
    expect(cell("10::title").querySelector("input")).toBeNull();
    expect(cell("10::title").hasAttribute("data-selected")).toBe(true);

    press(cell("10::title"));
    expect(cell("10::title").querySelector("input")).not.toBeNull();
  });

  it("opens the status menu on Enter and leaves the grid navigable", async () => {
    const { cell } = renderGrid();
    const control = cell("10::status").querySelector("[data-cell-control]");

    press(cell("10::status"));
    // The menu measures itself asynchronously once open; let that settle
    // inside `act` rather than after the test has finished with it.
    await act(async () => {
      fireEvent.keyDown(cell("10::status"), { key: "Enter" });
    });
    expect(control?.getAttribute("aria-expanded")).toBe("true");

    fireEvent.keyDown(cell("10::status"), { key: "ArrowDown" });
    expect(cell("11::status").hasAttribute("data-selected")).toBe(true);
  });

  it("leaves the grid navigable after a select editor is dismissed", () => {
    const { cell } = renderGrid();

    press(cell("10::genre"));
    press(cell("10::genre"));
    fireEvent.keyDown(document.body, { key: "Escape" });
    fireEvent.keyDown(cell("10::genre"), { key: "ArrowDown" });

    expect(cell("11::genre").hasAttribute("data-selected")).toBe(true);
  });

  it("gives a viewer a navigable, copyable grid that never edits", () => {
    const writeText = mock(() => Promise.resolve());
    stubGlobal("navigator", { clipboard: { writeText } });
    const { cell, onCellSave } = renderGrid("viewer");

    press(cell("10::title"));
    fireEvent.keyDown(cell("10::title"), { key: "ArrowDown" });
    expect(cell("11::title").hasAttribute("data-selected")).toBe(true);

    fireEvent.keyDown(cell("11::title"), { key: "c", metaKey: true });
    expect(writeText).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(cell("11::title"), { key: "Enter" });
    press(cell("11::title"));
    press(cell("11::title"));
    expect(cell("11::title").querySelector("input")).toBeNull();
    expect(onCellSave).not.toHaveBeenCalled();
  });

  it("navigates a column that has no editable config without editing it", () => {
    const { cell, onCellSave } = renderGrid(undefined, NAVIGABLE);

    press(cell("10::notes"));
    expect(cell("10::notes").hasAttribute("data-selected")).toBe(true);

    press(cell("10::notes"));
    fireEvent.keyDown(cell("10::notes"), { key: "Enter" });
    expect(cell("10::notes").querySelector("input")).toBeNull();
    expect(onCellSave).not.toHaveBeenCalled();

    fireEvent.keyDown(cell("10::notes"), { key: "ArrowDown" });
    expect(cell("11::notes").hasAttribute("data-selected")).toBe(true);
  });

  it("toggles a checkbox on the first click of its control", () => {
    const { cell, onCellSave } = renderGrid();
    const control = cell("10::mastered").querySelector<HTMLElement>(
      "[data-cell-control]"
    );
    if (!control) throw new Error("no cell control");

    press(control);

    expect(onCellSave).toHaveBeenCalledTimes(1);
    expect(onCellSave).toHaveBeenCalledWith(10, "mastered", true);
  });
});

describe("DataTable affordance and ARIA", () => {
  it("puts the grid role on the table, not on a wrapper around it", () => {
    const { container } = renderGrid();

    expect(container.querySelector("table")?.getAttribute("role")).toBe("grid");
    expect(container.querySelectorAll('[role="grid"]')).toHaveLength(1);
    expect(
      container.querySelectorAll('thead [role="row"] [role="columnheader"]')
        .length
    ).toBeGreaterThan(0);
    expect(container.querySelectorAll('tbody [role="row"]')).toHaveLength(
      DATA.length
    );
  });

  it("marks an editable cell as editable and describes how to enter it", () => {
    const { container, cell } = renderGrid();
    const title = cell("10::title");

    expect(title.getAttribute("role")).toBe("gridcell");
    expect(title.hasAttribute("data-editable")).toBe(true);
    expect(title.hasAttribute("aria-readonly")).toBe(false);

    const hint = container.querySelector(
      `#${CSS.escape(title.getAttribute("aria-describedby") ?? "")}`
    );
    expect(hint?.textContent).toBe("Press Enter to edit");
    expect(container.querySelectorAll("[data-editable]").length).toBe(
      DATA.length * Object.keys(EDITABLE).length
    );
  });

  it("marks a navigable read-only cell as read-only with no editing affordance", () => {
    const { cell } = renderGrid(undefined, NAVIGABLE);
    const notes = cell("10::notes");

    expect(notes.getAttribute("role")).toBe("gridcell");
    expect(notes.getAttribute("aria-readonly")).toBe("true");
    expect(notes.getAttribute("aria-selected")).toBe("false");
    expect(notes.hasAttribute("data-editable")).toBe(false);
    expect(notes.hasAttribute("aria-describedby")).toBe(false);
  });

  it("leaves every cell of a viewer's grid read-only", () => {
    const { container, cell } = renderGrid("viewer");

    expect(container.querySelector("[data-editable]")).toBeNull();
    expect(cell("10::title").getAttribute("aria-readonly")).toBe("true");
    expect(cell("11::genre").getAttribute("aria-readonly")).toBe("true");
    expect(cell("10::title").hasAttribute("aria-describedby")).toBe(false);
  });

  it("gives a cell that is its own control the editable marks, not an I-beam target", () => {
    const { cell } = renderGrid();
    const mastered = cell("10::mastered");

    expect(mastered.hasAttribute("data-editable")).toBe(true);
    expect(mastered.hasAttribute("aria-readonly")).toBe(false);
    expect(mastered.querySelector("[data-cell-control]")).not.toBeNull();
  });

  it("reports the selected cell as selected and its neighbours as not", () => {
    const { cell } = renderGrid();

    press(cell("10::title"));

    expect(cell("10::title").getAttribute("aria-selected")).toBe("true");
    expect(cell("11::title").getAttribute("aria-selected")).toBe("false");
    expect(cell("10::genre").getAttribute("aria-selected")).toBe("false");
  });

  it("gives a cell outside the navigable set a role and nothing else", () => {
    const { container } = renderGrid();
    const notes = container.querySelector<HTMLElement>(
      'tbody tr:first-child td:last-child[role="gridcell"]'
    );

    expect(notes).not.toBeNull();
    expect(notes?.hasAttribute("aria-selected")).toBe(false);
    expect(notes?.hasAttribute("data-editable")).toBe(false);
    expect(notes?.hasAttribute("aria-readonly")).toBe(false);
    expect(notes?.hasAttribute("aria-describedby")).toBe(false);
    expect(notes?.hasAttribute("tabindex")).toBe(false);
  });

  it("marks the peeked row current rather than selected", async () => {
    const { container } = render(
      <TestDataTable
        data={DATA}
        columns={columns}
        persistStateInUrl={false}
        editableCells={EDITABLE}
        onCellSave={mock(async () => true)}
        peek={{
          toPeekRow: (row) => ({ id: row.id, title: row.title }),
          href: (row) => `/track/${row.id}`,
          titleField: "title",
        }}
      />
    );
    const rows = () =>
      Array.from(container.querySelectorAll<HTMLElement>("tbody tr"));
    expect(rows().some((row) => row.hasAttribute("aria-current"))).toBe(false);

    // `notes` is outside the navigable set, so a click on it is a row click.
    const notes = rows()[0]?.querySelector<HTMLElement>("td:last-child");
    if (!notes) throw new Error("no notes cell");
    // The panel it opens links out and settles asynchronously.
    await act(async () => {
      fireEvent.click(notes);
    });

    expect(rows()[0]?.getAttribute("aria-current")).toBe("true");
    expect(rows()[0]?.hasAttribute("aria-selected")).toBe(false);
    expect(rows()[1]?.hasAttribute("aria-current")).toBe(false);
  });
});

describe("DataTable row click", () => {
  const peek = {
    toPeekRow: (row: Row) => ({ id: row.id, title: row.title }),
    href: (row: Row) => `/track/${row.id}`,
    titleField: "title" as const,
  };
  const notesCell = (container: HTMLElement) =>
    Array.from(
      container.querySelectorAll<HTMLElement>("tbody tr")
    )[0]?.querySelector<HTMLElement>("td:last-child");

  it("opens the row's page, through the row cursor's own href, when tables.rowClick is open", () => {
    const { container } = render(
      <SettingsProvider
        initial={effectiveSettings({ "tables.rowClick": "open" }, "test")}
      >
        <TestDataTable
          data={DATA}
          columns={columns}
          persistStateInUrl={false}
          editableCells={EDITABLE}
          onCellSave={mock(async () => true)}
          peek={peek}
        />
      </SettingsProvider>
    );
    const notes = notesCell(container);
    if (!notes) throw new Error("no notes cell");

    fireEvent.click(notes);

    expect(routerMock.push).toHaveBeenCalledWith("/track/10");
    expect(
      container.querySelector("tbody tr")?.hasAttribute("aria-current")
    ).toBe(false);
  });

  it("still peeks by default (tables.rowClick unset)", () => {
    const { container } = render(
      <TestDataTable
        data={DATA}
        columns={columns}
        persistStateInUrl={false}
        editableCells={EDITABLE}
        onCellSave={mock(async () => true)}
        peek={peek}
      />
    );
    const notes = notesCell(container);
    if (!notes) throw new Error("no notes cell");

    fireEvent.click(notes);

    expect(routerMock.push).not.toHaveBeenCalled();
    expect(
      container.querySelector("tbody tr")?.getAttribute("aria-current")
    ).toBe("true");
  });

  it("leaves a table with no peek behaving as today regardless of the setting", () => {
    const { container } = render(
      <SettingsProvider
        initial={effectiveSettings({ "tables.rowClick": "open" }, "test")}
      >
        <TestDataTable
          data={DATA}
          columns={columns}
          persistStateInUrl={false}
          editableCells={EDITABLE}
          onCellSave={mock(async () => true)}
        />
      </SettingsProvider>
    );
    const notes = notesCell(container);
    if (!notes) throw new Error("no notes cell");

    fireEvent.click(notes);

    expect(routerMock.push).not.toHaveBeenCalled();
  });
});

describe("DataTable identity column", () => {
  // `title` is navigable but has no `editableCells` entry, as the entity
  // tables declare their identity column.
  function renderIdentityGrid() {
    const editable = Object.fromEntries(
      Object.entries(EDITABLE).filter(([id]) => id !== "title")
    );
    const onCellSave = mock(async () => true);
    const { container } = render(
      <TestDataTable
        data={DATA}
        columns={columns}
        persistStateInUrl={false}
        editableCells={editable}
        navigableColumns={NAVIGABLE}
        onCellSave={onCellSave}
      />
    );
    const cell = (key: string) => {
      const element = container.querySelector<HTMLElement>(
        `[data-cell="${key}"]`
      );
      if (!element) throw new Error(`no cell ${key}`);
      return element;
    };
    return { onCellSave, cell };
  }

  it("selects on a click on the identity cell's padding and mounts no input", () => {
    const { cell, onCellSave } = renderIdentityGrid();

    press(cell("10::title"));
    expect(cell("10::title").hasAttribute("data-selected")).toBe(true);
    expect(cell("10::title").querySelector("input")).toBeNull();

    press(cell("10::title"));
    fireEvent.keyDown(cell("10::title"), { key: "Enter" });
    expect(cell("10::title").querySelector("input")).toBeNull();
    expect(onCellSave).not.toHaveBeenCalled();
  });

  it("keeps the identity cell in the arrow-key path", () => {
    const { cell } = renderIdentityGrid();

    press(cell("10::title"));
    fireEvent.keyDown(cell("10::title"), { key: "ArrowRight" });
    expect(cell("10::status").hasAttribute("data-selected")).toBe(true);

    fireEvent.keyDown(cell("10::status"), { key: "ArrowLeft" });
    expect(cell("10::title").hasAttribute("data-selected")).toBe(true);
  });

  it("copies the identity cell's title text", () => {
    const writeText = mock(() => Promise.resolve());
    stubGlobal("navigator", { clipboard: { writeText } });
    const { cell } = renderIdentityGrid();

    press(cell("10::title"));
    fireEvent.keyDown(cell("10::title"), { key: "c", metaKey: true });

    expect(writeText).toHaveBeenCalledWith("One");
  });
});

describe("DataTable type-to-edit", () => {
  /** A grid whose `notes` column is an editable text cell beside the fixture's. */
  function renderTextGrid() {
    const onCellSave = mock(async () => true);
    const { container } = render(
      <TestDataTable
        data={DATA}
        columns={columns}
        persistStateInUrl={false}
        editableCells={{ ...EDITABLE, notes: { type: "text" } }}
        navigableColumns={NAVIGABLE}
        onCellSave={onCellSave}
      />
    );
    const cell = (key: string) => {
      const element = container.querySelector<HTMLElement>(
        `[data-cell="${key}"]`
      );
      if (!element) throw new Error(`no cell ${key}`);
      return element;
    };
    const input = (key: string) =>
      cell(key).querySelector<HTMLInputElement>("input");
    return { container, onCellSave, cell, input };
  }

  it("opens the editor on a selected text cell with the typed character as the draft", () => {
    const { cell, input } = renderTextGrid();

    press(cell("10::notes"));
    const notPrevented = fireEvent.keyDown(cell("10::notes"), { key: "x" });

    expect(notPrevented).toBe(false);
    expect(input("10::notes")?.value).toBe("x");
  });

  it("seeds a single astral character whole", () => {
    const { cell, input } = renderTextGrid();

    press(cell("10::notes"));
    fireEvent.keyDown(cell("10::notes"), { key: "🎵" });

    expect(input("10::notes")?.value).toBe("🎵");
  });

  it("restores the old value when Escape cancels a seeded edit", () => {
    const { cell, input, onCellSave } = renderTextGrid();

    press(cell("10::notes"));
    fireEvent.keyDown(cell("10::notes"), { key: "x" });
    fireEvent.keyDown(input("10::notes") as HTMLElement, { key: "Escape" });

    expect(input("10::notes")).toBeNull();
    expect(cell("10::notes").textContent).toContain("first");
    expect(onCellSave).not.toHaveBeenCalled();
  });

  it("saves the seeded draft on Enter", async () => {
    const { cell, input, onCellSave } = renderTextGrid();

    press(cell("10::notes"));
    fireEvent.keyDown(cell("10::notes"), { key: "x" });
    await act(async () => {
      fireEvent.keyDown(input("10::notes") as HTMLElement, { key: "Enter" });
    });

    expect(onCellSave).toHaveBeenCalledWith(10, "notes", "x");
  });

  it("does not carry a seed into the next edit of the same cell", () => {
    const { cell, input } = renderTextGrid();

    press(cell("10::notes"));
    fireEvent.keyDown(cell("10::notes"), { key: "x" });
    fireEvent.keyDown(input("10::notes") as HTMLElement, { key: "Escape" });
    fireEvent.keyDown(cell("10::notes"), { key: "Enter" });

    expect(input("10::notes")?.value).toBe("first");
  });

  it("does not carry a seed into an edit of another cell", () => {
    const { cell, input } = renderTextGrid();

    press(cell("10::notes"));
    fireEvent.keyDown(cell("10::notes"), { key: "x" });
    fireEvent.keyDown(input("10::notes") as HTMLElement, { key: "Escape" });
    fireEvent.keyDown(cell("10::notes"), { key: "ArrowDown" });
    fireEvent.keyDown(cell("11::notes"), { key: "Enter" });

    expect(input("11::notes")?.value).toBe("second");
  });

  it("mounts nothing and leaves the key alone on a read-only cell", () => {
    const { cell, onCellSave } = renderGrid(undefined, NAVIGABLE);

    press(cell("10::notes"));
    const notPrevented = fireEvent.keyDown(cell("10::notes"), { key: "x" });

    expect(notPrevented).toBe(true);
    expect(cell("10::notes").querySelector("input")).toBeNull();
    expect(onCellSave).not.toHaveBeenCalled();
  });

  it("leaves a toggle cell to its own gestures", () => {
    const { cell, onCellSave } = renderGrid();

    press(cell("10::mastered"));
    const typed = fireEvent.keyDown(cell("10::mastered"), { key: "x" });
    const space = fireEvent.keyDown(cell("10::mastered"), { key: " " });

    expect(typed).toBe(true);
    expect(space).toBe(true);
    // The checkbox is itself an input; an editor would be a text one.
    expect(cell("10::mastered").querySelector("input[type=text]")).toBeNull();
    expect(onCellSave).not.toHaveBeenCalled();
  });

  it("does not seed from whitespace or a named key", () => {
    const { cell, input } = renderTextGrid();

    press(cell("10::notes"));
    fireEvent.keyDown(cell("10::notes"), { key: " " });
    fireEvent.keyDown(cell("10::notes"), { key: "Shift" });
    fireEvent.keyDown(cell("10::notes"), { key: "F2" });

    expect(input("10::notes")).toBeNull();
  });

  it("ignores a keystroke that is part of an IME composition", () => {
    const { cell, input } = renderTextGrid();

    press(cell("10::notes"));
    const notPrevented = fireEvent.keyDown(cell("10::notes"), {
      key: "x",
      isComposing: true,
    });

    expect(notPrevented).toBe(true);
    expect(input("10::notes")).toBeNull();
  });

  it("leaves ⌘, Ctrl and Alt chords to their own handlers", () => {
    const writeText = mock(() => Promise.resolve());
    stubGlobal("navigator", { clipboard: { writeText } });
    const { cell, input } = renderTextGrid();

    press(cell("10::notes"));
    fireEvent.keyDown(cell("10::notes"), { key: "c", metaKey: true });
    fireEvent.keyDown(cell("10::notes"), { key: "x", metaKey: true });
    fireEvent.keyDown(cell("10::notes"), { key: "x", ctrlKey: true });
    fireEvent.keyDown(cell("10::notes"), { key: "x", altKey: true });

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(input("10::notes")).toBeNull();
  });

  it("ignores a key typed into a text control inside the grid", () => {
    const { cell, container, input } = renderTextGrid();

    press(cell("10::notes"));
    const field = document.createElement("input");
    container.querySelector("[role=grid]")?.appendChild(field);
    const notPrevented = fireEvent.keyDown(field, { key: "x" });

    expect(notPrevented).toBe(true);
    expect(input("10::notes")).toBeNull();
  });
});

describe("DataTable draft row keys", () => {
  // The draft row renders inside the same wrapper that carries the grid's
  // keydown handler, and it does not stop propagation, so every key typed in
  // one of its inputs also reaches the grid.
  function renderWithDraftRow() {
    const onCellSave = mock(async () => true);
    const onCreate = mock(async () => true);
    const { container } = render(
      <TestDataTable
        data={DATA}
        columns={columns}
        persistStateInUrl={false}
        editableCells={EDITABLE}
        onCellSave={onCellSave}
        entityLabel="track"
        newRow={{ fields: { title: { type: "text" } }, onCreate }}
      />
    );
    const cell = (key: string) => {
      const element = container.querySelector<HTMLElement>(
        `[data-cell="${key}"]`
      );
      if (!element) throw new Error(`no cell ${key}`);
      return element;
    };
    // Select a cell first: the grid only acts on keys when one is focused.
    press(cell("10::title"));
    const toggle = Array.from(
      container.querySelectorAll<HTMLElement>("button")
    ).find((button) => button.textContent?.includes("Add track"));
    if (!toggle) throw new Error("no add-row toggle");
    fireEvent.click(toggle);
    const draft = container.querySelector<HTMLInputElement>(
      'tbody input[type="text"], tbody input:not([type])'
    );
    if (!draft) throw new Error("no draft input");
    return { container, cell, draft, onCellSave, onCreate };
  }

  it("does not move the cell selection when an arrow key is pressed in a draft field", () => {
    const { cell, draft } = renderWithDraftRow();

    fireEvent.keyDown(draft, { key: "ArrowDown" });

    expect(cell("10::title").hasAttribute("data-selected")).toBe(true);
    expect(cell("11::title").hasAttribute("data-selected")).toBe(false);
  });

  it("does not open a cell editor when Enter is pressed in a draft field", async () => {
    const { cell, draft } = renderWithDraftRow();

    await act(async () => {
      fireEvent.keyDown(draft, { key: "Enter" });
    });

    expect(cell("10::title").querySelector("input")).toBeNull();
  });

  it("does not copy the cell selection when ⌘C is pressed in a draft field", () => {
    const writeText = mock(() => Promise.resolve());
    stubGlobal("navigator", { clipboard: { writeText } });
    const { draft } = renderWithDraftRow();

    fireEvent.keyDown(draft, { key: "c", metaKey: true });

    expect(writeText).not.toHaveBeenCalled();
  });

  // A picker's trigger is a button, not a text box, so the grid's "is this a
  // typing target" guard does not cover it. Without the row stopping its own
  // keys, Enter here opens an editor on whichever cell was focused behind it.
  it("does not open a cell editor when Enter is pressed on a draft picker", async () => {
    const onCellSave = mock(async () => true);
    const onCreate = mock(async () => true);
    const { container } = render(
      <TestDataTable
        data={DATA}
        columns={columns}
        persistStateInUrl={false}
        editableCells={EDITABLE}
        onCellSave={onCellSave}
        entityLabel="track"
        newRow={{
          fields: { genre: EDITABLE.genre! },
          onCreate,
        }}
      />
    );
    const titleCell = container.querySelector<HTMLElement>(
      '[data-cell="10::title"]'
    );
    if (!titleCell) throw new Error("no title cell");
    press(titleCell);
    const toggle = Array.from(
      container.querySelectorAll<HTMLElement>("button")
    ).find((button) => button.textContent?.includes("Add track"));
    if (!toggle) throw new Error("no add-row toggle");
    fireEvent.click(toggle);
    const trigger = Array.from(
      container.querySelectorAll<HTMLElement>("tbody button")
    ).find((button) => button.textContent?.includes("Select..."));
    if (!trigger) throw new Error("no draft picker");

    await act(async () => {
      fireEvent.keyDown(trigger, { key: "Enter" });
    });

    expect(titleCell.querySelector("input")).toBeNull();
  });
});

describe("DataTable rename action", () => {
  type GridOptions = {
    role?: MemberRole;
    peeked?: boolean;
    selectable?: boolean;
  };

  function renderRenameGrid({
    role,
    peeked = true,
    selectable = false,
  }: GridOptions = {}) {
    const onCellSave = mock(async () => true);
    const grid = (
      <TestDataTable
        data={DATA}
        columns={columns}
        persistStateInUrl={false}
        editableCells={EDITABLE}
        enableSelection={selectable}
        onBulkDelete={mock(async () => ({ ok: true }))}
        onCellSave={onCellSave}
        rowActions={{ copyHref: (row) => `/track/${row.id}` }}
        peek={
          peeked
            ? {
                toPeekRow: (row) => ({ id: row.id, title: row.title }),
                href: (row) => `/track/${row.id}`,
                titleField: "title",
              }
            : undefined
        }
      />
    );
    const { container } = render(
      role === undefined ? (
        grid
      ) : (
        <ProjectProvider project={{ id: 1, name: "Project", role }}>
          {grid}
        </ProjectProvider>
      )
    );
    const cell = (key: string) => {
      const element = container.querySelector<HTMLElement>(
        `[data-cell="${key}"]`
      );
      if (!element) throw new Error(`no cell ${key}`);
      return element;
    };
    const rows = () =>
      Array.from(container.querySelectorAll<HTMLElement>("tbody tr"));
    return { container, cell, rows, onCellSave };
  }

  async function openMenu(row: HTMLElement | undefined) {
    if (!row) throw new Error("no row");
    await act(async () => {
      fireEvent.contextMenu(row);
    });
    return screen.findAllByRole("menuitem");
  }

  const names = (items: HTMLElement[]) =>
    items.map((item) => item.textContent?.trim());

  const titleInput = () =>
    screen.queryByRole<HTMLInputElement>("textbox", { name: "Title" });

  async function chooseRename(row: HTMLElement | undefined) {
    await openMenu(row);
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    });
  }

  it("offers Rename just above Copy link to an editor", async () => {
    const { rows } = renderRenameGrid({ role: "editor" });

    const items = names(await openMenu(rows()[0]));

    expect(items).toContain("Rename");
    expect(items.indexOf("Rename")).toBe(items.indexOf("Copy link") - 1);
  });

  it("offers no Rename to a viewer", async () => {
    const { rows } = renderRenameGrid({ role: "viewer" });

    const items = names(await openMenu(rows()[0]));

    expect(items).toContain("Copy link");
    expect(items).not.toContain("Rename");
  });

  it("offers no Rename on a table without a peek panel", async () => {
    const { rows } = renderRenameGrid({ role: "editor", peeked: false });

    const items = names(await openMenu(rows()[0]));

    expect(items).toContain("Copy link");
    expect(items).not.toContain("Rename");
  });

  it("offers no Rename when the menu acts on several selected rows", async () => {
    const { rows } = renderRenameGrid({ role: "editor", selectable: true });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("checkbox", { name: "Select all loaded rows" })
      );
    });

    const items = names(await openMenu(rows()[0]));

    expect(items.some((item) => item?.startsWith("Delete 2"))).toBe(true);
    expect(items).not.toContain("Rename");
  });

  it("opens the panel on the title editor for the row it was chosen on", async () => {
    const { rows } = renderRenameGrid({ role: "editor" });

    expect(titleInput()).toBeNull();
    await chooseRename(rows()[1]);

    const input = titleInput();
    expect(input?.value).toBe("Two");
    expect(rows()[1]?.getAttribute("aria-current")).toBe("true");
    expect(rows()[0]?.hasAttribute("aria-current")).toBe(false);
  });

  it("saves the new title to the row and shows it in the grid", async () => {
    const { rows, cell, onCellSave } = renderRenameGrid({ role: "editor" });
    await chooseRename(rows()[0]);
    const input = titleInput();
    if (!input) throw new Error("no title editor");

    fireEvent.change(input, { target: { value: "One, renamed" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    expect(onCellSave).toHaveBeenCalledWith(10, "title", "One, renamed");
    expect(cell("10::title").textContent).toContain("One, renamed");
    expect(titleInput()).toBeNull();
  });

  it("leaves the grid alone when the rename is abandoned with Escape", async () => {
    const { rows, cell, onCellSave } = renderRenameGrid({ role: "editor" });
    await chooseRename(rows()[0]);
    const input = titleInput();
    if (!input) throw new Error("no title editor");

    fireEvent.change(input, { target: { value: "Discarded" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Escape" });
    });

    expect(onCellSave).not.toHaveBeenCalled();
    expect(cell("10::title").textContent).toContain("One");
    expect(titleInput()).toBeNull();
  });

  it("does not resume the rename when the panel is closed and the row opened again", async () => {
    const { rows } = renderRenameGrid({ role: "editor" });
    await chooseRename(rows()[0]);
    expect(titleInput()).not.toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^close/i }));
    });
    expect(rows()[0]?.hasAttribute("aria-current")).toBe(false);

    await openMenu(rows()[0]);
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Open" }));
    });

    expect(rows()[0]?.getAttribute("aria-current")).toBe("true");
    expect(titleInput()).toBeNull();
  });
});

describe("DataTable row rendering", () => {
  const ROWS: Row[] = [
    ...DATA,
    { ...DATA[0]!, id: 12, title: "Three", notes: "third" },
    { ...DATA[1]!, id: 13, title: "Four", notes: "fourth" },
  ];

  // A row runs each of its cells once per render, so a column whose cell
  // counts its calls counts the renders of every row.
  function renderCounted(props: Partial<TestDataTableProps<Row>> = {}) {
    const renders = new Map<string, number>();
    const helper = createDataTableHelper<Row>();
    const counted = [
      ...columns,
      helper.accessor((row) => row.id, {
        id: "renders",
        header: "Renders",
        cell: ({ row }) => {
          renders.set(row.id, (renders.get(row.id) ?? 0) + 1);
          return null;
        },
      }),
    ];
    const result = render(
      <TestDataTable
        data={ROWS}
        columns={counted}
        persistStateInUrl={false}
        {...props}
      />
    );
    const rows = () =>
      Array.from(result.container.querySelectorAll<HTMLElement>("tbody tr"));
    return { ...result, renders, rows };
  }

  it("re-renders only the two rows a cursor move touches", () => {
    const { renders, rows } = renderCounted();
    pressHotkey("j");
    expect(rows()[0]?.hasAttribute("data-cursor")).toBe(true);

    renders.clear();
    pressHotkey("j");

    expect(rows()[1]?.hasAttribute("data-cursor")).toBe(true);
    expect(Object.fromEntries(renders)).toEqual({ "10": 1, "11": 1 });
  });

  it("re-renders only the row a tick touches", () => {
    const { renders, rows } = renderCounted({ enableSelection: true });
    const tick = (row: HTMLElement | undefined) => {
      const box = row?.querySelector<HTMLElement>('[aria-label="Select row"]');
      if (!box) throw new Error("no row checkbox");
      fireEvent.click(box);
    };

    renders.clear();
    tick(rows()[2]);
    expect(Object.fromEntries(renders)).toEqual({ "12": 1 });

    // A ticked row's actions act on the whole selection, so it re-renders
    // with every further tick; an unticked row still does not.
    renders.clear();
    tick(rows()[0]);
    expect(Object.fromEntries(renders)).toEqual({ "10": 1, "12": 1 });
  });

  it("re-renders a mounted row when a column is hidden", () => {
    let table: DataTableConfigValue<Row>["table"] | undefined;
    function TableProbe() {
      table = useDataTableConfig<Row>().table;
      return null;
    }
    render(
      <DataTable<Row> data={DATA} columns={columns} deleteKind="track">
        <TableProbe />
        <DataTable.Grid<Row> />
      </DataTable>
    );
    expect(screen.getByText("Rock")).toBeTruthy();

    act(() => table?.getColumn("genre")?.toggleVisibility(false));

    expect(screen.queryByText("Rock")).toBeNull();
    expect(screen.getByText("One")).toBeTruthy();
  });
});
