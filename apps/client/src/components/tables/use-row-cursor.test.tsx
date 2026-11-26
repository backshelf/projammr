import {
  CommandRegistry,
  useCommands,
  useKeymapState,
} from "@/components/commands/provider";
import { TABLE_COMMANDS } from "@/components/commands/tables";
import type { ActionContext } from "@/components/commands/types";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { FocusEvent, ReactNode } from "react";

import type { RowActionsConfig, RowActionsTarget } from "./RowActions";
import { useRowCursor } from "./use-row-cursor";

type Item = { id: number };
type Options = Parameters<typeof useRowCursor<Item>>[0];

const STUB_CONTEXT = {} as ActionContext;

const resetCellSelection = mock();
const push = mock();
const setPeekId = mock();
const toggleSelected = mock();
const toggleAllRowsSelected = mock();
const setMenuRequest = mock();

function fakeRow(id: string, entityId: number, canSelect = true) {
  return {
    id,
    original: { id: entityId },
    getCanSelect: () => canSelect,
    toggleSelected,
  };
}

const ROWS = [fakeRow("0", 10), fakeRow("1", 11), fakeRow("2", 12)];

// Stable identities, as the real `useRef` objects `DataTable.tsx` passes
// are: `options()` is called fresh on every render, and a `gridRef` or
// `scrollToIndex` that changed identity each time would retrigger any effect
// that depends on it regardless of what actually changed.
const DEFAULT_GRID_REF = { current: null };
const DEFAULT_SCROLL_TO_INDEX = { current: null };
const DEFAULT_OPEN_CELL = { current: null };

function options(overrides: Partial<Options> = {}): Options {
  const rows = overrides.rows ?? (ROWS as unknown as Options["rows"]);
  return {
    // The row model is the cursor's rows unless a test adds sub-rows to it.
    table: {
      resetCellSelection,
      toggleAllRowsSelected,
      getRowModel: () => ({ rows }),
    } as unknown as Options["table"],
    rows,
    gridRef: DEFAULT_GRID_REF,
    alwaysOn: false,
    showCards: false,
    peek: {
      toPeekRow: () => {
        throw new Error("unused");
      },
      href: (row) => `/tracks/${row.id}`,
      titleField: "title",
    },
    enableSelection: true,
    hasFocusedCell: false,
    setPeekId,
    router: { push },
    ensureLoaded: mock(async () => false),
    hasMore: false,
    scrollToIndex: DEFAULT_SCROLL_TO_INDEX,
    rowActionsFor: () => null,
    setMenuRequest,
    searchInput: null,
    cellOpenable: () => false,
    openCell: DEFAULT_OPEN_CELL,
    ...overrides,
  };
}

/** Runs the hook alongside the registry's own views of it, so a test can read
 *  the cursor's return value, which keys are offered and whether the `table`
 *  scope is claimed, all off one render. */
function useHarness(overrides: Partial<Options> = {}) {
  const cursor = useRowCursor(options(overrides));
  const commands = useCommands();
  const keymap = useKeymapState();
  return { ...cursor, commands, keymap };
}

function wrapper({ children }: { children: ReactNode }) {
  return (
    <CommandRegistry commands={TABLE_COMMANDS} context={STUB_CONTEXT}>
      {children}
    </CommandRegistry>
  );
}

/**
 * Renders the hook with the `table` scope already claimed (a pointer inside
 * its grid), since the registry only offers a scoped command while its scope
 * is pushed: these tests are about what the cursor offers and does, not
 * about claiming, which `useRowCursor scope` below covers on its own.
 */
function setup(overrides: Partial<Options> = {}) {
  const hook = setupScope(overrides);
  act(() => hook.result.current.gridHandlers.onPointerEnter());
  return hook;
}

function setupScope(overrides: Partial<Options> = {}) {
  const hook = renderHook(
    (props: Partial<Options> = overrides) => useHarness(props),
    {
      wrapper,
    }
  );

  const combos = () =>
    hook.result.current.commands
      .filter((command) => command.available)
      .flatMap((command) => command.keys);
  const label = (combo: string) => {
    const found = hook.result.current.commands.find((command) =>
      command.keys.includes(combo)
    );
    if (!found) throw new Error(`no command for ${combo}`);
    return found.label;
  };
  // One press of a combo: `mod+a` is Ctrl held with `a`, anything else its `key`.
  const press = (combo: string) =>
    act(() => {
      const [key = combo, ...modifiers] = combo.split("+").reverse();
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key,
          ctrlKey: modifiers.includes("mod"),
          shiftKey: modifiers.includes("shift"),
        })
      );
    });
  const inTableScope = () => hook.result.current.keymap.scope.includes("table");

  return { ...hook, combos, label, press, inTableScope };
}

beforeEach(() => {
  for (const fn of [
    resetCellSelection,
    push,
    setPeekId,
    toggleSelected,
    toggleAllRowsSelected,
    setMenuRequest,
  ]) {
    fn.mockClear();
  }
});

describe("useRowCursor bindings", () => {
  it("offers only the keys that need no cursor row until the cursor is on a row", () => {
    const { combos } = setup();
    expect(combos()).toEqual(["j", "k", "Home", "End", "mod+a"]);
  });

  it("steps down from an unset cursor onto the first row, and up onto the last", () => {
    const { result, press } = setup();
    press("j");
    expect(result.current.cursorRowId).toBe("0");
    press("j");
    expect(result.current.cursorRowId).toBe("1");
    press("k");
    expect(result.current.cursorRowId).toBe("0");
    press("k");
    expect(result.current.cursorRowId).toBe("2");
  });

  it("leaves the cursor unset when there are no rows to step through", () => {
    const { result, press } = setup({ rows: [] });
    press("j");
    expect(result.current.cursorRowId).toBeNull();
  });

  it("labels the row bindings", () => {
    const { press, label } = setup();
    press("j");
    expect(label("Enter")).toBe("Open row");
    expect(label("o")).toBe("Peek row");
    expect(label("x")).toBe("Select row");
    expect(label("Escape")).toBe("Clear cursor and selection");
  });

  it("opens the cursor row's full page on Enter", () => {
    const { press } = setup();
    press("j");
    press("k");
    press("Enter");
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/tracks/12");
  });

  it("peeks the cursor row by its entity id on o", () => {
    const { press } = setup();
    press("j");
    press("j");
    press("o");
    expect(setPeekId).toHaveBeenCalledTimes(1);
    expect(setPeekId).toHaveBeenCalledWith(11);
  });

  it("offers neither Enter nor o on a table without a peek", () => {
    const { press, combos } = setup({ peek: undefined });
    press("j");
    expect(combos()).toEqual(["j", "k", "Home", "End", "mod+a", "x", "Escape"]);
  });

  it("toggles the selection of the cursor row on x", () => {
    const { press } = setup();
    press("j");
    press("x");
    expect(toggleSelected).toHaveBeenCalledTimes(1);
  });

  it("offers no x when rows cannot be selected", () => {
    const { press, combos } = setup({ enableSelection: false });
    press("j");
    expect(combos()).not.toContain("x");
  });

  it("offers no x on a row that cannot be selected", () => {
    const { press, combos } = setup({
      rows: [fakeRow("0", 10, false)] as unknown as Options["rows"],
    });
    press("j");
    expect(combos()).not.toContain("x");
  });

  it("offers Escape only once there is a cursor or a focused cell", () => {
    const idle = setup();
    expect(idle.combos()).not.toContain("Escape");
    idle.unmount();

    const focused = setup({ hasFocusedCell: true });
    expect(focused.combos()).toContain("Escape");
  });

  it("clears the cursor and the cell selection on Escape", () => {
    const { result, press } = setup();
    press("j");
    expect(result.current.cursorRowId).toBe("0");
    press("Escape");
    expect(result.current.cursorRowId).toBeNull();
    expect(resetCellSelection).toHaveBeenCalledTimes(1);
    expect(resetCellSelection).toHaveBeenCalledWith(true);
  });

  it("drops the row bindings when the cursor row leaves the rows", () => {
    const { rerender, press, combos } = setup();
    press("j");
    expect(combos()).toEqual([
      "j",
      "k",
      "Home",
      "End",
      "mod+a",
      "Enter",
      "o",
      "x",
      "Escape",
    ]);

    rerender({ rows: [ROWS[1]] as unknown as Options["rows"] });
    expect(combos()).toEqual(["j", "k", "Home", "End", "mod+a", "Escape"]);
  });
});

describe("useRowCursor scope", () => {
  it("claims the scope from mount with the option on, before the pointer or focus is inside", () => {
    const { inTableScope } = setupScope({ alwaysOn: true });
    expect(inTableScope()).toBe(true);
  });

  it("claims nothing on mount with the option off", () => {
    const { inTableScope } = setupScope({ alwaysOn: false });
    expect(inTableScope()).toBe(false);
  });

  it("claims the scope while the pointer is inside", () => {
    const { result, inTableScope } = setupScope();
    expect(inTableScope()).toBe(false);
    act(() => result.current.gridHandlers.onPointerEnter());
    expect(inTableScope()).toBe(true);
    act(() => result.current.gridHandlers.onPointerLeave());
    expect(inTableScope()).toBe(false);
  });

  it("claims the scope while focus is inside, and lets go when it leaves the grid", () => {
    const { result, inTableScope } = setupScope();
    const grid = document.createElement("div");
    const inside = document.createElement("button");
    const outside = document.createElement("button");
    grid.append(inside);

    const blurTo = (relatedTarget: HTMLElement) =>
      ({
        currentTarget: grid,
        relatedTarget,
      }) as unknown as FocusEvent<HTMLDivElement>;

    act(() => result.current.gridHandlers.onFocus());
    expect(inTableScope()).toBe(true);

    act(() => result.current.gridHandlers.onBlur(blurTo(inside)));
    expect(inTableScope()).toBe(true);

    act(() => result.current.gridHandlers.onBlur(blurTo(outside)));
    expect(inTableScope()).toBe(false);
  });

  it("keeps the scope while the pointer is inside though focus has left", () => {
    const { result, inTableScope } = setupScope();
    act(() => {
      result.current.gridHandlers.onPointerEnter();
      result.current.gridHandlers.onFocus();
    });
    act(() =>
      result.current.gridHandlers.onBlur({
        currentTarget: document.createElement("div"),
        relatedTarget: null,
      } as unknown as FocusEvent<HTMLDivElement>)
    );
    expect(inTableScope()).toBe(true);
  });

  it("claims no scope on the phone card tier", () => {
    const { result, inTableScope } = setupScope({
      alwaysOn: true,
      showCards: true,
    });
    act(() => result.current.gridHandlers.onPointerEnter());
    expect(inTableScope()).toBe(false);
  });
});

describe("useRowCursor scrolling", () => {
  function setupWithStubbedFrame(overrides: Partial<Options> = {}) {
    const rafCallbacks: FrameRequestCallback[] = [];
    const originalRaf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      rafCallbacks.push(cb);
      return 0;
    }) as typeof requestAnimationFrame;

    const grid = document.createElement("div");
    const cursorRow = document.createElement("div");
    cursorRow.setAttribute("data-cursor", "");
    const scrollIntoView = mock();
    cursorRow.scrollIntoView = scrollIntoView;
    grid.append(cursorRow);

    const rest = setup({ gridRef: { current: grid }, ...overrides });
    const flushFrame = () => act(() => rafCallbacks[0]!(0));
    const restore = () => {
      globalThis.requestAnimationFrame = originalRaf;
    };

    return { ...rest, scrollIntoView, rafCallbacks, flushFrame, restore };
  }

  it("scrolls the cursor row into view a frame after the cursor moves, not before", () => {
    const { press, scrollIntoView, rafCallbacks, flushFrame, restore } =
      setupWithStubbedFrame();
    try {
      expect(scrollIntoView).not.toHaveBeenCalled();

      press("j");
      expect(scrollIntoView).not.toHaveBeenCalled();
      expect(rafCallbacks).toHaveLength(1);

      flushFrame();
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    } finally {
      restore();
    }
  });

  it("scrolls the grid to the cursor's row index before scrolling the row into view", () => {
    const scrollToIndex = mock();
    const { press, scrollIntoView, flushFrame, restore } =
      setupWithStubbedFrame({ scrollToIndex: { current: scrollToIndex } });
    try {
      press("j"); // onto row 0
      flushFrame();
      scrollToIndex.mockClear();
      scrollIntoView.mockClear();

      press("j"); // onto row 1
      expect(scrollToIndex).toHaveBeenCalledWith(1);
      expect(scrollIntoView).not.toHaveBeenCalled();

      flushFrame();
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  });

  it("scrolls the grid by the row's place in the whole row model, expanded sub-rows included", () => {
    const scrollToIndex = mock();
    // Row "0" is expanded: its sub-row sits between it and row "1" in the
    // model the grid virtualises, but not in the top-level rows the cursor walks.
    const model = [ROWS[0]!, fakeRow("0.0", 100), ROWS[1]!, ROWS[2]!];
    const { press, flushFrame, restore } = setupWithStubbedFrame({
      scrollToIndex: { current: scrollToIndex },
      table: {
        resetCellSelection,
        getRowModel: () => ({ rows: model }),
      } as unknown as Options["table"],
    });
    try {
      press("j"); // onto row "0"
      flushFrame();
      scrollToIndex.mockClear();

      press("j"); // onto row "1"
      expect(scrollToIndex).toHaveBeenCalledWith(2);
    } finally {
      restore();
    }
  });
});

describe("useRowCursor loading past the window", () => {
  it("loads the next page at the last row and lands the cursor on it, scrolling there", async () => {
    const extended = [...ROWS, fakeRow("3", 13)];
    const scrollToIndex = mock();
    // Stable, as `DataTable.tsx`'s real ref is: the render callback below
    // runs on every render, and a fresh `{ current: scrollToIndex }` each
    // time would retrigger the cursor-scrolling effect on its own.
    const scrollToIndexRef = { current: scrollToIndex };
    let rerenderWithExtended = () => {};
    const ensureLoaded = mock(async (index: number) => {
      expect(index).toBe(3);
      rerenderWithExtended();
      return true;
    });

    // Stubbed so the test drives the frame itself instead of racing a real one.
    const originalRaf = globalThis.requestAnimationFrame;
    const rafCallbacks: FrameRequestCallback[] = [];
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      rafCallbacks.push(cb);
      return 0;
    }) as typeof requestAnimationFrame;

    try {
      const hook = renderHook(
        (props: Partial<Options> = {}) =>
          useHarness({
            hasMore: true,
            scrollToIndex: scrollToIndexRef,
            ensureLoaded,
            ...props,
          }),
        { wrapper }
      );
      act(() => hook.result.current.gridHandlers.onPointerEnter());
      rerenderWithExtended = () =>
        hook.rerender({ rows: extended as unknown as Options["rows"] });

      const press = (combo: string) =>
        act(() => {
          window.dispatchEvent(new KeyboardEvent("keydown", { key: combo }));
        });

      press("j");
      press("j");
      press("j");
      expect(hook.result.current.cursorRowId).toBe("2");
      rafCallbacks.length = 0;

      await act(async () => {
        press("j");
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(ensureLoaded).toHaveBeenCalledWith(3);
      expect(hook.result.current.cursorRowId).toBe("3");
      expect(scrollToIndex).toHaveBeenCalledWith(3);
      // The row is scrolled into the DOM before it is queried for, in a frame.
      expect(rafCallbacks).toHaveLength(1);
    } finally {
      globalThis.requestAnimationFrame = originalRaf;
    }
  });

  it("leaves the cursor put when the load resolves false", async () => {
    const ensureLoaded = mock(async () => false);
    const scrollToIndex = mock();
    const { press, result } = setup({
      hasMore: true,
      ensureLoaded,
      scrollToIndex: { current: scrollToIndex },
    });

    press("j");
    press("j");
    press("j");
    expect(result.current.cursorRowId).toBe("2");

    await act(async () => {
      press("j");
      await Promise.resolve();
    });

    expect(ensureLoaded).toHaveBeenCalledWith(3);
    // Ordinary presses onto rows 0-2 above legitimately scroll to them; only
    // the row past the window — the one the failed load would have landed on
    // — must never be scrolled to.
    expect(scrollToIndex).not.toHaveBeenCalledWith(3);
    expect(result.current.cursorRowId).toBe("2");
  });

  it("stays put stepping back past the first row while more rows exist", () => {
    const { press, result } = setup({ hasMore: true });
    press("j");
    expect(result.current.cursorRowId).toBe("0");
    press("k");
    expect(result.current.cursorRowId).toBe("0");
  });

  it("clears a stale pending index so a later, unrelated rows growth cannot fire it", async () => {
    const extended = [...ROWS, fakeRow("3", 13)];
    let calls = 0;
    const ensureLoaded = mock(async () => {
      calls += 1;
      return calls === 1;
    });

    const hook = renderHook(
      (props: Partial<Options> = {}) =>
        useHarness({ hasMore: true, ensureLoaded, ...props }),
      { wrapper }
    );
    act(() => hook.result.current.gridHandlers.onPointerEnter());
    const press = (combo: string) =>
      act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: combo }));
      });

    press("j");
    press("j");
    press("j");
    expect(hook.result.current.cursorRowId).toBe("2");

    // The first press past the window resolves true, but `rows` here never
    // grows to carry the target, so the move is left pending rather than
    // landing straight away.
    await act(async () => {
      press("j");
      await Promise.resolve();
    });
    expect(hook.result.current.cursorRowId).toBe("2");

    // A second press resolves false: it must drop the earlier, still-pending
    // move along with its own, not just decline to add a new one.
    await act(async () => {
      press("j");
      await Promise.resolve();
    });
    expect(ensureLoaded).toHaveBeenCalledTimes(2);
    expect(hook.result.current.cursorRowId).toBe("2");

    // `rows` growing now, for a reason that has nothing to do with either
    // press above, must not land the cursor on the row the abandoned first
    // call named.
    hook.rerender({ rows: extended as unknown as Options["rows"] });
    expect(hook.result.current.cursorRowId).toBe("2");
  });
});

function rowsOfLength(length: number) {
  return Array.from({ length }, (_, i) => fakeRow(String(i), 10 + i));
}

function asRows(rows: ReturnType<typeof rowsOfLength>) {
  return rows as unknown as Options["rows"];
}

describe("useRowCursor counts", () => {
  it("marks the row steps countable", () => {
    const steps = TABLE_COMMANDS.filter((command) =>
      ["next-row", "previous-row"].includes(command.id)
    );
    expect(steps).toHaveLength(2);
    expect(steps.every((command) => command.countable)).toBe(true);
  });

  it("moves five rows on 5j and back on 2k", () => {
    const { result, press } = setup({ rows: asRows(rowsOfLength(10)) });
    press("5");
    press("j");
    expect(result.current.cursorRowId).toBe("4");
    press("2");
    press("k");
    expect(result.current.cursorRowId).toBe("2");
  });

  it("clamps a count at the last row rather than wrapping", () => {
    const { result, press } = setup({ rows: asRows(rowsOfLength(4)) });
    press("j");
    press("9");
    press("j");
    expect(result.current.cursorRowId).toBe("3");
  });

  it("clamps a count at the first row rather than wrapping", () => {
    const { result, press } = setup({ rows: asRows(rowsOfLength(4)) });
    press("j");
    press("j");
    press("9");
    press("k");
    expect(result.current.cursorRowId).toBe("0");
  });

  it("still wraps a single step at the last row", () => {
    const { result, press } = setup({ rows: asRows(rowsOfLength(3)) });
    press("End");
    press("j");
    expect(result.current.cursorRowId).toBe("0");
  });

  describe("past the loaded rows", () => {
    function setupLoading(loaded: boolean, grownTo: number) {
      const grown = asRows(rowsOfLength(grownTo));
      let rerenderGrown = () => {};
      const ensureLoaded = mock(async () => {
        rerenderGrown();
        return loaded;
      });
      const hook = renderHook(
        (props: Partial<Options> = {}) =>
          useHarness({
            rows: asRows(rowsOfLength(3)),
            hasMore: true,
            ensureLoaded,
            ...props,
          }),
        { wrapper }
      );
      act(() => hook.result.current.gridHandlers.onPointerEnter());
      rerenderGrown = () => hook.rerender({ rows: grown });
      const press = (combo: string) =>
        act(() => {
          window.dispatchEvent(new KeyboardEvent("keydown", { key: combo }));
        });
      return { ...hook, ensureLoaded, press };
    }

    it("loads up to the counted row and lands on it once the rows arrive", async () => {
      const { result, ensureLoaded, press } = setupLoading(true, 8);
      press("End");
      expect(result.current.cursorRowId).toBe("2");

      press("3");
      await act(async () => {
        press("j");
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      // The row model held 3 rows; 3 more rows down is index 5.
      expect(ensureLoaded).toHaveBeenCalledWith(5);
      expect(result.current.cursorRowId).toBe("5");
    });

    it("lands on the last row when the rows run out before the count does", async () => {
      const { result, ensureLoaded, press } = setupLoading(false, 5);
      press("End");

      press("9");
      await act(async () => {
        press("j");
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(ensureLoaded).toHaveBeenCalledTimes(1);
      expect(result.current.cursorRowId).toBe("4");
    });
  });
});

describe("useRowCursor Home and End", () => {
  it("puts the cursor on the first row on Home and the last row on End", () => {
    const { result, press } = setup({ rows: asRows(rowsOfLength(6)) });
    press("End");
    expect(result.current.cursorRowId).toBe("5");
    press("Home");
    expect(result.current.cursorRowId).toBe("0");
  });

  it("goes to the last loaded row on End without loading more", () => {
    const ensureLoaded = mock(async () => true);
    const { result, press } = setup({ hasMore: true, ensureLoaded });
    press("End");
    expect(result.current.cursorRowId).toBe("2");
    expect(ensureLoaded).not.toHaveBeenCalled();
  });

  it("leaves the cursor unset when there are no rows", () => {
    const { result, press } = setup({ rows: [] });
    press("Home");
    press("End");
    expect(result.current.cursorRowId).toBeNull();
  });

  it("labels the bindings", () => {
    const { label } = setup();
    expect(label("Home")).toBe("First row");
    expect(label("End")).toBe("Last row");
  });
});

describe("useRowCursor select all", () => {
  it("selects every row on mod+a", () => {
    const { press, label } = setup();
    expect(label("mod+a")).toBe("Select all rows");
    press("mod+a");
    expect(toggleAllRowsSelected).toHaveBeenCalledTimes(1);
    expect(toggleAllRowsSelected).toHaveBeenCalledWith(true);
  });

  it("selects all without a cursor row", () => {
    const { result, press } = setup();
    expect(result.current.cursorRowId).toBeNull();
    press("mod+a");
    expect(toggleAllRowsSelected).toHaveBeenCalledTimes(1);
  });

  it("offers no mod+a when rows cannot be selected", () => {
    const { press, combos } = setup({ enableSelection: false });
    expect(combos()).not.toContain("mod+a");
    press("mod+a");
    expect(toggleAllRowsSelected).not.toHaveBeenCalled();
  });

  it("offers no mod+a without rows", () => {
    const { combos } = setup({ rows: [] });
    expect(combos()).not.toContain("mod+a");
  });
});

describe("useRowCursor row actions", () => {
  const onRename = mock();
  const onArchive = mock();
  const archive = {
    id: "archive",
    label: "Archive",
    onSelect: onArchive,
  };
  type Menu = RowActionsConfig & { target: RowActionsTarget };
  const menu = (overrides: Partial<Menu> = {}): Menu => ({
    onRename,
    actions: [archive],
    collections: [{ id: 1, title: "Singles" }],
    onAddToCollection: mock(),
    target: { count: 1, label: "track" },
    ...overrides,
  });
  const withMenu = (overrides: Partial<Menu> = {}) =>
    setup({ rowActionsFor: () => menu(overrides) });

  beforeEach(() => {
    onRename.mockClear();
    onArchive.mockClear();
  });

  it("offers none of r, e, a until the cursor is on a row that has them", () => {
    const { press, combos } = withMenu();
    expect(combos()).not.toContain("r");
    expect(combos()).not.toContain("e");
    expect(combos()).not.toContain("a");
    press("j");
    expect(combos()).toEqual(expect.arrayContaining(["r", "e", "a"]));
  });

  it("labels the row action bindings", () => {
    const { press, label } = withMenu();
    press("j");
    expect(label("r")).toBe("Rename row");
    expect(label("e")).toBe("Archive row");
    expect(label("a")).toBe("Add row to collection");
  });

  it("asks the cursor row's menu to rename on r", () => {
    const rowActionsFor = mock<(row: Item, id: number) => Menu>(() => menu());
    const { press } = setup({ rowActionsFor });
    press("j");
    press("j");
    press("r");
    expect(rowActionsFor).toHaveBeenCalledWith({ id: 11 }, 11);
    expect(onRename).toHaveBeenCalledTimes(1);
  });

  it("offers no r where the row has no rename, or the target is a selection", () => {
    const none = withMenu({ onRename: undefined });
    none.press("j");
    expect(none.combos()).not.toContain("r");
    none.unmount();

    const many = withMenu({ target: { count: 2, label: "tracks" } });
    many.press("j");
    expect(many.combos()).not.toContain("r");
  });

  it("runs the row's declared archive action on e", () => {
    const { press } = withMenu();
    press("j");
    press("e");
    expect(onArchive).toHaveBeenCalledTimes(1);
  });

  it("offers no e where the row has no archive action", () => {
    const { press, combos } = withMenu({
      actions: [{ ...archive, id: "unarchive" }],
    });
    press("j");
    expect(combos()).not.toContain("e");

    const none = withMenu({ actions: undefined });
    none.press("j");
    expect(none.combos()).not.toContain("e");
  });

  it("requests the cursor row's collection submenu on a", () => {
    const { press } = withMenu();
    press("j");
    press("j");
    press("a");
    expect(setMenuRequest).toHaveBeenCalledTimes(1);
    expect(setMenuRequest).toHaveBeenCalledWith({
      rowId: 11,
      submenu: "collection",
    });
  });

  it("offers no a without collections or an add-to-collection handler", () => {
    const empty = withMenu({ collections: [] });
    empty.press("j");
    expect(empty.combos()).not.toContain("a");
    empty.unmount();

    const missing = withMenu({ onAddToCollection: undefined });
    missing.press("j");
    expect(missing.combos()).not.toContain("a");
  });

  it("offers no row action on a table with no row menu", () => {
    const { press, combos } = setup();
    press("j");
    expect(combos()).not.toContain("r");
    expect(combos()).not.toContain("e");
    expect(combos()).not.toContain("a");
  });

  it("focuses the search field on f, with no cursor row", () => {
    const input = document.createElement("input");
    document.body.append(input);
    const { press, combos } = setup({ searchInput: input });
    expect(combos()).toContain("f");
    press("f");
    expect(document.activeElement).toBe(input);
    input.remove();
  });

  it("offers no f while the table renders no search", () => {
    const { combos } = setup();
    expect(combos()).not.toContain("f");
  });
});
