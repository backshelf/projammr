import { HISTORY_COMMANDS } from "@/components/commands/history";
import type { PeekPanelProps } from "@/components/tables/PeekPanel";
import type { BulkSelection } from "@/entities/api";
import { act, fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, mock, type Mock } from "bun:test";

import type { TableAction, TableActionResult } from "./generic-table-types";

type ToastOptions = { action?: { label: string; onClick: () => void } };
const toastSuccess = mock<(message: string, options?: ToastOptions) => void>();
const toastError = mock<(message: string) => void>();
mock.module("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

// The panel has its own suite; a stand-in that names the row it was given is
// what "Open sets the peek row" needs. `mock.module` is not hoisted, so the
// harness and the mocked copy hook are imported after it.
mock.module("@/components/tables/PeekPanel", () => ({
  PeekPanel: (props: PeekPanelProps) => (
    <span data-testid="peek-title">{props.row?.title ?? "none"}</span>
  ),
}));
mock.module("@/lib/browser-api", () => ({
  browserApi: {
    GET: mock(async () => ({
      data: [],
      response: new Response("[]", { status: 200 }),
    })),
  },
}));

const { DATA, mixing, pressHotkey, renderGrid, stateProbe } =
  await import("./test-support");
const { useCopyText } = await import("@/components/copy-text/CopyTextProvider");

// Every row's action bar and menus are built by `useRowActions`. What each
// action does, and to which rows, is pinned here through the real table.

type Row = (typeof DATA)[number];

const THREE: Row = { ...DATA[0]!, id: 12, title: "Three", statusId: null };
const THREE_ROWS = [...DATA, THREE];

const rowActions = {
  label: (row: Row) => row.title,
  copyHref: (row: Row) => `/track/${row.id}`,
};
const peek = {
  toPeekRow: (row: Row) => ({ id: row.id, title: row.title }),
  href: (row: Row) => `/track/${row.id}`,
  titleField: "title",
};
const moveToProject = {
  kind: "track" as const,
  projectId: 1,
  hrefInProject: (_row: unknown, projectId: number) =>
    `/project/${projectId}/tracks`,
};

type BulkPatch = (
  selection: BulkSelection,
  patch: Record<string, unknown>
) => Promise<{ ok: boolean; count?: number }>;

type BulkMove = (
  selection: BulkSelection,
  targetProjectId: number
) => Promise<{ ok: boolean; count?: number }>;

function renderActions(overrides: Parameters<typeof renderGrid>[2] = {}) {
  const onBulkPatch = mock<BulkPatch>(async () => ({ ok: true, count: 2 }));
  const result = renderGrid(undefined, undefined, {
    data: THREE_ROWS,
    enableSelection: true,
    bulkStatuses: [mixing],
    onBulkPatch,
    rowActions,
    ...overrides,
  });
  return { ...result, onBulkPatch };
}

const checkboxes = () =>
  screen.getAllByRole<HTMLInputElement>("checkbox", { name: "Select row" });
const checkedRows = () =>
  checkboxes()
    .map((box, index) => (box.checked ? index : -1))
    .filter((index) => index >= 0);

const selectRows = (...indexes: number[]) => {
  for (const index of indexes) fireEvent.click(checkboxes()[index]!);
};

/** The nth row's button in its pinned action bar, by the label it carries. */
const barButton = (name: string, index: number) =>
  screen.getAllByRole("button", { name })[index]!;

// A menu that has closed stays in the DOM under happy-dom, so the item of the
// menu opened last is the one to act on.
async function chooseStatus(index: number) {
  await act(async () => {
    fireEvent.keyDown(barButton("Set status of row", index), {
      key: "ArrowDown",
    });
  });
  const items = await screen.findAllByRole("menuitem", { name: /mixing/i });
  await act(async () => {
    fireEvent.click(items.at(-1)!);
  });
}

async function chooseMenuItem(index: number, name: string) {
  await act(async () => {
    fireEvent.keyDown(barButton("More actions for row", index), {
      key: "ArrowDown",
    });
  });
  const items = await screen.findAllByRole("menuitem", { name });
  await act(async () => {
    fireEvent.click(items.at(-1)!);
  });
}

describe("useRowActions targets", () => {
  it("acts on an unselected row alone and leaves the selection", async () => {
    const { onBulkPatch, onCellSave } = renderActions();
    selectRows(0, 1);

    await chooseStatus(2);

    expect(onCellSave).toHaveBeenCalledTimes(1);
    expect(onCellSave).toHaveBeenCalledWith(12, "statusId", 2);
    expect(onBulkPatch).not.toHaveBeenCalled();
    expect(checkedRows()).toEqual([0, 1]);
  });

  it("acts on the whole selection from a row inside a multi-row selection", async () => {
    const { onBulkPatch, onCellSave } = renderActions();
    selectRows(0, 1);

    await chooseStatus(1);

    expect(onBulkPatch).toHaveBeenCalledTimes(1);
    expect(onBulkPatch).toHaveBeenCalledWith(
      { ids: [10, 11] },
      { statusId: 2 }
    );
    expect(onCellSave).not.toHaveBeenCalled();
  });

  it("clears the selection once a bulk status change succeeds", async () => {
    renderActions();
    selectRows(0, 1);

    await chooseStatus(0);

    expect(checkedRows()).toEqual([]);
  });

  it("keeps the selection when a bulk status change fails", async () => {
    const failing = mock<BulkPatch>(async () => ({ ok: false }));
    renderActions({ onBulkPatch: failing });
    selectRows(0, 1);

    await chooseStatus(0);

    expect(failing).toHaveBeenCalledTimes(1);
    expect(checkedRows()).toEqual([0, 1]);
  });

  it("treats a selection of one as the row alone", async () => {
    const { onBulkPatch, onCellSave } = renderActions();
    selectRows(0);

    await chooseStatus(0);

    expect(onCellSave).toHaveBeenCalledWith(10, "statusId", 2);
    expect(onBulkPatch).not.toHaveBeenCalled();
  });
});

describe("useRowActions single-row actions", () => {
  it("sets the peek row when a row is opened", async () => {
    renderActions({ peek });

    await act(async () => {
      fireEvent.click(barButton("Open row", 1));
    });

    expect((await screen.findByTestId("peek-title")).textContent).toBe("Two");
  });

  it("sets the move target when a row asks to move", async () => {
    renderActions({ moveToProject });

    await chooseMenuItem(1, "Move to project…");

    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("Move Two");
  });

  it("sets a selection target when Move is chosen from a row inside a multi-row selection", async () => {
    const onBulkMove = mock<BulkMove>(async () => ({ ok: true, count: 2 }));
    const probe = stateProbe();
    renderActions({ moveToProject, onBulkMove, children: <probe.Probe /> });
    selectRows(0, 1);

    await chooseMenuItem(0, "Move to project…");

    expect(probe.state().moveTarget).toEqual({
      selection: { ids: [DATA[0]!.id, DATA[1]!.id] },
      count: 2,
    });
  });

  it("offers no Move action from a row inside a selection when the table cannot bulk-move", async () => {
    renderActions({ moveToProject });
    selectRows(0, 1);

    await act(async () => {
      fireEvent.keyDown(barButton("More actions for row", 0), {
        key: "ArrowDown",
      });
    });

    expect(
      screen.queryByRole("menuitem", { name: "Move to project…" })
    ).toBeNull();
  });

  it("passes the row's absolute link to copy-text", async () => {
    (
      window as unknown as { happyDOM: { setURL: (url: string) => void } }
    ).happyDOM.setURL("http://localhost/project/1/tracks");
    renderActions();

    await act(async () => {
      fireEvent.click(barButton("Copy link to row", 1));
    });

    // Each render of the table gets its own stand-in from the stubbed hook, and
    // the handler that ran is the one that was built by the latest.
    const standIns = (useCopyText as unknown as Mock<() => Mock<() => void>>)
      .mock.results;
    const called = standIns
      .map((result) => result.value as Mock<() => void>)
      .filter((copy) => copy.mock.calls.length > 0);
    expect(called).toHaveLength(1);
    expect(called[0]).toHaveBeenCalledWith("http://localhost/track/11", {
      success: "Link copied",
    });
  });
});

describe("useRowActions gating", () => {
  it("renders no action bar on a table with no rowActions", () => {
    renderActions({ rowActions: undefined, peek });

    expect(screen.queryByRole("button", { name: "Open row" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "More actions for row" })
    ).toBeNull();
  });

  it("offers a viewer no Delete or Move", async () => {
    renderGrid("viewer", undefined, {
      data: THREE_ROWS,
      rowActions: { ...rowActions, onDelete: mock(async () => ({ ok: true })) },
      onBulkDelete: mock(async () => ({ ok: true })),
      moveToProject,
    });

    await act(async () => {
      fireEvent.keyDown(barButton("More actions for row", 0), {
        key: "ArrowDown",
      });
    });

    expect(
      screen.getAllByRole("menuitem", { name: "Copy link" })
    ).not.toHaveLength(0);
    expect(screen.queryByRole("menuitem", { name: "Delete" })).toBeNull();
    expect(
      screen.queryByRole("menuitem", { name: "Move to project…" })
    ).toBeNull();
  });

  it("offers a viewer no Set status in the menu or the action bar", async () => {
    renderGrid("viewer", undefined, {
      data: THREE_ROWS,
      bulkStatuses: [mixing],
      rowActions,
    });

    await act(async () => {
      fireEvent.keyDown(barButton("More actions for row", 0), {
        key: "ArrowDown",
      });
    });

    expect(
      screen.getAllByRole("menuitem", { name: "Copy link" })
    ).not.toHaveLength(0);
    expect(screen.queryByRole("menuitem", { name: "Set status" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Set status of row" })
    ).toBeNull();
  });

  it("offers an editor Set status in the menu and the action bar", async () => {
    renderGrid("editor", undefined, {
      data: THREE_ROWS,
      bulkStatuses: [mixing],
      rowActions,
    });

    expect(
      screen.getAllByRole("button", { name: "Set status of row" })
    ).not.toHaveLength(0);

    await act(async () => {
      fireEvent.keyDown(barButton("More actions for row", 0), {
        key: "ArrowDown",
      });
    });

    expect(
      screen.getAllByRole("menuitem", { name: "Set status" })
    ).not.toHaveLength(0);
  });
});

describe("useRowActions declared actions", () => {
  beforeEach(() => {
    toastSuccess.mockClear();
    toastError.mockClear();
  });

  type Run = (selection: BulkSelection) => Promise<TableActionResult>;

  /** An Archive action offered on the Rock rows: One and Three, not Two. */
  function archive(run: Run): TableAction<Row> {
    return {
      id: "archive",
      label: "Archive",
      offered: (row) => row.genre === "Rock",
      run: mock(run),
    };
  }

  async function openMenu(index: number) {
    await act(async () => {
      fireEvent.keyDown(barButton("More actions for row", index), {
        key: "ArrowDown",
      });
    });
  }

  const archivedOk: Run = async () => ({ ok: true, message: "Archived" });

  it("offers an action on a row that passes it", async () => {
    renderActions({ actions: [archive(archivedOk)] });

    await openMenu(0);

    expect(
      await screen.findAllByRole("menuitem", { name: "Archive" })
    ).not.toHaveLength(0);
  });

  it("offers no action on a row that does not pass it", async () => {
    renderActions({ actions: [archive(archivedOk)] });

    await openMenu(1);

    expect(screen.queryByRole("menuitem", { name: "Archive" })).toBeNull();
  });

  it("runs on every selected id when one row of a mixed selection passes, then clears the selection", async () => {
    const action = archive(archivedOk);
    renderActions({ actions: [action] });
    selectRows(0, 1);

    // Two is the row that fails `offered`; the selection still offers it.
    await chooseMenuItem(1, "Archive");

    expect(action.run).toHaveBeenCalledTimes(1);
    expect(action.run).toHaveBeenCalledWith({ ids: [10, 11] });
    expect(checkedRows()).toEqual([]);
  });

  it("toasts the message with an Undo that calls undo", async () => {
    const undo = mock(async (): Promise<TableActionResult> => ({
      ok: true,
      message: "Unarchived",
    }));
    renderActions({
      actions: [archive(async () => ({ ok: true, message: "Archived", undo }))],
    });

    await chooseMenuItem(0, "Archive");

    expect(toastSuccess).toHaveBeenCalledTimes(1);
    const [message, options] = toastSuccess.mock.calls[0]!;
    expect(message).toBe("Archived");
    expect(options?.action?.label).toBe("Undo");
    await act(async () => {
      options!.action!.onClick();
    });
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it("toasts the error and keeps the selection when the action reports a failure", async () => {
    renderActions({
      actions: [archive(async () => ({ ok: false, message: "Nope" }))],
    });
    selectRows(0, 1);

    await chooseMenuItem(0, "Archive");

    expect(toastError).toHaveBeenCalledWith("Nope");
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(checkedRows()).toEqual([0, 1]);
  });

  it("toasts 'Could not {label} {noun}' when the action throws", async () => {
    renderActions({
      actions: [
        archive(async () => {
          throw new Error("offline");
        }),
      ],
    });
    selectRows(0, 1);

    await chooseMenuItem(0, "Archive");

    expect(toastError).toHaveBeenCalledWith("Could not archive rows");
    expect(checkedRows()).toEqual([0, 1]);
  });

  it("offers the bulk bar no action when no selected row passes it", () => {
    renderActions({ actions: [archive(archivedOk)] });
    selectRows(1);

    expect(
      screen.getByRole("button", { name: "Clear selection" })
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
  });

  it("runs the bulk bar's action on the selection and clears it on success", async () => {
    const action = archive(archivedOk);
    renderActions({ actions: [action] });
    selectRows(0, 1);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    });

    expect(action.run).toHaveBeenCalledWith({ ids: [10, 11] });
    expect(toastSuccess).toHaveBeenCalledWith("Archived", undefined);
    expect(checkedRows()).toEqual([]);
  });
});

describe("useRowActions row keys", () => {
  const singles = { id: 5, title: "Singles" };
  const onBulkAddToCollection = mock(async () => ({ ok: true, count: 1 }));

  /** Archive is offered on the Rock rows: One and Three, not Two. */
  function archive(run: () => Promise<TableActionResult>): TableAction<Row> {
    return {
      id: "archive",
      label: "Archive",
      offered: (row) => row.genre === "Rock",
      run: mock(run),
    };
  }

  /** The cursor onto the nth row: the first `j` lands on row 0. */
  function cursorOn(index: number) {
    for (let step = 0; step <= index; step += 1) pressHotkey("j");
  }

  beforeEach(() => {
    toastSuccess.mockClear();
    toastError.mockClear();
    onBulkAddToCollection.mockClear();
  });

  it("starts the cursor row's rename on r", () => {
    const probe = stateProbe();
    renderActions({ peek, children: <probe.Probe /> });

    cursorOn(1);
    pressHotkey("r");

    expect(probe.state().peekId).toBe(11);
    expect(probe.state().renaming).toBe(true);
  });

  it("does not rename when the table has no peek to rename in", () => {
    const probe = stateProbe();
    renderActions({ children: <probe.Probe /> });

    cursorOn(1);
    pressHotkey("r");

    expect(probe.state().renaming).toBe(false);
  });

  it("archives the cursor row through its declared action, toasting an Undo", async () => {
    const undo = mock(async (): Promise<TableActionResult> => ({
      ok: true,
      message: "Unarchived",
    }));
    const action = archive(async () => ({
      ok: true,
      message: "Archived",
      undo,
    }));
    renderActions({ actions: [action] });

    cursorOn(0);
    await act(async () => {
      pressHotkey("e");
    });

    expect(action.run).toHaveBeenCalledTimes(1);
    expect(action.run).toHaveBeenCalledWith({ ids: [10] });
    const [message, options] = toastSuccess.mock.calls[0]!;
    expect(message).toBe("Archived");
    expect(options?.action?.label).toBe("Undo");
  });

  it("archives the next row too when the cursor moves and . repeats it", async () => {
    const action = archive(async () => ({ ok: true, message: "Archived" }));
    renderActions({
      actions: [action],
      extraCommands: HISTORY_COMMANDS,
    });

    cursorOn(0);
    await act(async () => {
      pressHotkey("e");
    });
    pressHotkey("j");
    pressHotkey("j");
    await act(async () => {
      pressHotkey(".");
    });

    expect(action.run).toHaveBeenNthCalledWith(1, { ids: [10] });
    expect(action.run).toHaveBeenNthCalledWith(2, { ids: [12] });
  });

  it("does nothing on e for a row the archive action is not offered on", async () => {
    const action = archive(async () => ({ ok: true, message: "Archived" }));
    renderActions({ actions: [action] });

    cursorOn(1);
    await act(async () => {
      pressHotkey("e");
    });

    expect(action.run).not.toHaveBeenCalled();
  });

  it("opens the cursor row's menu with its collection submenu open on a", async () => {
    renderActions({
      bulkCollections: [singles],
      onBulkAddToCollection,
    });

    cursorOn(1);
    await act(async () => {
      pressHotkey("a");
    });

    const item = await screen.findByRole("menuitem", { name: "Singles" });
    await act(async () => {
      fireEvent.click(item);
    });
    expect(onBulkAddToCollection).toHaveBeenCalledWith(5, [11]);
  });

  it("offers a again after the menu it opened has closed", async () => {
    renderActions({
      bulkCollections: [singles],
      onBulkAddToCollection,
    });

    cursorOn(0);
    await act(async () => {
      pressHotkey("a");
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole("menuitem", { name: "Singles" }));
    });
    await act(async () => {
      pressHotkey("a");
    });
    await act(async () => {
      fireEvent.click(
        (await screen.findAllByRole("menuitem", { name: "Singles" })).at(-1)!
      );
    });

    expect(onBulkAddToCollection).toHaveBeenCalledTimes(2);
  });

  it("opens no menu on a when no collections exist", async () => {
    renderActions({ bulkCollections: [], onBulkAddToCollection });

    cursorOn(0);
    await act(async () => {
      pressHotkey("a");
    });

    expect(screen.queryByRole("menuitem")).toBeNull();
  });

  it("focuses the table's search field on f", () => {
    renderActions();

    pressHotkey("f");

    expect(document.activeElement).toBe(
      screen.getAllByRole("searchbox", { name: "Search the table" })[0]!
    );
  });
});
