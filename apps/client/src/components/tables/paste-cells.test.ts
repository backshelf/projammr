import { describe, expect, it } from "bun:test";

import { selectOptions } from "@/fields/select-fixture";
import type { FieldConfig, FieldKindName } from "@/fields/types";

import { planPaste } from "./paste-cells";

type Config = { type: FieldKindName } & FieldConfig;

const COLUMN_IDS = ["title", "bpm", "due", "stage", "done"];
const ROW_IDS = [10, 11, 12];
const CONFIGS: Record<string, Config> = {
  title: { type: "text", required: true },
  bpm: { type: "number" },
  due: { type: "date" },
  stage: { type: "select", options: selectOptions("Draft", "Mixed", "Final") },
  done: { type: "checkbox" },
};

function plan(
  grid: string[][],
  overrides: {
    start?: { row: number; column: number };
    rowIds?: (number | undefined)[];
    columnIds?: string[];
    configs?: Record<string, Config>;
  } = {}
) {
  return planPaste({
    grid,
    columnIds: overrides.columnIds ?? COLUMN_IDS,
    start: overrides.start ?? { row: 0, column: 0 },
    rowIds: overrides.rowIds ?? ROW_IDS,
    configs: overrides.configs ?? CONFIGS,
  });
}

describe("planPaste", () => {
  it("saves each parsed cell against its row and column", () => {
    expect(plan([["Song", "120", "2026-01-31", "final", "true"]])).toEqual({
      saves: [
        { rowId: 10, field: "title", value: "Song" },
        { rowId: 10, field: "bpm", value: 120 },
        { rowId: 10, field: "due", value: "2026-01-31" },
        { rowId: 10, field: "stage", value: "Final" },
        { rowId: 10, field: "done", value: true },
      ],
      skipped: 0,
      notEditable: 0,
    });
  });

  it("anchors the rectangle at the start position", () => {
    expect(
      plan(
        [
          ["130", "2026-02-01"],
          ["140", "2026-02-02"],
        ],
        { start: { row: 1, column: 1 } }
      )
    ).toEqual({
      saves: [
        { rowId: 11, field: "bpm", value: 130 },
        { rowId: 11, field: "due", value: "2026-02-01" },
        { rowId: 12, field: "bpm", value: 140 },
        { rowId: 12, field: "due", value: "2026-02-02" },
      ],
      skipped: 0,
      notEditable: 0,
    });
  });

  it("skips a blank pasted into a required cell", () => {
    expect(plan([["  ", "120"]])).toEqual({
      saves: [{ rowId: 10, field: "bpm", value: 120 }],
      skipped: 1,
      notEditable: 0,
    });
  });

  it("clears an optional cell on a blank", () => {
    expect(plan([["Song", ""]]).saves).toEqual([
      { rowId: 10, field: "title", value: "Song" },
      { rowId: 10, field: "bpm", value: null },
    ]);
  });

  it("plans no save when every cell is rejected", () => {
    expect(plan([["", "abc", "31/01/2026", "Mastered", "yes"]])).toEqual({
      saves: [],
      skipped: 5,
      notEditable: 0,
    });
  });

  it("reports saves and skipped cells from the same paste", () => {
    const { saves, skipped } = plan([
      ["Song", "abc"],
      ["Other", "90"],
    ]);
    expect(saves).toHaveLength(3);
    expect(skipped).toBe(1);
  });

  it("passes over a status column without counting it", () => {
    const configs: Record<string, Config> = {
      ...CONFIGS,
      bpm: { type: "status", statuses: [] },
    };
    expect(plan([["Song", "3", "2026-01-31"]], { configs })).toEqual({
      saves: [
        { rowId: 10, field: "title", value: "Song" },
        { rowId: 10, field: "due", value: "2026-01-31" },
      ],
      skipped: 0,
      notEditable: 0,
    });
  });

  // A navigable column with no config is in the rectangle so it can be copied
  // — the identity column, which is a link — but it takes no
  // paste. Counted apart from `skipped`, whose reason is the text rather than
  // the column, so the two can be told apart in the toast.
  it("counts a column with no config apart from the rejected cells", () => {
    const configs = Object.fromEntries(
      Object.entries(CONFIGS).filter(([columnId]) => columnId !== "bpm")
    );
    expect(plan([["Song", "not read", "2026-01-31"]], { configs })).toEqual({
      saves: [
        { rowId: 10, field: "title", value: "Song" },
        { rowId: 10, field: "due", value: "2026-01-31" },
      ],
      skipped: 0,
      notEditable: 1,
    });
  });

  it("passes over a column whose kind is not registered without counting it", () => {
    const configs: Record<string, Config> = {
      ...CONFIGS,
      bpm: { type: "not-a-kind" as FieldKindName },
    };
    expect(plan([["Song", "x", "2026-01-31"]], { configs })).toEqual({
      saves: [
        { rowId: 10, field: "title", value: "Song" },
        { rowId: 10, field: "due", value: "2026-01-31" },
      ],
      skipped: 0,
      notEditable: 0,
    });
  });

  it("drops cells past the last row", () => {
    expect(
      plan([["A"], ["B"], ["C"]], {
        rowIds: [10, 11],
        start: { row: 1, column: 0 },
      })
    ).toEqual({
      saves: [{ rowId: 11, field: "title", value: "A" }],
      skipped: 0,
      notEditable: 0,
    });
  });

  it("drops cells past the last navigable column", () => {
    expect(
      plan([["120", "2026-01-31", "Draft", "true", "extra", "more"]], {
        start: { row: 0, column: 1 },
      })
    ).toEqual({
      saves: [
        { rowId: 10, field: "bpm", value: 120 },
        { rowId: 10, field: "due", value: "2026-01-31" },
        { rowId: 10, field: "stage", value: "Draft" },
        { rowId: 10, field: "done", value: true },
      ],
      skipped: 0,
      notEditable: 0,
    });
  });

  it("counts only the cells that fall inside the grid", () => {
    expect(
      plan(
        [
          ["abc", "abc"],
          ["abc", "abc"],
        ],
        {
          rowIds: [10],
          columnIds: ["title", "bpm"],
          start: { row: 0, column: 1 },
        }
      )
    ).toEqual({ saves: [], skipped: 1, notEditable: 0 });
  });

  it("passes over a row that has no id", () => {
    expect(plan([["A"], ["B"]], { rowIds: [undefined, 11] })).toEqual({
      saves: [{ rowId: 11, field: "title", value: "B" }],
      skipped: 0,
      notEditable: 0,
    });
  });

  it("skips an option the select does not list", () => {
    expect(plan([["Song", "", "", "Mastered"]])).toEqual({
      saves: [
        { rowId: 10, field: "title", value: "Song" },
        { rowId: 10, field: "bpm", value: null },
        { rowId: 10, field: "due", value: null },
      ],
      skipped: 1,
      notEditable: 0,
    });
  });

  it("skips a malformed or impossible date", () => {
    const { saves, skipped } = plan([
      ["A", "", "31/01/2026"],
      ["B", "", "2026-02-30"],
    ]);
    expect(saves.filter((s) => s.field === "due")).toEqual([]);
    expect(skipped).toBe(2);
  });

  it("skips a checkbox value that is not true, false or blank", () => {
    const configs = { done: CONFIGS.done! };
    const { saves, skipped } = plan(
      [["yes"], ["1"], ["false"], ["TRUE"], [""]],
      {
        columnIds: ["done"],
        rowIds: [1, 2, 3, 4, 5],
        configs,
      }
    );
    expect(saves).toEqual([
      { rowId: 3, field: "done", value: false },
      { rowId: 4, field: "done", value: true },
      { rowId: 5, field: "done", value: false },
    ]);
    expect(skipped).toBe(2);
  });
});
