import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
  mock,
} from "bun:test";
import { CHORD_WINDOW_MS, createKeymap } from "./keymap";
import { formatCombo } from "./format";
import type { Binding, KeymapOptions, KeymapRun } from "./types";

type FakeTarget = {
  tagName: string;
  isContentEditable?: boolean;
  role?: string;
};

/** A keydown as the keymap reads it: a key, its modifiers, and the element
 *  it landed on. */
function keydown(
  key: string,
  options: {
    meta?: boolean;
    ctrl?: boolean;
    shift?: boolean;
    alt?: boolean;
    target?: FakeTarget;
    repeat?: boolean;
    defaultPrevented?: boolean;
  } = {}
) {
  const target = options.target;
  return {
    key,
    metaKey: options.meta ?? false,
    ctrlKey: options.ctrl ?? false,
    shiftKey: options.shift ?? false,
    altKey: options.alt ?? false,
    repeat: options.repeat ?? false,
    defaultPrevented: options.defaultPrevented ?? false,
    target: (target
      ? {
          tagName: target.tagName,
          isContentEditable: target.isContentEditable ?? false,
          getAttribute: (name: string) =>
            name === "role" ? (target.role ?? null) : null,
        }
      : null) as unknown as EventTarget | null,
    preventDefault: mock(),
  };
}

const binding = (
  overrides: Partial<Binding> & Pick<Binding, "id" | "keys">
): Binding => ({
  scope: "global",
  label: overrides.id,
  ...overrides,
});

/** A keymap over `bindings` that records every command it runs. */
function setup(
  bindings: Binding[],
  options: Partial<Omit<KeymapOptions, "bindings" | "onRun">> = {}
) {
  const runs: [string, KeymapRun][] = [];
  const keymap = createKeymap({
    bindings,
    onRun: (id, run) => runs.push([id, run]),
    ...options,
  });
  const ran = () => runs.map(([id]) => id);
  const press = (...keys: string[]) => {
    for (const key of keys) keymap.dispatch(keydown(key));
  };
  return { keymap, runs, ran, press };
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("dispatch", () => {
  it("ignores a handled or auto-repeating event", () => {
    const { keymap, ran } = setup([binding({ id: "mute", keys: ["m"] })]);

    keymap.dispatch(keydown("m", { defaultPrevented: true }));
    keymap.dispatch(keydown("m", { repeat: true }));

    expect(ran()).toEqual([]);
  });

  it("runs a held key again when the keymap takes auto-repeat", () => {
    const { keymap, ran } = setup([binding({ id: "down", keys: ["j"] })], {
      repeat: true,
    });

    keymap.dispatch(keydown("j"));
    keymap.dispatch(keydown("j", { repeat: true }));

    expect(ran()).toEqual(["down", "down"]);
  });

  it("consumes the key it matched", () => {
    const { keymap, runs } = setup([binding({ id: "mute", keys: ["m"] })]);

    const event = keydown("m");
    keymap.dispatch(event);

    expect(runs).toEqual([["mute", { count: 1, combo: "m" }]]);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it("lets an unbound key through untouched", () => {
    const { keymap, ran } = setup([binding({ id: "mute", keys: ["m"] })]);

    const event = keydown("q");
    keymap.dispatch(event);

    expect(ran()).toEqual([]);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("leaves space and Enter to the control that has focus", () => {
    const { keymap, ran } = setup([
      binding({ id: "play", keys: ["space"] }),
      binding({ id: "open", keys: ["Enter"] }),
    ]);

    keymap.dispatch(keydown(" ", { target: { tagName: "BUTTON" } }));
    keymap.dispatch(keydown("Enter", { target: { tagName: "A" } }));
    keymap.dispatch(
      keydown(" ", { target: { tagName: "DIV", role: "slider" } })
    );

    expect(ran()).toEqual([]);
  });

  it("still plays on space over an ordinary element", () => {
    const { keymap, ran } = setup([binding({ id: "play", keys: ["space"] })]);

    keymap.dispatch(keydown(" ", { target: { tagName: "DIV" } }));

    expect(ran()).toEqual(["play"]);
  });

  it("reads a binding declared in either vocabulary", () => {
    const { press, ran } = setup([
      binding({ id: "down", keys: ["down"] }),
      binding({ id: "last", keys: ["G"] }),
    ]);

    press("ArrowDown", "G");

    expect(ran()).toEqual(["down", "last"]);
  });

  it("tells a capital from its lowercase", () => {
    const { press, ran } = setup([
      binding({ id: "render.next", keys: ["j"] }),
      binding({ id: "track.next", keys: ["shift+j"] }),
    ]);

    press("j", "J");

    expect(ran()).toEqual(["render.next", "track.next"]);
  });

  it("tells mod+z from mod+shift+z", () => {
    const { keymap, ran } = setup([
      binding({ id: "undo", keys: ["mod+z"] }),
      binding({ id: "redo", keys: ["mod+shift+z"] }),
    ]);

    keymap.dispatch(keydown("z", { meta: true }));
    keymap.dispatch(keydown("z", { meta: true, shift: true }));

    expect(ran()).toEqual(["undo", "redo"]);
  });

  it("refuses a binding whose key breaks the grammar", () => {
    expect(() => setup([binding({ id: "bad", keys: ["g t t"] })])).toThrow(
      /bad/
    );
  });
});

describe("typing targets", () => {
  it("blocks space while a text field has focus", () => {
    const { keymap, ran } = setup([binding({ id: "play", keys: ["space"] })]);

    keymap.dispatch(keydown(" ", { target: { tagName: "INPUT" } }));

    expect(ran()).toEqual([]);
  });

  it("lets an allowInInput binding through the same field", () => {
    const { keymap, ran } = setup([
      binding({ id: "close", keys: ["Escape"], allowInInput: true }),
    ]);

    keymap.dispatch(keydown("Escape", { target: { tagName: "INPUT" } }));

    expect(ran()).toEqual(["close"]);
  });

  it("neither counts nor opens a chord while typing", () => {
    const { keymap, ran } = setup([
      binding({ id: "down", keys: ["j"], countable: true }),
      binding({ id: "top", keys: ["g g"] }),
    ]);
    const field = { target: { tagName: "TEXTAREA" } };

    keymap.dispatch(keydown("5", field));
    keymap.dispatch(keydown("g", field));

    expect(keymap.state()).toMatchObject({ pending: [], count: null });
    expect(ran()).toEqual([]);
  });
});

describe("chords", () => {
  it("fires when the second key lands inside the window", () => {
    const { keymap, ran } = setup([binding({ id: "tracks", keys: ["g t"] })]);

    keymap.dispatch(keydown("g"));
    jest.advanceTimersByTime(CHORD_WINDOW_MS - 100);
    keymap.dispatch(keydown("t"));

    expect(ran()).toEqual(["tracks"]);
  });

  it("does not fire once the window has lapsed", () => {
    const { keymap, ran } = setup([binding({ id: "tracks", keys: ["g t"] })]);

    keymap.dispatch(keydown("g"));
    jest.advanceTimersByTime(CHORD_WINDOW_MS + 100);
    keymap.dispatch(keydown("t"));

    expect(ran()).toEqual([]);
  });

  it("drops a prefix that waits too long, and the next press starts afresh", () => {
    const { keymap, press } = setup([binding({ id: "top", keys: ["g g"] })]);

    press("g");
    jest.advanceTimersByTime(CHORD_WINDOW_MS + 1);
    press("g");

    expect(keymap.state().pending).toEqual(["g"]);
  });

  it("uses the window it is given", () => {
    const { keymap, ran } = setup([binding({ id: "tracks", keys: ["g t"] })], {
      chordWindowMs: 800,
    });

    keymap.dispatch(keydown("g"));
    jest.advanceTimersByTime(900);
    keymap.dispatch(keydown("t"));

    expect(ran()).toEqual([]);
  });

  it("leaves the opening key unconsumed", () => {
    const { keymap } = setup([binding({ id: "tracks", keys: ["g t"] })]);

    const event = keydown("g");
    keymap.dispatch(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("falls back to the single key when no chord matches", () => {
    const { press, ran } = setup([
      binding({ id: "tracks", keys: ["g t"] }),
      binding({ id: "theme", keys: ["d"] }),
    ]);

    press("g", "d");

    expect(ran()).toEqual(["theme"]);
  });

  it("swallows an unbound key that breaks a prefix, and clears it", () => {
    const { keymap, ran } = setup([binding({ id: "top", keys: ["g g"] })]);

    keymap.dispatch(keydown("g"));
    const event = keydown("q");
    keymap.dispatch(event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(keymap.state().pending).toEqual([]);
    expect(ran()).toEqual([]);
  });

  it("lists the pending chord's continuations as candidates", () => {
    const { keymap, press } = setup([
      binding({ id: "top", keys: ["g g"], label: "First render" }),
      binding({ id: "tracks", keys: ["g t"], label: "Tracks" }),
      binding({ id: "down", keys: ["j"], label: "Down" }),
    ]);

    press("g");

    expect(keymap.state()).toMatchObject({
      pending: ["g"],
      candidates: [
        { id: "top", keys: ["g g"], label: "First render" },
        { id: "tracks", keys: ["g t"], label: "Tracks" },
      ],
    });
  });

  it("clears the pending chord when the window lapses with no second key", () => {
    const { keymap, press } = setup([binding({ id: "top", keys: ["g g"] })]);
    const listener = mock();
    keymap.subscribe(listener);

    press("g");
    listener.mockClear();
    jest.advanceTimersByTime(CHORD_WINDOW_MS);

    expect(keymap.state().pending).toEqual([]);
    expect(listener).toHaveBeenCalled();
  });

  it("cancels a pending chord with Escape, without running Escape's binding", () => {
    const { keymap, press, ran } = setup([
      binding({ id: "tracks", keys: ["g t"] }),
      binding({ id: "close", keys: ["Escape"] }),
    ]);

    press("g", "Escape");

    expect(keymap.state().pending).toEqual([]);
    expect(ran()).toEqual([]);

    press("Escape");
    expect(ran()).toEqual(["close"]);
  });

  it("waits through a bare modifier for a chord's shifted second key", () => {
    const { press, ran } = setup([binding({ id: "tag", keys: ["g T"] })]);

    press("g", "Shift", "T");

    expect(ran()).toEqual(["tag"]);
  });
});

describe("a single key and a chord opening on the same letter", () => {
  const bindings = () => [
    binding({ id: "go", keys: ["g"] }),
    binding({ id: "tracks", keys: ["g t"] }),
    binding({ id: "theme", keys: ["d"] }),
  ];

  it("runs the chord when the second key lands in the window", () => {
    const { press, ran } = setup(bindings());

    press("g");
    expect(ran()).toEqual([]);

    press("t");
    expect(ran()).toEqual(["tracks"]);

    jest.advanceTimersByTime(CHORD_WINDOW_MS * 2);
    expect(ran()).toEqual(["tracks"]);
  });

  it("runs the single when the window lapses with no second press", () => {
    const { keymap, press, runs } = setup(bindings());

    press("g");
    jest.advanceTimersByTime(CHORD_WINDOW_MS - 1);
    expect(runs).toEqual([]);

    jest.advanceTimersByTime(1);
    expect(runs).toEqual([["go", { count: 1, combo: "g" }]]);
    expect(keymap.state().pending).toEqual([]);
  });

  it("runs the single, then the second key, when the second key is no continuation", () => {
    const { press, ran } = setup(bindings());

    press("g", "d");

    expect(ran()).toEqual(["go", "theme"]);
  });

  it("drops the single when Escape cancels the chord", () => {
    const { press, ran } = setup(bindings());

    press("g", "Escape");
    jest.advanceTimersByTime(CHORD_WINDOW_MS * 2);

    expect(ran()).toEqual([]);
  });

  it("drops the single if its scope went away before the window lapsed", () => {
    const { keymap, ran } = setup([
      binding({ id: "go", keys: ["g"], scope: "table" }),
      binding({ id: "tracks", keys: ["g t"], scope: "table" }),
    ]);
    const release = keymap.pushScope("table");

    keymap.dispatch(keydown("g"));
    release();
    jest.advanceTimersByTime(CHORD_WINDOW_MS);

    expect(ran()).toEqual([]);
  });

  it("runs a single at once when no chord opens on its letter", () => {
    const { press, ran } = setup(bindings());

    press("d");

    expect(ran()).toEqual(["theme"]);
  });

  it("runs a deeper scope's single at once over a global chord", () => {
    const { keymap, ran } = setup([
      binding({ id: "tracks", keys: ["g t"] }),
      binding({ id: "group", keys: ["g"], scope: "table" }),
    ]);
    keymap.pushScope("table");

    keymap.dispatch(keydown("g"));

    expect(ran()).toEqual(["group"]);
    expect(keymap.state().pending).toEqual([]);
  });
});

describe("counts", () => {
  const catalogue = () => [
    binding({ id: "yes", keys: ["y"], countable: true }),
    binding({ id: "yes.all", keys: ["shift+y"] }),
    binding({ id: "down", keys: ["j"], countable: true }),
    binding({ id: "top", keys: ["g g"] }),
    binding({ id: "pick", keys: ["g p"], countable: true }),
    binding({
      id: "seek",
      keys: ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"],
    }),
    binding({ id: "cancel", keys: ["Escape"] }),
  ];

  it("applies a count to a countable command", () => {
    const { keymap, press, runs } = setup(catalogue());

    press("5");
    expect(keymap.state().count).toBe(5);

    press("y");
    expect(runs.at(-1)).toEqual(["yes", { count: 5, combo: "y" }]);
    expect(keymap.state().count).toBeNull();
  });

  it("reports each digit through its own binding as the count builds", () => {
    const { press, runs } = setup(catalogue());

    press("1", "2");

    expect(runs).toEqual([
      ["seek", { count: 1, combo: "1" }],
      ["seek", { count: 1, combo: "2" }],
    ]);
  });

  it("holds back a yielding digit binding while the digit builds a count", () => {
    const yielding = catalogue().map((entry) =>
      entry.id === "seek" ? { ...entry, yieldsToCount: true } : entry
    );
    const { keymap, press, runs } = setup(yielding);

    press("5");
    expect(runs).toEqual([]);
    expect(keymap.state().count).toBe(5);

    press("j");
    expect(runs).toEqual([["down", { count: 5, combo: "j" }]]);
  });

  it("runs a yielding digit binding when nothing countable answers", () => {
    const { press, runs } = setup([
      binding({ id: "seek", keys: ["5"], yieldsToCount: true }),
    ]);

    press("5");

    expect(runs).toEqual([["seek", { count: 1, combo: "5" }]]);
  });

  it("reads a multi-digit count", () => {
    const { press, runs } = setup(catalogue());

    press("1", "2", "j");

    expect(runs.at(-1)).toEqual(["down", { count: 12, combo: "j" }]);
  });

  it("ignores a count on a command that takes none", () => {
    const { press, runs } = setup(catalogue());

    press("3", "Y");

    expect(runs.at(-1)).toEqual(["yes.all", { count: 1, combo: "shift+y" }]);
  });

  it("gives the count to a chord's command when it takes one, else drops it", () => {
    const { keymap, press, runs } = setup(catalogue());

    press("3", "g");
    expect(keymap.state()).toMatchObject({ count: 3, pending: ["g"] });

    press("p");
    expect(runs.at(-1)).toEqual(["pick", { count: 3, combo: "g p" }]);

    press("3", "g", "g");
    expect(runs.at(-1)).toEqual(["top", { count: 1, combo: "g g" }]);
  });

  it("cancels a building count with Escape", () => {
    const { keymap, press, runs, ran } = setup(catalogue());

    press("4");
    const escape = keydown("Escape");
    keymap.dispatch(escape);

    expect(escape.preventDefault).toHaveBeenCalledTimes(1);
    expect(keymap.state().count).toBeNull();
    expect(ran()).not.toContain("cancel");

    press("y");
    expect(runs.at(-1)).toEqual(["yes", { count: 1, combo: "y" }]);
  });

  it("treats a lone 0 as its own key, not the start of a count", () => {
    const { keymap, press, runs } = setup(catalogue());

    press("0");
    expect(runs).toEqual([["seek", { count: 1, combo: "0" }]]);
    expect(keymap.state().count).toBeNull();

    press("y");
    expect(runs.at(-1)).toEqual(["yes", { count: 1, combo: "y" }]);
  });

  it("takes a 0 inside a count", () => {
    const { press, runs } = setup(catalogue());

    press("1", "0", "j");

    expect(runs.at(-1)).toEqual(["down", { count: 10, combo: "j" }]);
  });

  it("swallows an unbound key that breaks a count", () => {
    const { keymap, press } = setup(catalogue());

    press("3");
    const event = keydown("q");
    keymap.dispatch(event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(keymap.state().count).toBeNull();
  });

  it("keeps the count through a bare Shift", () => {
    const { press, runs } = setup([
      binding({ id: "track.next", keys: ["shift+j"], countable: true }),
    ]);

    press("5", "Shift", "J");

    expect(runs.at(-1)).toEqual(["track.next", { count: 5, combo: "shift+j" }]);
  });

  it("drops a count once the window lapses", () => {
    const { keymap, press, runs } = setup(catalogue());

    press("5");
    jest.advanceTimersByTime(CHORD_WINDOW_MS);
    expect(keymap.state().count).toBeNull();

    press("y");
    expect(runs.at(-1)).toEqual(["yes", { count: 1, combo: "y" }]);
  });

  it("lists only countable commands while a count is building", () => {
    const { keymap, press } = setup(catalogue());

    press("5");

    expect(keymap.state().candidates.map((c) => c.id)).toEqual([
      "yes",
      "down",
      "pick",
    ]);
  });

  it("leaves digits alone when no countable command answers", () => {
    const { keymap } = setup([binding({ id: "mute", keys: ["m"] })]);

    const event = keydown("5");
    keymap.dispatch(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(keymap.state().count).toBeNull();
  });
});

describe("scopes", () => {
  it("gives a duplicate combo to the innermost active scope", () => {
    const { keymap, press, ran } = setup([
      binding({ id: "global", keys: ["Escape"] }),
      binding({ id: "table", keys: ["Escape"], scope: "table" }),
    ]);

    const release = keymap.pushScope("table");
    press("Escape");

    expect(ran()).toEqual(["table"]);

    release();
    press("Escape");

    expect(ran()).toEqual(["table", "global"]);
  });

  it("keeps a scoped binding silent while its scope is not pushed", () => {
    const { press, ran } = setup([
      binding({ id: "down", keys: ["j"], scope: "table" }),
    ]);

    press("j");

    expect(ran()).toEqual([]);
  });

  it("holds the scope until every push of it is released", () => {
    const { keymap, press, ran } = setup([
      binding({ id: "down", keys: ["j"], scope: "table" }),
    ]);

    const releaseOuter = keymap.pushScope("table");
    const releaseInner = keymap.pushScope("table");
    releaseInner();
    press("j");

    expect(ran()).toEqual(["down"]);

    releaseOuter();
    press("j");

    expect(ran()).toEqual(["down"]);
  });

  it("pops the innermost push of a scope by name", () => {
    const { keymap, press, ran } = setup([
      binding({ id: "down", keys: ["j"], scope: "table" }),
    ]);

    keymap.pushScope("table");
    keymap.pushScope("table");
    keymap.popScope("table");
    press("j");
    keymap.popScope("table");
    press("j");

    expect(ran()).toEqual(["down"]);
  });

  it("releases a push once, however often its release is called", () => {
    const { keymap } = setup([]);

    keymap.pushScope("table");
    const release = keymap.pushScope("table");
    release();
    release();

    expect(keymap.state().scope).toEqual(["global", "table"]);
  });

  it("stops answering once a binding is removed", () => {
    const { keymap, press, ran } = setup([
      binding({ id: "mute", keys: ["m"] }),
    ]);

    keymap.setBindings([]);
    press("m");

    expect(ran()).toEqual([]);
  });

  it("skips a binding whose when is false for the next one down", () => {
    let selected = false;
    const { keymap, press, ran } = setup([
      binding({ id: "close", keys: ["Escape"] }),
      binding({
        id: "clear",
        keys: ["Escape"],
        scope: "table",
        when: () => selected,
      }),
    ]);
    keymap.pushScope("table");

    press("Escape");
    selected = true;
    press("Escape");

    expect(ran()).toEqual(["close", "clear"]);
  });
});

describe("modal scopes", () => {
  const bindings = () => [
    binding({ id: "mute", keys: ["m"] }),
    binding({ id: "down", keys: ["j"], scope: "table" }),
    binding({ id: "confirm", keys: ["mod+Enter"], scope: "dialog" }),
  ];

  it("silences every scope beneath it, the global one included", () => {
    const { keymap, press, ran } = setup(bindings());
    keymap.pushScope("table");

    keymap.pushScope("dialog", { modal: true });
    press("m", "j");
    keymap.dispatch(keydown("Enter", { meta: true }));

    expect(ran()).toEqual(["confirm"]);
  });

  it("stacks: popping the inner modal restores the outer", () => {
    const { keymap, press, ran } = setup(bindings());

    const outer = keymap.pushScope("dialog", { modal: true });
    const inner = keymap.pushScope("dialog", { modal: true });
    inner();
    press("m");
    keymap.dispatch(keydown("Enter", { meta: true }));

    expect(ran()).toEqual(["confirm"]);

    outer();
    press("m");

    expect(ran()).toEqual(["confirm", "mute"]);
  });

  it("lists nothing beneath it as a candidate", () => {
    const { keymap } = setup(bindings());

    keymap.pushScope("dialog", { modal: true });

    expect(keymap.state().candidates.map((c) => c.id)).toEqual(["confirm"]);
  });
});

describe("alsoIn", () => {
  const bindings = () => [
    binding({ id: "mute", keys: ["m"], alsoIn: ["sheet-body"] }),
    binding({ id: "down", keys: ["j"], scope: "table" }),
    binding({ id: "plain", keys: ["p"] }),
  ];

  it("answers above a modal push when an alsoIn scope is pushed above the modal", () => {
    const { keymap, press, ran } = setup(bindings());

    keymap.pushScope("dialog", { modal: true });
    keymap.pushScope("sheet-body");
    press("m", "p");

    expect(ran()).toEqual(["mute"]);
  });

  it("stays silent under a modal push when no alsoIn scope is pushed", () => {
    const { keymap, press, ran } = setup(bindings());

    keymap.pushScope("dialog", { modal: true });
    press("m");

    expect(ran()).toEqual([]);
  });

  it("stays silent when its alsoIn scope is pushed beneath the modal", () => {
    const { keymap, press, ran } = setup(bindings());

    keymap.pushScope("sheet-body");
    keymap.pushScope("dialog", { modal: true });
    press("m");

    expect(ran()).toEqual([]);
  });

  it("answers in its own scope as before when no alsoIn scope is pushed", () => {
    const { press, ran } = setup(bindings());

    press("m");

    expect(ran()).toEqual(["mute"]);
  });

  it("outranks a shallower binding on the same combo through its deepest scope", () => {
    const { keymap, press, ran } = setup([
      binding({ id: "page", keys: ["e"], scope: "table" }),
      binding({ id: "sheet", keys: ["e"], alsoIn: ["sheet-body"] }),
    ]);

    keymap.pushScope("sheet-body");
    keymap.pushScope("table");
    press("e");
    expect(ran()).toEqual(["page"]);

    keymap.pushScope("sheet-body");
    press("e");
    expect(ran()).toEqual(["page", "sheet"]);
  });

  it("lists it as a candidate only while an answering scope is pushed", () => {
    const { keymap } = setup(bindings());

    keymap.pushScope("dialog", { modal: true });
    expect(keymap.state().candidates.map((c) => c.id)).toEqual([]);

    keymap.pushScope("sheet-body");
    expect(keymap.state().candidates.map((c) => c.id)).toEqual(["mute"]);
  });

  it("opens a chord above a modal push through an alsoIn scope", () => {
    const { keymap, press, ran } = setup([
      binding({ id: "hear-mono", keys: ["h m"], alsoIn: ["sheet-body"] }),
    ]);

    keymap.pushScope("dialog", { modal: true });
    press("h", "m");
    expect(ran()).toEqual([]);

    keymap.pushScope("sheet-body");
    press("h", "m");
    expect(ran()).toEqual(["hear-mono"]);
  });

  it("reports a conflict in an alsoIn scope", () => {
    const { keymap } = setup([
      binding({ id: "mute", keys: ["m"], alsoIn: ["sheet-body"] }),
      binding({ id: "mark", keys: ["m"], scope: "sheet-body" }),
    ]);

    expect(keymap.state().conflicts).toEqual([
      { scope: "sheet-body", combo: "m", ids: ["mute", "mark"] },
    ]);
  });
});

describe("candidates", () => {
  it("names one binding per combo — the one that would answer", () => {
    const { keymap } = setup([
      binding({ id: "close", keys: ["Escape", "q"], label: "Close" }),
      binding({
        id: "clear",
        keys: ["Escape"],
        scope: "table",
        label: "Clear the selection",
      }),
    ]);
    keymap.pushScope("table");

    expect(keymap.state().candidates).toEqual([
      { id: "close", keys: ["q"], label: "Close" },
      { id: "clear", keys: ["Escape"], label: "Clear the selection" },
    ]);
  });

  it("leaves out bindings whose scope is not active", () => {
    const { keymap } = setup([
      binding({ id: "mute", keys: ["m"] }),
      binding({ id: "down", keys: ["j"], scope: "table" }),
    ]);

    expect(keymap.state().candidates.map((c) => c.keys)).toEqual([["m"]]);
  });

  it("leaves out a binding whose when is false", () => {
    const { keymap } = setup([
      binding({ id: "mute", keys: ["m"], when: () => false }),
      binding({ id: "play", keys: ["space"] }),
    ]);

    expect(keymap.state().candidates.map((c) => c.id)).toEqual(["play"]);
  });
});

describe("overrides", () => {
  const bindings = () => [
    binding({ id: "down", keys: ["j", "ArrowDown"] }),
    binding({ id: "up", keys: ["k"] }),
  ];

  it("replaces a command's declared keys", () => {
    const { press, ran } = setup(bindings(), { overrides: { down: ["n"] } });

    press("j", "ArrowDown", "n");

    expect(ran()).toEqual(["down"]);
  });

  it("unbinds a command overridden with no keys", () => {
    const { keymap, press, ran } = setup(bindings(), {
      overrides: { up: [] },
    });

    press("k");

    expect(ran()).toEqual([]);
    expect(keymap.bindings().find((b) => b.id === "up")?.keys).toEqual([]);
  });

  it("applies new overrides as they are set", () => {
    const { keymap, press, ran } = setup(bindings());

    keymap.setOverrides({ up: ["shift+k"] });
    press("k", "K");

    expect(ran()).toEqual(["up"]);
  });

  it("ignores an unknown command and drops a combo that breaks the grammar", () => {
    const { keymap, press, ran } = setup(bindings(), {
      overrides: { gone: ["x"], up: ["shift+1", "K"] },
    });

    press("x", "K");

    expect(ran()).toEqual(["up"]);
    expect(keymap.bindings().find((b) => b.id === "up")?.keys).toEqual([
      "shift+k",
    ]);
  });

  it("stores override combos in canonical spelling", () => {
    const { keymap } = setup(bindings(), { overrides: { down: ["down"] } });

    expect(keymap.bindings().find((b) => b.id === "down")?.keys).toEqual([
      "ArrowDown",
    ]);
  });

  it("keeps both commands mapped to one combo in one scope and reports it", () => {
    const { keymap, press, ran } = setup(bindings(), {
      overrides: { up: ["j"] },
    });

    press("j");

    expect(ran()).toEqual(["up"]);
    expect(keymap.state().conflicts).toEqual([
      { scope: "global", combo: "j", ids: ["down", "up"] },
    ]);
  });

  it("reports no conflict for the same combo in different scopes", () => {
    const { keymap } = setup([
      binding({ id: "close", keys: ["Escape"] }),
      binding({ id: "clear", keys: ["Escape"], scope: "table" }),
    ]);

    expect(keymap.state().conflicts).toEqual([]);
  });
});

describe("subscribe and state", () => {
  it("tells a listener when the pending state changes", () => {
    const { keymap, press } = setup([binding({ id: "top", keys: ["g g"] })]);
    const listener = mock();
    keymap.subscribe(listener);

    press("g");

    expect(listener).toHaveBeenCalled();
    expect(keymap.state().pending).toEqual(["g"]);
  });

  it("stops telling a listener once it unsubscribes", () => {
    const { keymap, press } = setup([binding({ id: "top", keys: ["g g"] })]);
    const listener = mock();
    const unsubscribe = keymap.subscribe(listener);

    unsubscribe();
    press("g");

    expect(listener).not.toHaveBeenCalled();
  });

  it("hands back the same state object until something in it changes", () => {
    const { keymap, press } = setup([binding({ id: "top", keys: ["g g"] })]);

    const first = keymap.state();
    expect(keymap.state()).toBe(first);

    press("g");
    const pending = keymap.state();
    expect(pending).not.toBe(first);
    expect(keymap.state()).toBe(pending);
  });

  it("reports the scope stack, global first", () => {
    const { keymap } = setup([]);

    keymap.pushScope("table");
    keymap.pushScope("dialog", { modal: true });

    expect(keymap.state().scope).toEqual(["global", "table", "dialog"]);
  });

  it("drops a pending chord and count on reset without running anything", () => {
    const { keymap, press, ran } = setup([
      binding({ id: "go", keys: ["g"] }),
      binding({ id: "top", keys: ["g g"], countable: true }),
    ]);

    press("3", "g");
    keymap.reset();
    jest.advanceTimersByTime(CHORD_WINDOW_MS * 2);

    expect(keymap.state()).toMatchObject({ pending: [], count: null });
    expect(ran()).toEqual([]);
  });
});

describe("formatCombo", () => {
  it("prints a key the way the catalogue's strip does", () => {
    expect(formatCombo("j", true)).toBe("j");
    expect(formatCombo("shift+j", true)).toBe("J");
    expect(formatCombo("g g", true)).toBe("gg");
    expect(formatCombo("ArrowDown", true)).toBe("↓");
    expect(formatCombo("Enter", true)).toBe("↵");
    expect(formatCombo("Escape", true)).toBe("esc");
    expect(formatCombo("space", true)).toBe("space");
    expect(formatCombo("?", true)).toBe("?");
  });

  it("prints the platform modifier for the platform", () => {
    expect(formatCombo("mod+z", true)).toBe("⌘Z");
    expect(formatCombo("mod+z", false)).toBe("Ctrl+Z");
    expect(formatCombo("mod+shift+z", true)).toBe("⇧⌘Z");
    expect(formatCombo("mod+shift+z", false)).toBe("Ctrl+Shift+Z");
    expect(formatCombo("shift+ArrowRight", true)).toBe("⇧→");
    expect(formatCombo("alt+k", false)).toBe("Alt+K");
  });
});
