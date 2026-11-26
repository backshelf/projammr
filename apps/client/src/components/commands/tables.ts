import { defineCommands, defineScope } from "@/components/commands/define";

/**
 * What a table's push of the `table` scope attaches: its row cursor's moves,
 * each null while the cursor gives it nothing to act on. Every table pushes
 * the one scope, and the innermost push (the table pointed at or focused
 * last) is the one the keys drive.
 */
export type TableSurface = {
  /** Steps the cursor `count` rows (one by default) down or up. */
  moveCursor: (delta: 1 | -1, count?: number) => void;
  /** Puts the cursor on the first row, or the last row loaded so far. */
  jumpCursor: (edge: "first" | "last") => void;
  /** Selects every row. */
  selectAll: (() => void) | null;
  /** Opens the cursor's row as a page. */
  open: (() => void) | null;
  /** Opens the cursor's row in the peek panel. */
  peek: (() => void) | null;
  /** Toggles the cursor's row in the selection. */
  toggleSelected: (() => void) | null;
  /** Starts renaming the cursor's row: its peek opens with the title editor. */
  rename: (() => void) | null;
  /** Runs the row's declared archive action, the row menu's own path. */
  archive: (() => void) | null;
  /** Opens the cursor row's `⋯` menu with its "Add to collection" submenu open. */
  addToCollection: (() => void) | null;
  /** Opens the cursor row's status control. */
  setStatus: (() => void) | null;
  /** Opens the cursor row's priority editor. */
  setPriority: (() => void) | null;
  /** Focuses the table's search field. */
  focusSearch: (() => void) | null;
  /** Drops the cursor and the cell selection. */
  clear: (() => void) | null;
};

export const TABLE_SCOPE = defineScope<TableSurface>("table");

/** The row cursor's keys. */
export const TABLE_COMMANDS = defineCommands(TABLE_SCOPE, [
  {
    id: "next-row",
    label: "Next row",
    group: "Table",
    keys: ["j"],
    countable: true,
    run: (ctx) => ctx.surface.moveCursor(1, ctx.count),
  },
  {
    id: "previous-row",
    label: "Previous row",
    group: "Table",
    keys: ["k"],
    countable: true,
    run: (ctx) => ctx.surface.moveCursor(-1, ctx.count),
  },
  {
    id: "first-row",
    label: "First row",
    group: "Table",
    keys: ["Home"],
    run: (ctx) => ctx.surface.jumpCursor("first"),
  },
  {
    id: "last-row",
    label: "Last row",
    group: "Table",
    keys: ["End"],
    run: (ctx) => ctx.surface.jumpCursor("last"),
  },
  {
    id: "select-all-rows",
    label: "Select all rows",
    group: "Table",
    keys: ["mod+a"],
    when: (ctx) => ctx.surface.selectAll !== null,
    run: (ctx) => ctx.surface.selectAll?.(),
  },
  {
    id: "open-row",
    label: "Open row",
    group: "Table",
    keys: ["Enter"],
    when: (ctx) => ctx.surface.open !== null,
    run: (ctx) => ctx.surface.open?.(),
  },
  {
    id: "peek-row",
    label: "Peek row",
    group: "Table",
    keys: ["o"],
    when: (ctx) => ctx.surface.peek !== null,
    run: (ctx) => ctx.surface.peek?.(),
  },
  {
    id: "select-row",
    label: "Select row",
    group: "Table",
    keys: ["x"],
    when: (ctx) => ctx.surface.toggleSelected !== null,
    run: (ctx) => ctx.surface.toggleSelected?.(),
  },
  {
    id: "rename-row",
    label: "Rename row",
    group: "Table",
    keys: ["r"],
    when: (ctx) => ctx.surface.rename !== null,
    run: (ctx) => ctx.surface.rename?.(),
  },
  {
    id: "archive-row",
    label: "Archive row",
    group: "Table",
    keys: ["e"],
    repeatable: true,
    when: (ctx) => ctx.surface.archive !== null,
    run: (ctx) => ctx.surface.archive?.(),
  },
  {
    id: "add-row-to-collection",
    label: "Add row to collection",
    group: "Table",
    keys: ["a"],
    when: (ctx) => ctx.surface.addToCollection !== null,
    run: (ctx) => ctx.surface.addToCollection?.(),
  },
  {
    id: "set-row-status",
    label: "Set row status",
    group: "Table",
    keys: ["s"],
    when: (ctx) => ctx.surface.setStatus !== null,
    run: (ctx) => ctx.surface.setStatus?.(),
  },
  {
    id: "set-row-priority",
    label: "Set row priority",
    group: "Table",
    keys: ["!"],
    when: (ctx) => ctx.surface.setPriority !== null,
    run: (ctx) => ctx.surface.setPriority?.(),
  },
  {
    id: "focus-table-search",
    label: "Search the table",
    group: "Table",
    keys: ["f"],
    when: (ctx) => ctx.surface.focusSearch !== null,
    run: (ctx) => ctx.surface.focusSearch?.(),
  },
  {
    id: "clear-cursor",
    label: "Clear cursor and selection",
    group: "Table",
    keys: ["Escape"],
    when: (ctx) => ctx.surface.clear !== null,
    run: (ctx) => ctx.surface.clear?.(),
  },
]);
