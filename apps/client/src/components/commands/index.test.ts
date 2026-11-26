import { describe, expect, it, mock } from "bun:test";

import { GLOBAL_SCOPE, parseCombo } from "@workspace/ui/lib/keymap";

// `TRACK_COMMANDS` imports server actions that load `server-only`; `mock.module`
// is not hoisted, so it runs before the dynamic imports below.
mock.module("server-only", () => ({}));

const { matchActions } =
  await import("@/components/command-palette/action-context");
const { COMMANDS } = await import("@/components/commands/index");

describe("COMMANDS", () => {
  it("declares every id once", () => {
    const ids = COMMANDS.map((command) => command.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("declares only keys the grammar can read", () => {
    for (const command of COMMANDS) {
      for (const key of command.keys ?? []) {
        expect(parseCombo(key)).not.toBeNull();
      }
    }
  });

  it("has no same-scope duplicate combo, other than the shortcuts overlay's own `?`", () => {
    const byScope = new Map<string, Map<string, string[]>>();
    for (const command of COMMANDS) {
      const scope = command.scope ?? GLOBAL_SCOPE;
      const combos = byScope.get(scope) ?? new Map<string, string[]>();
      byScope.set(scope, combos);
      for (const key of command.keys ?? []) {
        const ids = combos.get(key) ?? [];
        ids.push(command.id);
        combos.set(key, ids);
      }
    }

    const duplicates = [...byScope.entries()].flatMap(([scope, combos]) =>
      [...combos.entries()]
        .filter(([, ids]) => ids.length > 1)
        .map(([combo, ids]) => ({ scope, combo, ids }))
    );

    expect(duplicates).toEqual([]);
  });

  // Every combo `GlobalHotkeys`, the old table hotkeys, `lab-hotkeys` and the
  // `v` compare key bound before the registry replaced them, each still on
  // the command it now names, in the same scope.
  const cases: [id: string, scope: string, combo: string][] = [
    ["go-to-project", GLOBAL_SCOPE, "g p"],
    ["go-to-collections", GLOBAL_SCOPE, "g c"],
    ["go-to-tracks", GLOBAL_SCOPE, "g t"],
    ["go-to-sessions", GLOBAL_SCOPE, "g s"],
    ["go-to-settings", GLOBAL_SCOPE, "g ,"],
    ["go-to-notebook", GLOBAL_SCOPE, "g n"],
    ["new-track", GLOBAL_SCOPE, "n t"],
    ["new-collection", GLOBAL_SCOPE, "n c"],
    ["new-session", GLOBAL_SCOPE, "n s"],
    ["new-note", GLOBAL_SCOPE, "n n"],
    ["play-pause", GLOBAL_SCOPE, "space"],
    ["seek-back", GLOBAL_SCOPE, "ArrowLeft"],
    ["seek-forward", GLOBAL_SCOPE, "ArrowRight"],
    ["jump-back", GLOBAL_SCOPE, "shift+ArrowLeft"],
    ["jump-forward", GLOBAL_SCOPE, "shift+ArrowRight"],
    ["next-in-queue", GLOBAL_SCOPE, "]"],
    ["previous-in-queue", GLOBAL_SCOPE, "["],
    ["mute", GLOBAL_SCOPE, "m"],
    ["command-palette", GLOBAL_SCOPE, "mod+k"],
    ["search", GLOBAL_SCOPE, "/"],
    ["toggle-sidebar", GLOBAL_SCOPE, "mod+b"],
    ["toggle-theme", GLOBAL_SCOPE, "d"],
    ["toggle-lab", GLOBAL_SCOPE, "l"],
    ["toggle-mono", GLOBAL_SCOPE, "h m"],
    ["toggle-dim", GLOBAL_SCOPE, "h d"],
    ["keyboard-shortcuts", GLOBAL_SCOPE, "?"],
    ["next-row", "table", "j"],
    ["previous-row", "table", "k"],
    ["open-row", "table", "Enter"],
    ["peek-row", "table", "o"],
    ["select-row", "table", "x"],
    ["clear-cursor", "table", "Escape"],
    ["swap-compare", "track-audio", "v"],
    ["peek-previous", "peek", "ArrowLeft"],
    ["peek-next", "peek", "ArrowRight"],
    ["send-comment", "compose", "mod+Enter"],
    ["grid-move-down", "grid", "ArrowDown"],
    ["grid-extend-down", "grid", "shift+ArrowDown"],
    ["grid-select-all", "grid", "mod+a"],
    ["grid-copy", "grid", "mod+c"],
    ["grid-edit-cell", "grid", "Enter"],
  ];

  it.each(cases)("keeps %s on %s's %s", (id, scope, combo) => {
    const command = COMMANDS.find((candidate) => candidate.id === id);
    expect(command).toBeDefined();
    expect(command?.scope ?? GLOBAL_SCOPE).toBe(scope);
    expect(command?.keys).toContain(combo);
  });

  it("keeps the shortcuts overlay's close on the same `?`, in its own scope", () => {
    const close = COMMANDS.find(
      (command) => command.id === "close-keyboard-shortcuts"
    );
    expect(close?.keys).toContain("?");
    expect(close?.scope).toBe("shortcuts");
  });
});

describe("matchActions", () => {
  const project = { group: "Go to", label: "Project" };
  const track = { group: "New", label: "Track" };
  const rows = [project, track];

  it("matches a query against `group label`", () => {
    expect(matchActions(rows, "go to project")).toEqual([project]);
    expect(matchActions(rows, "track")).toEqual([track]);
    expect(matchActions(rows, "new")).toEqual([track]);
  });

  it("is case-insensitive", () => {
    expect(matchActions(rows, "PROJECT")).toEqual([project]);
  });

  it("returns nothing for a query neither the group nor the label contains", () => {
    expect(matchActions(rows, "session")).toEqual([]);
  });

  it("returns every row for an empty or blank query", () => {
    expect(matchActions(rows, "")).toEqual(rows);
    expect(matchActions(rows, "   ")).toEqual(rows);
  });
});
