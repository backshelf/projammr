import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, mock } from "bun:test";

import { useTableDelete } from "./use-table-delete";

describe("useTableDelete", () => {
  it("reports canDelete false when neither delete handler is provided", () => {
    const { result } = renderHook(() =>
      useTableDelete({
        deleteKind: "track",
        entityLabel: "track",
        onRowDelete: undefined,
        onBulkDelete: undefined,
        clearSelection: mock(),
      })
    );
    expect(result.current.canDelete).toBe(false);
  });

  it("routes single-id deletes to onRowDelete without clearing selection", async () => {
    const onRowDelete = mock(async () => ({ ok: true }));
    const onBulkDelete = mock(async () => ({ ok: true }));
    const clearSelection = mock();

    const { result } = renderHook(() =>
      useTableDelete({
        deleteKind: "track",
        entityLabel: "track",
        onRowDelete,
        onBulkDelete,
        clearSelection,
      })
    );

    act(() => result.current.requestRowDelete([10], '"One"'));
    expect(result.current.dialog.open).toBe(true);
    expect(result.current.pendingDelete).toEqual({
      selection: { ids: [10] },
      label: '"One"',
    });

    await act(async () => {
      await result.current.dialog.onConfirm();
    });

    expect(onRowDelete).toHaveBeenCalledWith(10);
    expect(onBulkDelete).not.toHaveBeenCalled();
    expect(clearSelection).not.toHaveBeenCalled();
  });

  it("routes multi-row deletes to onBulkDelete and clears selection only on success", async () => {
    const onRowDelete = mock(async () => ({ ok: true }));
    const onBulkDelete = mock(async () => ({ ok: true, deleted: 2 }));
    const clearSelection = mock();

    const { result } = renderHook(() =>
      useTableDelete({
        deleteKind: "track",
        entityLabel: "track",
        onRowDelete,
        onBulkDelete,
        clearSelection,
      })
    );

    act(() =>
      result.current.requestDelete({
        selection: { ids: [10, 11] },
        label: "2 tracks",
      })
    );
    await act(async () => {
      await result.current.dialog.onConfirm();
    });

    expect(onBulkDelete).toHaveBeenCalledWith({ ids: [10, 11] });
    expect(onRowDelete).not.toHaveBeenCalled();
    expect(clearSelection).toHaveBeenCalledTimes(1);
  });

  it("keeps selection when onBulkDelete returns ok: false", async () => {
    const onBulkDelete = mock(async () => ({ ok: false }));
    const clearSelection = mock();

    const { result } = renderHook(() =>
      useTableDelete({
        deleteKind: "track",
        entityLabel: "track",
        onRowDelete: undefined,
        onBulkDelete,
        clearSelection,
      })
    );

    act(() => result.current.requestRowDelete([10], '"One"'));
    await act(async () => {
      await result.current.dialog.onConfirm();
    });

    expect(onBulkDelete).toHaveBeenCalledWith({ ids: [10] });
    expect(clearSelection).not.toHaveBeenCalled();
  });
});
