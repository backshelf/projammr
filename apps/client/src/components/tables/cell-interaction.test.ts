import { describe, expect, it } from "bun:test";

import {
  cellInteraction,
  type CellEffect,
  type CellEvent,
  type CellRef,
  type CellState,
  type EntryMode,
  needsLoadFor,
} from "./cell-interaction";

const ENTRIES: EntryMode[] = ["editor", "self", "toggle", "none"];

const cell: CellRef = { rowKey: "r1", columnId: "title" };
const other: CellRef = { rowKey: "r2", columnId: "status" };

const idle: CellState = { editing: null };
const editing = (ref: CellRef): CellState => ({ editing: ref });

const none: CellEffect = { type: "none" };

const press = (
  entry: EntryMode,
  wasFocused: boolean,
  onControl: boolean,
  ref: CellRef = cell
): CellEvent => ({ type: "press", cell: ref, entry, wasFocused, onControl });
const doublePress = (entry: EntryMode, ref: CellRef = cell): CellEvent => ({
  type: "doublePress",
  cell: ref,
  entry,
});
const enter = (entry: EntryMode, ref: CellRef = cell): CellEvent => ({
  type: "enter",
  cell: ref,
  entry,
});
const type = (
  entry: EntryMode,
  char: string,
  ref: CellRef = cell
): CellEvent => ({ type: "type", cell: ref, entry, char });

/** Every gesture event a cell of the given mode can receive. */
function gestures(entry: EntryMode, ref: CellRef = cell): CellEvent[] {
  return [
    press(entry, false, false, ref),
    press(entry, false, true, ref),
    press(entry, true, false, ref),
    press(entry, true, true, ref),
    doublePress(entry, ref),
    enter(entry, ref),
    type(entry, "a", ref),
  ];
}

describe("cellInteraction: none cells", () => {
  it("ignores every gesture and leaves the state alone", () => {
    for (const event of gestures("none")) {
      const result = cellInteraction(idle, event);
      expect(result.state).toBe(idle);
      expect(result.effect).toStrictEqual(none);
    }
  });
});

describe("cellInteraction: editor cells", () => {
  it("only selects on a press that starts unfocused", () => {
    for (const onControl of [false, true]) {
      const result = cellInteraction(idle, press("editor", false, onControl));
      expect(result.state).toBe(idle);
      expect(result.effect).toStrictEqual(none);
    }
  });

  it("opens the editor on a press of the already-focused cell", () => {
    for (const onControl of [false, true]) {
      const result = cellInteraction(idle, press("editor", true, onControl));
      expect(result.state).toStrictEqual(editing(cell));
      expect(result.effect).toStrictEqual({ type: "openEditor", cell });
    }
  });

  it("opens the editor on a double press", () => {
    const result = cellInteraction(idle, doublePress("editor"));
    expect(result.state).toStrictEqual(editing(cell));
    expect(result.effect).toStrictEqual({ type: "openEditor", cell });
  });

  it("opens the editor on enter", () => {
    const result = cellInteraction(idle, enter("editor"));
    expect(result.state).toStrictEqual(editing(cell));
    expect(result.effect).toStrictEqual({ type: "openEditor", cell });
  });

  it("opens the editor seeded with a typed character", () => {
    const result = cellInteraction(idle, type("editor", "q"));
    expect(result.state).toStrictEqual(editing(cell));
    expect(result.effect).toStrictEqual({
      type: "openEditor",
      cell,
      seed: "q",
    });
  });

  it("opens the editor on the cell the event names", () => {
    const result = cellInteraction(idle, enter("editor", other));
    expect(result.state).toStrictEqual(editing(other));
    expect(result.effect).toStrictEqual({ type: "openEditor", cell: other });
  });
});

describe("cellInteraction: toggle cells", () => {
  it("toggles on a press that lands on the control, focused or not", () => {
    for (const wasFocused of [false, true]) {
      const result = cellInteraction(idle, press("toggle", wasFocused, true));
      expect(result.state).toBe(idle);
      expect(result.effect).toStrictEqual({ type: "toggle", cell });
    }
  });

  it("only selects on a press of the padding", () => {
    for (const wasFocused of [false, true]) {
      const result = cellInteraction(idle, press("toggle", wasFocused, false));
      expect(result.state).toBe(idle);
      expect(result.effect).toStrictEqual(none);
    }
  });

  it("toggles on enter", () => {
    const result = cellInteraction(idle, enter("toggle"));
    expect(result.state).toBe(idle);
    expect(result.effect).toStrictEqual({ type: "toggle", cell });
  });

  it("ignores a double press and typing", () => {
    for (const event of [doublePress("toggle"), type("toggle", "a")]) {
      const result = cellInteraction(idle, event);
      expect(result.state).toBe(idle);
      expect(result.effect).toStrictEqual(none);
    }
  });
});

describe("cellInteraction: self cells", () => {
  it("leaves a press to the control, which opens itself", () => {
    for (const wasFocused of [false, true]) {
      for (const onControl of [false, true]) {
        const result = cellInteraction(
          idle,
          press("self", wasFocused, onControl)
        );
        expect(result.state).toBe(idle);
        expect(result.effect).toStrictEqual(none);
      }
    }
  });

  it("activates the control on enter", () => {
    const result = cellInteraction(idle, enter("self"));
    expect(result.state).toBe(idle);
    expect(result.effect).toStrictEqual({ type: "activateSelf", cell });
  });

  it("ignores a double press and typing", () => {
    for (const event of [doublePress("self"), type("self", "a")]) {
      const result = cellInteraction(idle, event);
      expect(result.state).toBe(idle);
      expect(result.effect).toStrictEqual(none);
    }
  });
});

describe("cellInteraction: while a cell is editing", () => {
  it("ignores every gesture on every mode, on the editing cell and on another", () => {
    const state = editing(cell);
    for (const entry of ENTRIES) {
      for (const ref of [cell, other]) {
        for (const event of gestures(entry, ref)) {
          const result = cellInteraction(state, event);
          expect(result.state).toBe(state);
          expect(result.effect).toStrictEqual(none);
        }
      }
    }
  });

  it("leaves the open editor alone when an already-focused editor cell is pressed", () => {
    const state = editing(cell);
    const result = cellInteraction(state, press("editor", true, false, other));
    expect(result.state).toBe(state);
    expect(result.effect).toStrictEqual(none);
  });

  it("does not toggle a checkbox pressed while another cell edits", () => {
    const state = editing(cell);
    const result = cellInteraction(state, press("toggle", false, true, other));
    expect(result.state).toBe(state);
    expect(result.effect).toStrictEqual(none);
  });
});

describe("cellInteraction: editEnd", () => {
  it("clears the editing cell", () => {
    const result = cellInteraction(editing(cell), { type: "editEnd" });
    expect(result.state).toStrictEqual(idle);
    expect(result.effect).toStrictEqual(none);
  });

  it("leaves the state unchanged when nothing is editing", () => {
    const result = cellInteraction(idle, { type: "editEnd" });
    // The same object, not an equal one: a consumer driving this through
    // useReducer re-renders on every editEnd otherwise, and the grid ends an
    // edit on blur whether or not one was open.
    expect(result.state).toBe(idle);
    expect(result.effect).toStrictEqual(none);
  });

  it("lets the next gesture through after an edit ends", () => {
    const ended = cellInteraction(editing(cell), { type: "editEnd" });
    const result = cellInteraction(ended.state, enter("editor", other));
    expect(result.state).toStrictEqual(editing(other));
    expect(result.effect).toStrictEqual({ type: "openEditor", cell: other });
  });
});

describe("cellInteraction: typed characters", () => {
  it("seeds an astral character, one code point in two UTF-16 units", () => {
    const result = cellInteraction(idle, type("editor", "\u{1F3B5}"));
    expect(result.effect).toStrictEqual({
      type: "openEditor",
      cell,
      seed: "\u{1F3B5}",
    });
  });

  it("ignores more than one code point", () => {
    for (const char of ["ab", "\u{1F3B5}\u{1F3B5}", "é"]) {
      const result = cellInteraction(idle, type("editor", char));
      expect(result.state).toBe(idle);
      expect(result.effect).toStrictEqual(none);
    }
  });

  it("ignores whitespace and an empty string", () => {
    for (const char of [" ", "\t", "\n", "  ", " ", ""]) {
      const result = cellInteraction(idle, type("editor", char));
      expect(result.state).toBe(idle);
      expect(result.effect).toStrictEqual(none);
    }
  });

  // A kind whose editor cannot show a typed character says so, and the key is
  // left alone entirely so the page's own hotkeys still see it.
  it("does nothing at all on a kind that takes no seed", () => {
    const result = cellInteraction(idle, {
      type: "type",
      cell,
      entry: "editor",
      char: "q",
      seedable: false,
    });
    expect(result.state).toBe(idle);
    expect(result.effect).toStrictEqual(none);
  });

  it("still opens an unseedable cell's editor on Enter and a second press", () => {
    for (const event of [enter("editor"), press("editor", true, false)]) {
      const result = cellInteraction(idle, event);
      expect(result.effect).toStrictEqual({ type: "openEditor", cell });
    }
  });
});

describe("cellInteraction: the editing invariant", () => {
  const starts: CellState[] = [idle, editing(cell), editing(other)];
  const events = (): CellEvent[] => [
    { type: "editEnd" },
    ...ENTRIES.flatMap((entry) => [
      ...gestures(entry, cell),
      ...gestures(entry, other),
    ]),
  ];

  it("only ever opens an editor cell", () => {
    for (const start of starts) {
      for (const event of events()) {
        const { state, effect } = cellInteraction(start, event);
        if (event.type === "editEnd") {
          expect(state.editing).toBeNull();
        } else if (state !== start) {
          expect(event.entry).toBe("editor");
          expect(state.editing).toStrictEqual(event.cell);
          expect(effect.type).toBe("openEditor");
        }
      }
    }
  });

  it("never sets editing from a non-editor cell", () => {
    for (const entry of ["self", "toggle", "none"] as const) {
      for (const event of gestures(entry)) {
        expect(cellInteraction(idle, event).state.editing).toBeNull();
      }
    }
  });

  it("only opens an editor for an event that produced an openEditor effect", () => {
    for (const event of events()) {
      const { state, effect } = cellInteraction(idle, event);
      expect(state.editing !== null).toBe(effect.type === "openEditor");
    }
  });
});

describe("needsLoadFor", () => {
  it("needs nothing for an index already within the loaded rows", () => {
    expect(needsLoadFor(0, 3, true)).toBe(false);
    expect(needsLoadFor(2, 3, true)).toBe(false);
  });

  it("needs a load right at the edge of the window, only while more exists", () => {
    expect(needsLoadFor(3, 3, true)).toBe(true);
    expect(needsLoadFor(3, 3, false)).toBe(false);
  });

  it("needs a load reaching further past the window too, only while more exists", () => {
    expect(needsLoadFor(9, 3, true)).toBe(true);
    expect(needsLoadFor(9, 3, false)).toBe(false);
  });
});
