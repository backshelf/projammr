import { stubGlobal } from "@workspace/test/globals";
import { beforeEach, describe, expect, it, mock } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import type React from "react";

import type { EditableCellConfig } from "./generic-table-types";

const toastError = mock();
mock.module("sonner", () => ({ toast: { error: toastError } }));

const { useCellClipboard } = await import("./use-cell-clipboard");

type Options = Parameters<typeof useCellClipboard>[0];

const COLUMN_IDS = ["title", "bpm"];
const EDITABLE: Record<string, EditableCellConfig> = {
  title: { type: "text", required: true },
  bpm: { type: "number" },
};

const BASE_ROWS = [
  { id: "0", original: { id: 10 } },
  { id: "1", original: { id: 11 } },
];

const table = {
  getSelectedCellRangesData: () => [],
  getFocusedCell: () => ({ row: { id: "0" }, column: { id: "title" } }),
  getRowModel: () => ({ rows: BASE_ROWS }),
  getAllLeafColumns: () => COLUMN_IDS.map((id) => ({ id })),
  getCellSelectionBounds: () => [],
  extendCellSelection: () => {},
  moveCellSelection: () => {},
  selectAllCells: () => {},
  resetCellSelection: () => {},
};

const ensureLoadedFalse = () => Promise.resolve(false);

function options(overrides: Partial<Options> = {}): Options {
  return {
    table,
    editableCells: EDITABLE,
    selectableColumnIds: new Set(COLUMN_IDS),
    editing: null,
    entryOf: () => "editor",
    seedableOf: () => true,
    dispatch: () => ({ type: "none" }),
    saveCell: mock(async () => true),
    ensureLoaded: ensureLoadedFalse,
    hasMore: false,
    loadFailed: false,
    revealCell: mock(),
    scrollToIndex: { current: null },
    ...overrides,
  };
}

async function paste(
  text: string,
  saveCell: (rowId: number, field: string, value: unknown) => Promise<boolean>
) {
  const { result } = renderHook(() => useCellClipboard(options({ saveCell })));
  result.current.onPaste({
    preventDefault: () => {},
    clipboardData: { getData: () => text },
  } as unknown as React.ClipboardEvent<HTMLDivElement>);
  // `onPaste` starts the async paste and returns; let its saves settle.
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("useCellClipboard paste", () => {
  beforeEach(() => toastError.mockClear());

  it("toasts the skipped count once and saves nothing when every cell is rejected", async () => {
    const saveCell = mock(async () => true);
    await paste("\tabc\n\tabc", saveCell);
    expect(saveCell).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith(
      "4 cell(s) skipped: not valid for their column"
    );
  });

  it("toasts the failed save and the skipped cell from one paste", async () => {
    const saveCell = mock(async () => false);
    await paste("Song\tabc", saveCell);
    expect(saveCell).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledTimes(2);
    expect(toastError).toHaveBeenCalledWith("1 cell(s) failed to paste");
    expect(toastError).toHaveBeenCalledWith(
      "1 cell(s) skipped: not valid for their column"
    );
  });

  it("does not toast when every cell saves", async () => {
    const saveCell = mock(async () => true);
    await paste("Song\t120", saveCell);
    expect(saveCell).toHaveBeenCalledTimes(2);
    expect(toastError).not.toHaveBeenCalled();
  });
});

describe("useCellClipboard copy", () => {
  it("copies the selection's row values, not anything from the DOM", () => {
    const writeText = mock(() => Promise.resolve());
    stubGlobal("navigator", { clipboard: { writeText } });

    // A rectangle spanning a row that is not mounted has nothing to read
    // from the DOM; the feature hands back its values from the row model
    // regardless, which is all `copySelection` ever reads.
    const regions = [
      [
        ["Song A", 118],
        ["Song B", 140],
      ],
    ];
    const rangesTable = {
      ...table,
      getSelectedCellRangesData: () => regions,
    };

    const { result } = renderHook(() =>
      useCellClipboard(options({ table: rangesTable }))
    );

    result.current.surface.copy();

    expect(writeText).toHaveBeenCalledWith("Song A\t118\nSong B\t140");
  });
});

describe("useCellClipboard paste past the loaded window", () => {
  beforeEach(() => toastError.mockClear());

  it("loads one more page at the second-last loaded row and writes all 3 rows", async () => {
    let rows = [...BASE_ROWS];
    const growingTable = {
      ...table,
      getRowModel: () => ({ rows }),
    };
    const ensureLoaded = mock(async (index: number) => {
      expect(index).toBe(2);
      rows = [...rows, { id: "2", original: { id: 12 } }];
      return true;
    });
    const saveCell = mock(async () => true);

    const { result } = renderHook(() =>
      useCellClipboard(
        options({ table: growingTable, ensureLoaded, saveCell, hasMore: true })
      )
    );

    await act(async () => {
      result.current.onPaste({
        preventDefault: () => {},
        clipboardData: { getData: () => "A\nB\nC" },
      } as unknown as React.ClipboardEvent<HTMLDivElement>);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(ensureLoaded).toHaveBeenCalledWith(2);
    expect(saveCell).toHaveBeenCalledTimes(3);
    expect(saveCell).toHaveBeenCalledWith(10, "title", "A");
    expect(saveCell).toHaveBeenCalledWith(11, "title", "B");
    expect(saveCell).toHaveBeenCalledWith(12, "title", "C");
    expect(toastError).not.toHaveBeenCalled();
  });

  async function pasteAfterLoad(overrides: Partial<Options>) {
    const saveCell = mock(async () => true);
    const { result } = renderHook(() =>
      useCellClipboard(options({ saveCell, hasMore: true, ...overrides }))
    );
    await act(async () => {
      result.current.onPaste({
        preventDefault: () => {},
        clipboardData: { getData: () => "A\nB\nC" },
      } as unknown as React.ClipboardEvent<HTMLDivElement>);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    return saveCell;
  }

  it("writes nothing and leaves things as they were when the load fails", async () => {
    const ensureLoaded = mock(async () => false);
    const saveCell = await pasteAfterLoad({ ensureLoaded, loadFailed: true });

    expect(ensureLoaded).toHaveBeenCalledWith(2);
    expect(saveCell).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it("writes what exists and stops when the server has no more rows", async () => {
    const saveCell = await pasteAfterLoad({
      ensureLoaded: mock(async () => false),
    });

    expect(saveCell).toHaveBeenCalledTimes(2);
    expect(saveCell).toHaveBeenCalledWith(10, "title", "A");
    expect(saveCell).toHaveBeenCalledWith(11, "title", "B");
    expect(toastError).not.toHaveBeenCalled();
  });

  it("writes nothing when the view changed under the load", async () => {
    let rows = [...BASE_ROWS];
    const saveCell = await pasteAfterLoad({
      table: { ...table, getRowModel: () => ({ rows }) },
      ensureLoaded: mock(async () => {
        rows = [{ id: "7", original: { id: 70 } }];
        return false;
      }),
    });

    expect(saveCell).not.toHaveBeenCalled();
  });
});

describe("useCellClipboard arrow-down past the loaded window", () => {
  it("loads the next page at the last loaded row, then moves onto it and reveals it", async () => {
    let rows = [...BASE_ROWS];
    const moveCellSelection = mock();
    const revealCell = mock();
    const growingTable = {
      ...table,
      getFocusedCell: () => ({ row: { id: "1" }, column: { id: "title" } }),
      getRowModel: () => ({ rows }),
      moveCellSelection,
    };
    const ensureLoaded = mock(async (index: number) => {
      expect(index).toBe(2);
      rows = [...rows, { id: "2", original: { id: 12 } }];
      return true;
    });

    const { result } = renderHook(() =>
      useCellClipboard(
        options({
          table: growingTable,
          ensureLoaded,
          hasMore: true,
          revealCell,
        })
      )
    );

    await act(async () => {
      result.current.surface.move("down");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(ensureLoaded).toHaveBeenCalledWith(2);
    expect(moveCellSelection).toHaveBeenCalledWith("down");
    expect(revealCell).toHaveBeenCalledWith("1", "title");
  });

  it("leaves the feature's own clamp to stand when nothing more can load", async () => {
    const moveCellSelection = mock();
    const revealCell = mock();
    const clampedTable = {
      ...table,
      getFocusedCell: () => ({ row: { id: "1" }, column: { id: "title" } }),
      moveCellSelection,
    };
    const ensureLoaded = mock(async () => false);

    const { result } = renderHook(() =>
      useCellClipboard(
        options({
          table: clampedTable,
          ensureLoaded,
          hasMore: false,
          revealCell,
        })
      )
    );

    act(() => {
      result.current.surface.move("down");
    });

    expect(ensureLoaded).not.toHaveBeenCalled();
    expect(moveCellSelection).toHaveBeenCalledWith("down");
    expect(revealCell).toHaveBeenCalledWith("1", "title");
  });
});

describe("useCellClipboard reveals the DOM as the selection moves", () => {
  it("reveals and focuses the new cell after a plain arrow move", () => {
    const revealCell = mock();
    const moveCellSelection = mock();
    const movedTable = {
      ...table,
      getFocusedCell: () => ({ row: { id: "1" }, column: { id: "bpm" } }),
      moveCellSelection,
    };

    const { result } = renderHook(() =>
      useCellClipboard(options({ table: movedTable, revealCell }))
    );

    act(() => {
      result.current.surface.move("right");
    });

    expect(moveCellSelection).toHaveBeenCalledWith("right");
    expect(revealCell).toHaveBeenCalledWith("1", "bpm");
  });

  it("reveals the cell select-all lands the anchor on", () => {
    const revealCell = mock();
    const selectAllCells = mock();
    const selectedTable = {
      ...table,
      getFocusedCell: () => ({ row: { id: "0" }, column: { id: "title" } }),
      selectAllCells,
    };

    const { result } = renderHook(() =>
      useCellClipboard(options({ table: selectedTable, revealCell }))
    );

    act(() => {
      result.current.surface.selectAll();
    });

    expect(selectAllCells).toHaveBeenCalledTimes(1);
    expect(revealCell).toHaveBeenCalledWith("0", "title");
  });

  it("scrolls to the moving edge on shift+ArrowDown, without stealing focus", () => {
    const revealCell = mock();
    const scrollToIndex = { current: mock() };
    const extendCellSelection = mock();
    const boundsTable = {
      ...table,
      extendCellSelection,
      getCellSelectionBounds: () => [
        {
          minRowIndex: 0,
          maxRowIndex: 3,
          minColumnIndex: 0,
          maxColumnIndex: 0,
        },
      ],
    };

    const { result } = renderHook(() =>
      useCellClipboard(
        options({ table: boundsTable, revealCell, scrollToIndex })
      )
    );

    act(() => {
      result.current.surface.extend("down");
    });

    expect(extendCellSelection).toHaveBeenCalledWith("down");
    expect(scrollToIndex.current).toHaveBeenCalledWith(3);
    expect(revealCell).not.toHaveBeenCalled();
  });

  it("scrolls to the top edge on shift+ArrowUp", () => {
    const scrollToIndex = { current: mock() };
    const boundsTable = {
      ...table,
      getCellSelectionBounds: () => [
        {
          minRowIndex: 1,
          maxRowIndex: 4,
          minColumnIndex: 0,
          maxColumnIndex: 0,
        },
      ],
    };

    const { result } = renderHook(() =>
      useCellClipboard(options({ table: boundsTable, scrollToIndex }))
    );

    act(() => {
      result.current.surface.extend("up");
    });

    expect(scrollToIndex.current).toHaveBeenCalledWith(1);
  });
});
