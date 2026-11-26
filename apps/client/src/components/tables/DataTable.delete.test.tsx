import type { BulkSelection } from "@/entities/api";
import type { MemberRole } from "@workspace/api/api";
import { useRequestRowDelete } from "@/components/tables/row-delete";
import { DEFAULT_POLICIES } from "@/lib/policies/policies";
import { PoliciesProvider } from "@/lib/policies/provider";
import type { DeleteKind } from "@/lib/policies/shell";
import { createDataTableHelper } from "@workspace/ui/lib/table-config";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, mock } from "bun:test";
import {
  columns,
  DATA,
  renderGrid,
  type Row,
  TestDataTable,
} from "./test-support";

// One `ConfirmDeleteDialog` is fed from a row's Delete action, the bulk bar's
// Delete and `useRequestRowDelete()`. Each suite below opens it from one of
// them and confirms through the handler the table routes it to.

const THREE: Row = {
  id: 12,
  title: "Three",
  statusId: null,
  genre: "Rock",
  mastered: false,
  notes: "third",
};
const THREE_ROWS = [...DATA, THREE];

/** A cell that asks the table to confirm a delete, the way a custom column would. */
function RemoveCell({ id, title }: { id: number; title: string }) {
  const request = useRequestRowDelete();
  return request ? (
    <button type="button" onClick={() => request([id], `"${title}"`)}>
      Remove {title}
    </button>
  ) : (
    <span>Cannot delete {title}</span>
  );
}

// Not `/^Remove/`: the column's own header is a sort button named "Remove".
const REMOVE_CELL = /^Remove (One|Two|Three)$/;

const helper = createDataTableHelper<Row>();
const removeColumns = helper.columns([
  helper.accessor((row) => row.title, { id: "title", header: "Title" }),
  helper.accessor((row) => row.id, {
    id: "remove",
    header: "Remove",
    cell: (info) => (
      <RemoveCell id={info.row.original.id} title={info.row.original.title} />
    ),
  }),
]);

function handlers() {
  return {
    onDelete: mock<(id: number) => Promise<{ ok: boolean }>>(async () => ({
      ok: true,
    })),
    onBulkDelete: mock<(selection: BulkSelection) => Promise<{ ok: boolean }>>(
      async () => ({ ok: true })
    ),
  };
}

function renderDeleteGrid(
  overrides: Parameters<typeof renderGrid>[2] = {},
  {
    withRowDelete = true,
    role,
  }: { withRowDelete?: boolean; role?: MemberRole } = {}
) {
  const { onDelete, onBulkDelete } = handlers();
  const result = renderGrid(role, undefined, {
    data: THREE_ROWS,
    enableSelection: true,
    entityLabel: "track",
    onBulkDelete,
    ...(withRowDelete
      ? { rowActions: { onDelete, label: (row: Row) => row.title } }
      : {}),
    ...overrides,
  });
  const rows = () =>
    Array.from(result.container.querySelectorAll<HTMLElement>("tbody tr"));
  return { ...result, rows, onDelete, onBulkDelete };
}

const rowBoxes = () =>
  screen.getAllByRole<HTMLInputElement>("checkbox", { name: "Select row" });

async function tick(fn: () => void) {
  await act(async () => {
    fn();
  });
}

const selectRows = (...indexes: number[]) =>
  tick(() => {
    for (const index of indexes) fireEvent.click(rowBoxes()[index]!);
  });

async function chooseRowDelete(row: HTMLElement | undefined, name: string) {
  if (!row) throw new Error("no row");
  await tick(() => fireEvent.contextMenu(row));
  await tick(() =>
    fireEvent.click(screen.getByRole("menuitem", { name: name }))
  );
}

const dialog = (title: string) =>
  screen.findByRole("alertdialog", { name: title });

const confirm = async (open: HTMLElement) =>
  tick(() =>
    fireEvent.click(within(open).getByRole("button", { name: "Delete" }))
  );

const checkedRows = () =>
  rowBoxes()
    .map((box, index) => (box.checked ? index : -1))
    .filter((index) => index >= 0);

describe("DataTable delete confirmation opened from a row's Delete action", () => {
  it("names the row by its label", async () => {
    const { rows } = renderDeleteGrid();

    await chooseRowDelete(rows()[0], "Delete");

    expect(await dialog('Delete "One"?')).toBeTruthy();
  });

  it("names the row by the entity label when the table has no row label", async () => {
    const { rows } = renderDeleteGrid({
      rowActions: { onDelete: mock(async () => ({ ok: true })) },
    });

    await chooseRowDelete(rows()[0], "Delete");

    expect(await dialog("Delete this track?")).toBeTruthy();
  });

  it("offers no Delete on a table with no row delete and no bulk delete", async () => {
    const { rows } = renderDeleteGrid(
      { onBulkDelete: undefined },
      { withRowDelete: false }
    );

    await tick(() => fireEvent.contextMenu(rows()[0]!));

    expect(screen.queryByRole("menuitem", { name: "Delete" })).toBeNull();
  });

  it("deletes the one row through rowActions.onDelete and leaves the selection alone", async () => {
    const { rows, onDelete, onBulkDelete } = renderDeleteGrid();
    await selectRows(1);

    await chooseRowDelete(rows()[0], "Delete");
    await confirm(await dialog('Delete "One"?'));

    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith(10);
    expect(onBulkDelete).not.toHaveBeenCalled();
    expect(checkedRows()).toEqual([1]);
  });

  // Pinned as written: a selection of exactly one is a single-row target, so
  // deleting that very row takes the per-row path, which never clears the
  // selection.
  it("keeps the row ticked when it is the lone selected row and is deleted", async () => {
    const { rows, onDelete, onBulkDelete } = renderDeleteGrid();
    await selectRows(0);

    await chooseRowDelete(rows()[0], "Delete");
    await confirm(await dialog('Delete "One"?'));

    expect(onDelete).toHaveBeenCalledWith(10);
    expect(onBulkDelete).not.toHaveBeenCalled();
    expect(checkedRows()).toEqual([0]);
  });
});

describe("DataTable row Delete inside a multi-row selection", () => {
  it("offers Delete for the whole selection and confirms it as one bulk delete", async () => {
    const { rows, onDelete, onBulkDelete } = renderDeleteGrid();
    await selectRows(0, 1);

    await chooseRowDelete(rows()[0], "Delete 2 tracks");
    await confirm(await dialog("Delete 2 tracks?"));

    expect(onBulkDelete).toHaveBeenCalledTimes(1);
    expect(onBulkDelete).toHaveBeenCalledWith({ ids: [10, 11] });
    expect(onDelete).not.toHaveBeenCalled();
    expect(checkedRows()).toEqual([]);
  });

  it("targets only the row when it sits outside the selection", async () => {
    const { rows, onDelete, onBulkDelete } = renderDeleteGrid();
    await selectRows(0, 1);

    await chooseRowDelete(rows()[2], "Delete");
    await confirm(await dialog('Delete "Three"?'));

    expect(onDelete).toHaveBeenCalledWith(12);
    expect(onBulkDelete).not.toHaveBeenCalled();
    expect(checkedRows()).toEqual([0, 1]);
  });

  it("offers no Delete for a selection when the table has no bulk delete", async () => {
    const { rows } = renderDeleteGrid({ onBulkDelete: undefined });
    await selectRows(0, 1);

    await tick(() => fireEvent.contextMenu(rows()[0]!));

    expect(screen.queryByRole("menuitem", { name: /^Delete/ })).toBeNull();
  });
});

describe("DataTable delete confirmation opened from the bulk bar", () => {
  it("counts the selected rows in the title", async () => {
    renderDeleteGrid();
    await selectRows(0, 1);

    await tick(() =>
      fireEvent.click(screen.getByRole("button", { name: "Delete" }))
    );

    expect(await dialog("Delete 2 tracks?")).toBeTruthy();
  });

  it("uses the singular for one selected row", async () => {
    renderDeleteGrid();
    await selectRows(2);

    await tick(() =>
      fireEvent.click(screen.getByRole("button", { name: "Delete" }))
    );

    expect(await dialog("Delete 1 track?")).toBeTruthy();
  });

  it("confirms through onBulkDelete, never onDelete, and clears the selection", async () => {
    const { onDelete, onBulkDelete } = renderDeleteGrid();
    await selectRows(0, 2);

    await tick(() =>
      fireEvent.click(screen.getByRole("button", { name: "Delete" }))
    );
    await confirm(await dialog("Delete 2 tracks?"));

    expect(onBulkDelete).toHaveBeenCalledWith({ ids: [10, 12] });
    expect(onDelete).not.toHaveBeenCalled();
    expect(checkedRows()).toEqual([]);
  });

  it("keeps the selection when the bulk delete fails", async () => {
    const onBulkDelete = mock<
      (selection: BulkSelection) => Promise<{ ok: boolean }>
    >(async () => ({ ok: false }));
    renderDeleteGrid({ onBulkDelete });
    await selectRows(0, 1);

    await tick(() =>
      fireEvent.click(screen.getByRole("button", { name: "Delete" }))
    );
    await confirm(await dialog("Delete 2 tracks?"));

    expect(onBulkDelete).toHaveBeenCalledTimes(1);
    expect(checkedRows()).toEqual([0, 1]);
  });

  it("offers no bar Delete without a bulk delete handler", async () => {
    renderDeleteGrid({ onBulkDelete: undefined });
    await selectRows(0, 1);

    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });
});

describe("DataTable delete confirmation opened through useRequestRowDelete", () => {
  it("opens the dialog with the label the cell passed", async () => {
    renderDeleteGrid({ columns: removeColumns });

    await tick(() =>
      fireEvent.click(screen.getByRole("button", { name: "Remove Two" }))
    );

    expect(await dialog('Delete "Two"?')).toBeTruthy();
  });

  it("confirms one id through rowActions.onDelete when the table has it", async () => {
    const { onDelete, onBulkDelete } = renderDeleteGrid({
      columns: removeColumns,
    });

    await tick(() =>
      fireEvent.click(screen.getByRole("button", { name: "Remove Two" }))
    );
    await confirm(await dialog('Delete "Two"?'));

    expect(onDelete).toHaveBeenCalledWith(11);
    expect(onBulkDelete).not.toHaveBeenCalled();
  });

  it("confirms one id as a one-row bulk delete when the table has no row delete", async () => {
    const { onBulkDelete } = renderDeleteGrid(
      { columns: removeColumns },
      { withRowDelete: false }
    );

    await tick(() =>
      fireEvent.click(screen.getByRole("button", { name: "Remove Two" }))
    );
    await confirm(await dialog('Delete "Two"?'));

    expect(onBulkDelete).toHaveBeenCalledWith({ ids: [11] });
  });

  it("yields null when the table has neither handler", () => {
    renderDeleteGrid(
      { columns: removeColumns, onBulkDelete: undefined },
      { withRowDelete: false }
    );

    expect(screen.getAllByText(/^Cannot delete /)).toHaveLength(3);
    expect(screen.queryByRole("button", { name: REMOVE_CELL })).toBeNull();
  });

  it("yields null for a viewer even when the handlers are passed", () => {
    renderDeleteGrid({ columns: removeColumns }, { role: "viewer" });

    expect(screen.getAllByText(/^Cannot delete /)).toHaveLength(3);
    expect(screen.queryByRole("button", { name: REMOVE_CELL })).toBeNull();
  });
});

describe("DataTable delete behind the feedback policy's gate", () => {
  const confirmsOff = (kind: DeleteKind) => ({
    ...DEFAULT_POLICIES,
    feedback: {
      ...DEFAULT_POLICIES.feedback,
      confirmDeletes: {
        ...DEFAULT_POLICIES.feedback.confirmDeletes,
        [kind]: false,
      },
    },
  });

  function renderUnder(off: DeleteKind) {
    const { onDelete, onBulkDelete } = handlers();
    const result = render(
      <PoliciesProvider policies={confirmsOff(off)}>
        <TestDataTable
          data={THREE_ROWS}
          columns={columns}
          persistStateInUrl={false}
          enableSelection
          entityLabel="track"
          deleteKind="track"
          onBulkDelete={onBulkDelete}
          rowActions={{ onDelete, label: (row: Row) => row.title }}
        />
      </PoliciesProvider>
    );
    const rows = () =>
      Array.from(result.container.querySelectorAll<HTMLElement>("tbody tr"));
    return { rows, onDelete, onBulkDelete };
  }

  it("deletes a row at once, unasked, when the table's kind does not confirm", async () => {
    const { rows, onDelete } = renderUnder("track");

    await chooseRowDelete(rows()[0], "Delete");

    expect(onDelete).toHaveBeenCalledWith(10);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("deletes a selection at once from the bulk bar too", async () => {
    const { onBulkDelete } = renderUnder("track");
    await selectRows(0, 1);

    await tick(() =>
      fireEvent.click(screen.getByRole("button", { name: /^Delete/ }))
    );

    expect(onBulkDelete).toHaveBeenCalledWith({ ids: [10, 11] });
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("still asks when only another kind's confirm is off", async () => {
    const { rows, onDelete } = renderUnder("collection");

    await chooseRowDelete(rows()[0], "Delete");

    expect(await dialog('Delete "One"?')).toBeTruthy();
    expect(onDelete).not.toHaveBeenCalled();
  });
});

describe("DataTable cancelling the delete confirmation", () => {
  it("calls no handler and leaves the selection as it was", async () => {
    const { rows, onDelete, onBulkDelete } = renderDeleteGrid();
    await selectRows(0, 1);
    await chooseRowDelete(rows()[0], "Delete 2 tracks");

    const open = await dialog("Delete 2 tracks?");
    await tick(() =>
      fireEvent.click(within(open).getByRole("button", { name: "Cancel" }))
    );

    expect(onDelete).not.toHaveBeenCalled();
    expect(onBulkDelete).not.toHaveBeenCalled();
    expect(checkedRows()).toEqual([0, 1]);
  });
});
