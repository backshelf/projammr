import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, mock } from "bun:test";

import { useTableSelection } from "./use-table-selection";

type TestRow = { id: number; title: string };

const ROWS: TestRow[] = [
  { id: 10, title: "One" },
  { id: 11, title: "Two" },
];

type HookProps = Parameters<typeof useTableSelection<TestRow>>[0];

function baseProps(overrides: Partial<HookProps> = {}): HookProps {
  return {
    canEdit: true,
    enableSelection: true,
    data: ROWS,
    rowCount: 5,
    serverDriven: true,
    selectAllMatchingAllowed: true,
    scopeParams: { collection: "3" },
    globalFilter: "demo",
    columnFilters: { status: "2" },
    isPhone: false,
    ...overrides,
  };
}

describe("useTableSelection", () => {
  it("tracks selected ids, allLoadedSelected, and canSelectAllMatching", () => {
    const { result } = renderHook(
      (props: HookProps) => useTableSelection(props),
      {
        initialProps: baseProps(),
      }
    );

    expect(result.current.selectedIds).toEqual([]);
    expect(result.current.allLoadedSelected).toBe(false);
    expect(result.current.canSelectAllMatching).toBe(false);

    act(() => result.current.onRowSelectionChange({ "10": true }));
    expect(result.current.selectedIds).toEqual([10]);
    expect(result.current.allLoadedSelected).toBe(false);
    expect(result.current.canSelectAllMatching).toBe(false);

    act(() => result.current.onRowSelectionChange({ "10": true, "11": true }));
    expect(result.current.selectedIds).toEqual([10, 11]);
    expect(result.current.allLoadedSelected).toBe(true);
    expect(result.current.canSelectAllMatching).toBe(true);
  });

  it("escalates bulkSelection to all-matching with filters and scope, then drops back on toggle", () => {
    const { result } = renderHook(
      (props: HookProps) => useTableSelection(props),
      {
        initialProps: baseProps(),
      }
    );

    act(() => result.current.onRowSelectionChange({ "10": true, "11": true }));
    act(() => result.current.setSelectAllMatching(true));
    expect(result.current.bulkSelection).toEqual({
      all: true,
      q: "demo",
      status: "2",
      collection: "3",
    });

    act(() => result.current.onRowSelectionChange({ "10": true }));
    expect(result.current.selectAllMatching).toBe(false);
    expect(result.current.bulkSelection).toEqual({ ids: [10] });
  });

  it("prunes stale ids when rows leave the loaded window", () => {
    const { result, rerender } = renderHook(
      (props: HookProps) => useTableSelection(props),
      { initialProps: baseProps() }
    );

    act(() => result.current.onRowSelectionChange({ "10": true, "11": true }));
    expect(result.current.selectedIds).toEqual([10, 11]);

    rerender(baseProps({ data: [ROWS[0]!] }));
    expect(result.current.selectedIds).toEqual([10]);
  });

  it("clears selection and notifies the table reset ref", () => {
    const resetFn = mock();
    const resetRef = { current: resetFn };
    const { result } = renderHook(
      (props: HookProps) => useTableSelection(props),
      {
        initialProps: baseProps({ resetTableSelectionRef: resetRef }),
      }
    );

    act(() => {
      result.current.onRowSelectionChange({ "10": true, "11": true });
      result.current.setSelectAllMatching(true);
    });
    act(() => result.current.clearSelection());

    expect(result.current.selectedIds).toEqual([]);
    expect(result.current.selectAllMatching).toBe(false);
    expect(resetFn).toHaveBeenCalledTimes(1);
  });

  it("exits phone selectMode on exitSelectMode or when leaving the phone tier", () => {
    const { result, rerender } = renderHook(
      (props: HookProps) => useTableSelection(props),
      { initialProps: baseProps({ isPhone: true }) }
    );

    act(() => {
      result.current.setSelectMode(true);
      result.current.onRowSelectionChange({ "10": true });
    });
    expect(result.current.selectMode).toBe(true);

    act(() => result.current.exitSelectMode());
    expect(result.current.selectMode).toBe(false);
    expect(result.current.selectedIds).toEqual([]);

    act(() => result.current.setSelectMode(true));
    rerender(baseProps({ isPhone: false }));
    expect(result.current.selectMode).toBe(false);
  });

  it("keeps config identity stable across selection changes", () => {
    const { result } = renderHook(
      (props: HookProps) => useTableSelection(props),
      {
        initialProps: baseProps(),
      }
    );
    const initialConfig = result.current.config;

    act(() => result.current.onRowSelectionChange({ "10": true }));
    expect(result.current.config).toBe(initialConfig);
  });
});
