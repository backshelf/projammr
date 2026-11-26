import { describe, expect, it } from "bun:test";

import {
  activeFilterCount,
  sortRowsFrom,
  type SortableColumn,
} from "./filter-sheet";
import type { FilterColumnConfig } from "../generic-table-types";

const filterColumns: FilterColumnConfig[] = [
  { id: "status", label: "Status", param: "status", options: [] },
  { id: "collection", label: "Collection", param: "collection", options: [] },
];

describe("activeFilterCount", () => {
  it("is zero with no filter params set", () => {
    expect(activeFilterCount({}, filterColumns)).toBe(0);
  });

  it("counts one set param", () => {
    expect(activeFilterCount({ status: "3" }, filterColumns)).toBe(1);
  });

  it("counts every set param, ignoring params outside the table's filters", () => {
    expect(
      activeFilterCount(
        { status: "3", collection: "7", untracked: "x" },
        filterColumns
      )
    ).toBe(2);
  });

  it("is zero without any filter columns", () => {
    expect(activeFilterCount({ status: "3" }, undefined)).toBe(0);
  });
});

/** Models a TanStack leaf column's real default sort cycle: unsorted → asc →
 *  desc → unsorted, entered through `toggleSorting()` the same way a header
 *  click drives it. */
function fakeSortableColumn(id: string, label: string): SortableColumn {
  let direction: false | "asc" | "desc" = false;
  return {
    id,
    columnDef: { header: label },
    getIsSorted: () => direction,
    toggleSorting: () => {
      direction =
        direction === false ? "asc" : direction === "asc" ? "desc" : false;
    },
  };
}

describe("sortRowsFrom", () => {
  it("resolves each row's label from the column header, falling back to its id", () => {
    const labelled = fakeSortableColumn("bpm", "BPM");
    const unlabelled: SortableColumn = {
      ...fakeSortableColumn("title", "Title"),
      columnDef: {},
    };
    const [labelledRow, unlabelledRow] = sortRowsFrom([labelled, unlabelled]);
    expect(labelledRow?.label).toBe("BPM");
    expect(unlabelledRow?.label).toBe("title");
  });

  it("cycles a column's direction through asc, desc, then none across three taps", () => {
    const column = fakeSortableColumn("bpm", "BPM");

    const tap = () => sortRowsFrom([column])[0]!;

    expect(tap().direction).toBe(false);

    tap().toggle();
    expect(tap().direction).toBe("asc");

    tap().toggle();
    expect(tap().direction).toBe("desc");

    tap().toggle();
    expect(tap().direction).toBe(false);
  });
});
