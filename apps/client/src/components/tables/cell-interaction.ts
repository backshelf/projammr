export type CellRef = { rowKey: string; columnId: string };

/**
 * How a cell is entered. `editor` cells open a grid-owned editor, `self` cells
 * own their control and open it themselves, `toggle` cells flip in place and
 * `none` cells are read-only.
 */
export type EntryMode = "editor" | "self" | "toggle" | "none";

export type CellState = { editing: CellRef | null };

export type CellEvent =
  | {
      type: "press";
      cell: CellRef;
      entry: EntryMode;
      /** Whether the cell held the selection anchor before the gesture began. */
      wasFocused: boolean;
      /** Whether the press landed on the cell's own control (checkbox, status pill). */
      onControl: boolean;
    }
  | { type: "doublePress"; cell: CellRef; entry: EntryMode }
  | { type: "enter"; cell: CellRef; entry: EntryMode }
  | {
      type: "type";
      cell: CellRef;
      entry: EntryMode;
      char: string;
      /**
       * Whether the column's kind can do anything with a typed character.
       * `false` leaves the key alone entirely — no editor, no effect — so the
       * page's own hotkeys still see it. Defaults to true.
       */
      seedable?: boolean;
    }
  | { type: "editEnd" };

export type CellEffect =
  | { type: "none" }
  | { type: "openEditor"; cell: CellRef; seed?: string }
  | { type: "toggle"; cell: CellRef }
  | { type: "activateSelf"; cell: CellRef };

type Transition = { state: CellState; effect: CellEffect };

const NONE: CellEffect = { type: "none" };

function idle(state: CellState, effect: CellEffect = NONE): Transition {
  return { state, effect };
}

function openEditor(cell: CellRef, seed?: string): Transition {
  const effect: CellEffect =
    seed === undefined
      ? { type: "openEditor", cell }
      : { type: "openEditor", cell, seed };
  return { state: { editing: cell }, effect };
}

function isSeed(char: string): boolean {
  return [...char].length === 1 && char.trim() !== "";
}

function fromEditorCell(event: CellEvent, cell: CellRef): Transition | null {
  switch (event.type) {
    case "press":
      return event.wasFocused ? openEditor(cell) : null;
    case "doublePress":
    case "enter":
      return openEditor(cell);
    case "type":
      if (event.seedable === false || !isSeed(event.char)) return null;
      return openEditor(cell, event.char);
    default:
      return null;
  }
}

function fromToggleCell(event: CellEvent, cell: CellRef): CellEffect {
  const flips =
    event.type === "enter" || (event.type === "press" && event.onControl);
  return flips ? { type: "toggle", cell } : NONE;
}

function fromSelfCell(event: CellEvent, cell: CellRef): CellEffect {
  return event.type === "enter" ? { type: "activateSelf", cell } : NONE;
}

/**
 * Decides what a gesture on a cell does. Only `editor` cells hold `editing`;
 * while one is editing every gesture on any cell is ignored, and only
 * `editEnd` releases it.
 */
export function cellInteraction(
  state: CellState,
  event: CellEvent
): Transition {
  if (event.type === "editEnd")
    return idle(state.editing === null ? state : { editing: null });
  if (state.editing) return idle(state);

  switch (event.entry) {
    case "editor":
      return fromEditorCell(event, event.cell) ?? idle(state);
    case "toggle":
      return idle(state, fromToggleCell(event, event.cell));
    case "self":
      return idle(state, fromSelfCell(event, event.cell));
    case "none":
      return idle(state);
  }
}

/**
 * Whether reaching row `index` needs a page loaded first: `index` is not
 * among the `loadedCount` rows already in state, and the server holds more
 * past them. An `index` past `loadedCount` with nothing left to load is not
 * this function's problem — the cell-selection feature's own clamp, or
 * `planPaste`'s row-id skip, already stops there without an error.
 */
export function needsLoadFor(
  index: number,
  loadedCount: number,
  hasMore: boolean
): boolean {
  return index >= loadedCount && hasMore;
}
