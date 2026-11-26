import {
  defineCommands,
  defineScope,
  type CommandSpec,
} from "@/components/commands/define";
import type { Combo } from "@workspace/ui/lib/keymap";

type Direction = "up" | "down" | "left" | "right";

/**
 * What a grid's push of the `grid` scope attaches: the cell selection's own
 * moves, distinct from the row cursor the `table` scope drives beneath it.
 * Pushed while DOM focus is inside the grid and no cell editor is open, after
 * the table's own push (`use-cell-grid.tsx` says why the order holds), so as
 * the innermost scope its keys outrank both the table's `Enter` ("Open row")
 * and the global player's arrow seek for as long as a cell holds focus.
 */
export type GridSurface = {
  move: (direction: Direction) => void;
  extend: (direction: Direction) => void;
  selectAll: () => void;
  copy: () => void;
  /** Opens or activates the focused cell; `null` with no focused cell, or
   *  one whose entry is `"none"` — a read-only cell leaves Enter to the
   *  browser, so a link inside it still activates. */
  enter: (() => void) | null;
};

export const GRID_SCOPE = defineScope<GridSurface>("grid");

const DIRECTIONS: readonly { direction: Direction; arrow: Combo }[] = [
  { direction: "up", arrow: "ArrowUp" },
  { direction: "down", arrow: "ArrowDown" },
  { direction: "left", arrow: "ArrowLeft" },
  { direction: "right", arrow: "ArrowRight" },
];

const moveCommands: CommandSpec<GridSurface>[] = DIRECTIONS.map(
  ({ direction, arrow }) => ({
    id: `grid-move-${direction}`,
    label: `Move cell selection ${direction}`,
    group: "Table",
    keys: [arrow],
    run: (ctx) => ctx.surface.move(direction),
  })
);

const extendCommands: CommandSpec<GridSurface>[] = DIRECTIONS.map(
  ({ direction, arrow }) => ({
    id: `grid-extend-${direction}`,
    label: `Extend cell selection ${direction}`,
    group: "Table",
    keys: [`shift+${arrow}` as Combo],
    run: (ctx) => ctx.surface.extend(direction),
  })
);

/** The cell grid's spreadsheet-style keys. */
export const GRID_COMMANDS = defineCommands(GRID_SCOPE, [
  ...moveCommands,
  ...extendCommands,
  {
    id: "grid-select-all",
    label: "Select all cells",
    group: "Table",
    keys: ["mod+a"],
    run: (ctx) => ctx.surface.selectAll(),
  },
  {
    id: "grid-copy",
    label: "Copy cells",
    group: "Table",
    keys: ["mod+c"],
    run: (ctx) => ctx.surface.copy(),
  },
  {
    id: "grid-edit-cell",
    label: "Edit cell",
    group: "Table",
    keys: ["Enter"],
    when: (ctx) => ctx.surface.enter !== null,
    run: (ctx) => ctx.surface.enter?.(),
  },
]);
