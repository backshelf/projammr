import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "bun:test";

import type { TableRowModel } from "./data-table-context";
import { EXPAND_COLUMN, SELECT_COLUMN } from "./leading-columns";
import { columns, DATA, type Row, routerMock } from "./test-support";

const { useTableSections, useTableView } = await import("./use-table-view");

function fakeRow(row: Row, depth = 0): TableRowModel<Row> {
  return { original: row, depth } as unknown as TableRowModel<Row>;
}

describe("useTableView", () => {
  it("prepends disclosure and selection columns in order when enabled", () => {
    const { result: bare } = renderHook(() => useTableView({ columns }, false));
    expect(bare.current.columns).toBe(columns);
    expect(bare.current.config.leadingColumnCount).toBe(0);

    const { result: selectable } = renderHook(() =>
      useTableView({ columns }, true)
    );
    expect(selectable.current.columns[0]?.id).toBe(SELECT_COLUMN.id);
    expect(selectable.current.config.leadingColumnCount).toBe(1);

    const { result: both } = renderHook(() =>
      useTableView(
        {
          columns,
          subRows: { getRows: () => [], cells: {} },
        },
        true
      )
    );
    expect(both.current.columns[0]?.id).toBe(EXPAND_COLUMN.id);
    expect(both.current.columns[1]?.id).toBe(SELECT_COLUMN.id);
    expect(both.current.config.leadingColumnCount).toBe(2);
  });

  it("merges initiallyHiddenColumns only for keys absent from urlState", () => {
    const { result } = renderHook(() =>
      useTableView(
        { columns, initiallyHiddenColumns: ["notes", "genre"] },
        false
      )
    );
    expect(result.current.columnVisibility).toEqual({
      notes: false,
      genre: false,
    });

    act(() => result.current.urlState.setColumnVisibility({ notes: true }));
    expect(result.current.columnVisibility).toEqual({
      notes: true,
      genre: false,
    });
  });

  it("navigates via peek.href on openRow and strips inUrl from peek config", () => {
    const { result } = renderHook(() =>
      useTableView(
        {
          columns,
          peek: {
            inUrl: true,
            titleField: "title",
            href: (row: Row) => `/tracks/${row.id}`,
            toPeekRow: (row: Row) => ({
              id: row.id,
              title: row.title,
              fields: [],
            }),
          },
        },
        false
      )
    );

    expect("inUrl" in (result.current.peek ?? {})).toBe(false);
    act(() => result.current.openRow(DATA[0]!));
    expect(routerMock.push).toHaveBeenCalledWith("/tracks/10");
  });
});

describe("useTableSections", () => {
  it("filters topLevelRows and computes section drill-in using only depth-0 rows", () => {
    const pageRows = [
      fakeRow(DATA[0]!, 0),
      fakeRow(DATA[0]!, 1),
      fakeRow(DATA[1]!, 0),
    ];

    const { result } = renderHook(() =>
      useTableSections<Row>({
        pageRows,
        groupingEnabled: true,
        activeGroupKey: "genre",
        groupFilterParam: "genre",
        getRowGroupKey: (row) => row.genre,
        serverGroups: [
          { key: "Rock", label: "Rock", count: 2 },
          { key: "Pop", label: "Pop", count: 1 },
        ],
      })
    );

    expect(result.current.topLevelRows).toHaveLength(2);
    expect(result.current.sections).toHaveLength(2);

    // Rock has 2 items in pageRows (1 parent + 1 child), but only 1 top-level
    // row against server count 2, so drill-in must still be offered.
    const rock = result.current.sections![0]!;
    const pop = result.current.sections![1]!;
    expect(result.current.drillInFor(rock)).toEqual({
      param: "genre",
      value: "Rock",
    });
    expect(result.current.drillInFor(pop)).toBeNull();
  });

  it("returns null sections when grouping is inactive", () => {
    const { result } = renderHook(() =>
      useTableSections<Row>({
        pageRows: [fakeRow(DATA[0]!, 0)],
        groupingEnabled: false,
        activeGroupKey: null,
        groupFilterParam: undefined,
        getRowGroupKey: undefined,
        serverGroups: undefined,
      })
    );
    expect(result.current.sections).toBeNull();
  });
});
