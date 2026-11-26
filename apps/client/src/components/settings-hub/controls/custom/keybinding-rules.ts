import { comboLabel } from "@/components/hotkeys/combo-format";
import { parseCombo } from "@workspace/ui/lib/keymap";

/** A command as the rules see it. */
export type BindableCommand = {
  id: string;
  label: string;
  /** The scope its keys answer in; `GLOBAL_SCOPE` when the command has none. */
  scope: string;
  /** Its declared keys, canonical. */
  defaults: readonly string[];
  /** Must keep at least one key. */
  reserved?: boolean;
  /** May take a digit key. */
  digits?: boolean;
  /** Not rebindable at all. */
  fixed?: boolean;
  /** Runs inside text fields (`allowInInput`), so a key that types is refused. */
  typing?: boolean;
};

/** Command id → the combos that replace its defaults; `[]` is unbound. */
export type KeyOverrides = Readonly<Record<string, readonly string[]>>;

type Other = { id: string; label: string };

export type Refusal =
  | { kind: "invalid"; combo: string }
  | { kind: "fixed" }
  | { kind: "must-keep-key" }
  | { kind: "digit"; combo: string }
  /** `combo` would type a character, and the command runs inside text fields. */
  | { kind: "types"; combo: string }
  | { kind: "taken"; combo: string; other: Other }
  /** `combo` is a bare letter and `other` has the chord `chord` opening with it. */
  | { kind: "opens-chord"; combo: string; other: Other; chord: string }
  /** `combo` is a chord whose first press `other` already has on its own. */
  | { kind: "behind-single"; combo: string; other: Other };

/** A bare letter, the only press a chord may open with. */
const CHORD_OPENER = /^[a-z]$/;

const DIGIT = /^[0-9]$/;

/** A canonical press split into its modifiers (`mod+shift+alt+`, in that
 *  order) and its key. */
const PRESS = /^((?:mod\+)?(?:shift\+)?(?:alt\+)?)(.+)$/;

/** Whether a press would type into a text field: no `mod` or `alt`, and a
 *  printable key or the space bar. */
function typesText(press: string): boolean {
  const [, modifiers = "", key = ""] = PRESS.exec(press) ?? [];
  if (modifiers.includes("mod+") || modifiers.includes("alt+")) return false;
  return key === "space" || [...key].length === 1;
}

/** The keys that run a command now: its override when it has one, else its
 *  defaults. */
export function effectiveKeys(
  command: BindableCommand,
  overrides: KeyOverrides
): readonly string[] {
  return overrides[command.id] ?? command.defaults;
}

/** Override ids that name no command in the list. */
export function unknownOverrideIds(
  commands: readonly BindableCommand[],
  overrides: KeyOverrides
): string[] {
  const known = new Set(commands.map((command) => command.id));
  return Object.keys(overrides).filter((id) => !known.has(id));
}

/** Whether two key lists hold the same combos, in any order. */
export function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const set = new Set(a);
  return set.size === new Set(b).size && b.every((key) => set.has(key));
}

function otherOf(command: BindableCommand): Other {
  return { id: command.id, label: command.label };
}

/** What one combo runs into among the other commands' keys in its scope. */
function clash(
  combo: string,
  others: readonly { command: BindableCommand; keys: readonly string[] }[]
): Refusal | null {
  const [first] = combo.split(" ");
  const isChord = combo.includes(" ");
  for (const { command, keys } of others) {
    for (const key of keys) {
      if (key === combo) {
        return { kind: "taken", combo, other: otherOf(command) };
      }
      if (!isChord && CHORD_OPENER.test(combo) && key.startsWith(`${combo} `)) {
        return {
          kind: "opens-chord",
          combo,
          other: otherOf(command),
          chord: key,
        };
      }
      if (isChord && key === first) {
        return { kind: "behind-single", combo, other: otherOf(command) };
      }
    }
  }
  return null;
}

/** Every rule `keys` breaks as `id`'s binding, in the order a reader should
 *  hear them: a refusal about the command as a whole, else one per combo. */
function refusalsFor(
  commands: readonly BindableCommand[],
  overrides: KeyOverrides,
  command: BindableCommand,
  keys: readonly string[]
): Refusal[] {
  if (command.fixed) {
    return sameSet(keys, effectiveKeys(command, overrides))
      ? []
      : [{ kind: "fixed" }];
  }
  if (command.reserved && keys.length === 0) return [{ kind: "must-keep-key" }];

  const others = commands
    .filter((c) => c.id !== command.id && c.scope === command.scope)
    .map((c) => ({ command: c, keys: effectiveKeys(c, overrides) }));

  const refusals: Refusal[] = [];
  for (const combo of new Set(keys)) {
    if (parseCombo(combo) !== combo) {
      refusals.push({ kind: "invalid", combo });
    } else if (DIGIT.test(combo) && !command.digits) {
      refusals.push({ kind: "digit", combo });
    } else if (command.typing && combo.split(" ").some(typesText)) {
      refusals.push({ kind: "types", combo });
    } else {
      const refusal = clash(combo, others);
      if (refusal) refusals.push(refusal);
    }
  }
  return refusals;
}

function commandById(
  commands: readonly BindableCommand[],
  id: string
): BindableCommand {
  const command = commands.find((c) => c.id === id);
  if (!command) throw new Error(`Unknown command: ${id}`);
  return command;
}

/**
 * The first reason `keys` may not become command `id`'s bindings, or null when
 * they may. Conflicts are checked against the other commands' effective keys,
 * in the same scope only. A `fixed` command refuses any change; setting it to
 * the keys it already has is not one.
 */
export function checkBinding(
  commands: readonly BindableCommand[],
  overrides: KeyOverrides,
  id: string,
  keys: readonly string[]
): Refusal | null {
  const command = commandById(commands, id);
  return refusalsFor(commands, overrides, command, keys)[0] ?? null;
}

/** Every refusal the current map would give its own keys, one entry per clash,
 *  so a clash between two commands is listed against each of them. */
export function conflicts(
  commands: readonly BindableCommand[],
  overrides: KeyOverrides
): { id: string; refusal: Refusal }[] {
  return commands.flatMap((command) =>
    refusalsFor(
      commands,
      overrides,
      command,
      effectiveKeys(command, overrides)
    ).map((refusal) => ({ id: command.id, refusal }))
  );
}

/** A refusal as the sentence the control shows under the key. */
export function refusalText(refusal: Refusal, apple: boolean): string {
  switch (refusal.kind) {
    case "taken":
      return `${comboLabel(refusal.combo, apple)} already runs ${refusal.other.label}.`;
    case "opens-chord":
      return `${comboLabel(refusal.combo, apple)} opens a chord (${comboLabel(refusal.chord, apple)}: ${refusal.other.label}).`;
    case "behind-single": {
      const [first = refusal.combo] = refusal.combo.split(" ");
      return `${comboLabel(first, apple)} already runs ${refusal.other.label}, so it can't open a chord.`;
    }
    case "must-keep-key":
      return "This command must keep a key.";
    case "digit":
      return "Digits are kept for counts and seeking.";
    case "types":
      return `${comboLabel(refusal.combo, apple)} types text, and this command runs while you type. Add ${apple ? "⌘" : "Ctrl"} or ${apple ? "⌥" : "Alt"}.`;
    case "fixed":
      return "This key can't be changed.";
    case "invalid":
      return "That key can't be bound.";
  }
}
