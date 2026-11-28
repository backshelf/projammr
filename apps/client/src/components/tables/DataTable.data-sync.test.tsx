import { act, fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, mock } from "bun:test";
import {
  DATA,
  deferredLoad,
  mixing,
  press,
  renderGrid,
  type Row,
  rowsOf,
  stateProbe,
} from "./test-support";

/** A save whose outcome the test decides, and the calls it has received. */
function deferredSave() {
  let settle: (ok: boolean) => void = () => {};
  const save = mock(
    () =>
      new Promise<boolean>((resolve) => {
        settle = resolve;
      })
  );
  return {
    save,
    settle: (ok: boolean) =>
      act(async () => {
        settle(ok);
      }),
  };
}

// The mirror of `data` a cell edit patches at once, and puts back when the save
// comes back `false`. Every other suite resolves `true`, so the rollback and
// the per-row bookkeeping around it are only reachable here.
describe("DataTable optimistic save", () => {
  const box = (cell: HTMLElement) =>
    cell.querySelector<HTMLInputElement>("input[type='checkbox']");

  const toggleMastered = (cell: (key: string) => HTMLElement, id: number) => {
    const control = cell(`${id}::mastered`).querySelector<HTMLElement>(
      "[data-cell-control]"
    );
    if (!control) throw new Error("no cell control");
    press(control);
  };

  const chooseMixing = async (cell: (key: string) => HTMLElement) => {
    press(cell("11::status"));
    await act(async () => {
      fireEvent.keyDown(cell("11::status"), { key: "Enter" });
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole("option", { name: /Mixing/ }));
    });
  };

  it("shows an edit before the save resolves", async () => {
    const { save } = deferredSave();
    const { cell } = renderGrid(undefined, undefined, { onCellSave: save });
    expect(box(cell("10::mastered"))?.checked).toBe(false);

    await act(async () => {
      toggleMastered(cell, 10);
    });

    expect(save).toHaveBeenCalledWith(10, "mastered", true);
    expect(box(cell("10::mastered"))?.checked).toBe(true);
  });

  it("keeps the edit once the save resolves true", async () => {
    const { save, settle } = deferredSave();
    const { cell } = renderGrid(undefined, undefined, { onCellSave: save });
    await act(async () => {
      toggleMastered(cell, 10);
    });

    await settle(true);

    expect(box(cell("10::mastered"))?.checked).toBe(true);
  });

  it("restores the value the row had when the save resolves false", async () => {
    const { save, settle } = deferredSave();
    const { cell } = renderGrid(undefined, undefined, { onCellSave: save });
    await act(async () => {
      toggleMastered(cell, 10);
    });
    expect(box(cell("10::mastered"))?.checked).toBe(true);

    await settle(false);

    expect(box(cell("10::mastered"))?.checked).toBe(false);
  });

  it("patches a status edit through the kind's optimistic patch and rolls it back", async () => {
    const { save, settle } = deferredSave();
    const { cell } = renderGrid(undefined, undefined, { onCellSave: save });
    expect(cell("11::status").textContent).toContain("none");

    await chooseMixing(cell);

    expect(save).toHaveBeenCalledWith(11, "statusId", mixing.id);
    expect(cell("11::status").textContent).toMatch(/mixing/i);

    await settle(false);

    expect(cell("11::status").textContent).toContain("none");
    expect(cell("11::status").textContent).not.toMatch(/mixing/i);
  });

  it("keeps an edit made to another row while the first save rolls back", async () => {
    const settlers: Array<(ok: boolean) => void> = [];
    const save = mock(
      () =>
        new Promise<boolean>((resolve) => {
          settlers.push(resolve);
        })
    );
    const { cell } = renderGrid(undefined, undefined, { onCellSave: save });

    await act(async () => {
      toggleMastered(cell, 10);
    });
    await act(async () => {
      toggleMastered(cell, 11);
    });
    expect(box(cell("10::mastered"))?.checked).toBe(true);
    expect(box(cell("11::mastered"))?.checked).toBe(true);

    await act(async () => {
      settlers[0]?.(false);
    });

    expect(box(cell("10::mastered"))?.checked).toBe(false);
    expect(box(cell("11::mastered"))?.checked).toBe(true);

    await act(async () => {
      settlers[1]?.(true);
    });

    expect(box(cell("11::mastered"))?.checked).toBe(true);
  });
});

// Selection is private state, so it is read through the bulk bar's count.
describe("DataTable selection follows the loaded rows", () => {
  const THIRD: Row = {
    id: 12,
    title: "Three",
    statusId: null,
    genre: "Rock",
    mastered: false,
    notes: "third",
  };
  const THREE = [...DATA, THIRD];

  const selectRows = async (...indexes: number[]) => {
    for (const index of indexes) {
      await act(async () => {
        fireEvent.click(
          screen.getAllByRole("checkbox", { name: "Select row" })[index]!
        );
      });
    }
  };
  // The bar's own count, not the status region that announces the same words.
  const bar = () =>
    screen.queryByText(/ selected$/, {
      ignore: "script, style, [role=status]",
    });

  it("drops a selected row that leaves the data from the count", async () => {
    const { rerender, gridFor } = renderGrid(undefined, undefined, {
      data: THREE,
      enableSelection: true,
    });
    await selectRows(0, 1);
    expect(bar()?.textContent).toContain("2");

    await act(async () => {
      rerender(gridFor({ data: [DATA[0]!, THIRD] }));
    });

    expect(bar()?.textContent).toContain("1");
    expect(bar()?.textContent).not.toContain("2");
  });

  it("leaves the count alone when every selected row is still loaded", async () => {
    const { rerender, gridFor } = renderGrid(undefined, undefined, {
      data: THREE,
      enableSelection: true,
    });
    await selectRows(0, 1);

    await act(async () => {
      rerender(gridFor({ data: [DATA[0]!, DATA[1]!] }));
    });

    expect(bar()?.textContent).toContain("2");
  });

  // The bar leaves through an exit animation that needs the app's
  // `MotionProvider`, which the harness does not mount, so under test the
  // leaving bar stays in the DOM with its last count. What shows the selection
  // emptied is the count a new tick starts from: 1, not 3 with the two dropped
  // ids still held.
  it("starts the selection over when every selected row leaves the data", async () => {
    const { rerender, gridFor } = renderGrid(undefined, undefined, {
      data: THREE,
      enableSelection: true,
    });
    await selectRows(0, 1);
    expect(bar()?.textContent).toContain("2");

    await act(async () => {
      rerender(gridFor({ data: [THIRD] }));
    });
    await selectRows(0);

    expect(bar()?.textContent).toBe("1 row selected");
  });

  // Page 1 is the `data` prop; page 2 was appended, so its rows are loaded
  // without ever being in the prop.
  it("keeps the selection through a refetch for the ids still loaded", async () => {
    const { load, calls, settle } = deferredLoad();
    const probe = stateProbe();
    const { rerender, gridFor } = renderGrid(undefined, undefined, {
      data: rowsOf(2),
      enableSelection: true,
      persistStateInUrl: false,
      serverPage: { rowCount: 4, load },
      children: <probe.Probe />,
    });
    let appended: Promise<void> | undefined;
    await act(async () => {
      appended = probe.state().loadMore();
    });
    await settle(calls[0], { rows: rowsOf(2, 3), rowCount: 4, pageSize: 2 });
    await appended;

    await selectRows(0, 3);
    expect(bar()?.textContent).toContain("2");

    // A new prop without row 4: the window still holds it while the refetch
    // runs.
    await act(async () => {
      rerender(gridFor({ data: rowsOf(2, 2) }));
    });
    expect(bar()?.textContent).toContain("2");

    // The refetch drops row 1 and keeps row 4.
    await settle(calls[1], { rows: rowsOf(2, 2), rowCount: 3, pageSize: 2 });
    await settle(calls[2], { rows: rowsOf(1, 4), rowCount: 3, pageSize: 2 });

    expect(bar()?.textContent).toContain("1");
    expect(bar()?.textContent).not.toContain("2");
  });
});
