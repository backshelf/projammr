/**
 * The keys grammar: how a key press is spelled, so a binding declared in code,
 * a combo stored in settings and a press the keyboard delivers compare as
 * plain strings.
 *
 * - A press is its modifiers in the order `mod`, `shift`, `alt`, then its key,
 *   joined by `+`: `mod+shift+alt+Enter`. `mod` is ⌘ on Apple platforms and
 *   Ctrl elsewhere.
 * - A letter is lowercase; an uppercase letter is `shift+<letter>`, read from
 *   the key value rather than the Shift key, so Caps Lock `J` is `shift+j`.
 *   Under `mod` or `alt` a letter's case is unreliable across platforms, so
 *   there `shift` comes from the Shift key itself.
 * - Any other printable character is the one the browser delivered, with no
 *   `shift`: shifted `/` is `?`. The key value follows the layout, never the
 *   physical key.
 * - A named key keeps the browser's `KeyboardEvent.key` name (`ArrowDown`,
 *   `Enter`, `Escape`, `PageUp`, `F5`) and reports `shift`, which it has no
 *   other way to show. The space bar is `space`.
 * - A combo is one press, or a chord of two presses separated by a space whose
 *   first press is a bare letter `a`–`z`: `g t`.
 *
 * Pure and dependency-free: the ui keymap engine and the server both read it.
 */

/** A key press, or a two-press chord, in the grammar's canonical spelling. */
export type Combo = string;

/** The parts of a keyboard event the grammar reads. */
export type KeyEventLike = {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
};

/** Keys that only modify another key; a press of one alone names nothing. */
const MODIFIER_KEYS = new Set([
  "Alt",
  "AltGraph",
  "CapsLock",
  "Control",
  "Fn",
  "FnLock",
  "Hyper",
  "Meta",
  "NumLock",
  "OS",
  "ScrollLock",
  "Shift",
  "Super",
  "Symbol",
  "SymbolLock",
]);

const FUNCTION_KEYS = Array.from({ length: 24 }, (_, i) => `F${i + 1}`);

/** The named keys the grammar knows, spelled as the browser spells them. */
const NAMED_KEYS = new Set([
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "Backspace",
  "Delete",
  "End",
  "Enter",
  "Escape",
  "Home",
  "Insert",
  "PageDown",
  "PageUp",
  "Tab",
  ...FUNCTION_KEYS,
]);

const SPACE = "space";

/**
 * Written spellings of a named key, lowercased, to its canonical name: every
 * canonical name in any case, plus the short arrow names.
 */
const NAMED_SPELLINGS = new Map<string, string>([
  ...[...NAMED_KEYS, SPACE].map((name) => [name.toLowerCase(), name] as const),
  ["down", "ArrowDown"],
  ["up", "ArrowUp"],
  ["left", "ArrowLeft"],
  ["right", "ArrowRight"],
]);

/** A bare letter, the only press a chord may open with. */
const CHORD_OPENER = /^[a-z]$/;

type Modifiers = { mod: boolean; shift: boolean; alt: boolean };

function pressOf({ mod, shift, alt }: Modifiers, key: string): Combo {
  const parts: string[] = [];
  if (mod) parts.push("mod");
  if (shift) parts.push("shift");
  if (alt) parts.push("alt");
  parts.push(key);
  return parts.join("+");
}

/** A single printable character: one code point that is not whitespace. */
function isPrintable(key: string): boolean {
  return [...key].length === 1 && !/\s/.test(key);
}

/** The lowercase of a letter that has case, or null for anything else. */
function letterOf(key: string): string | null {
  const lower = key.toLowerCase();
  if (lower === key.toUpperCase() || [...lower].length !== 1) return null;
  return lower;
}

/**
 * The combo a key press stands for, or null for a press the grammar cannot
 * name: a modifier on its own, a dead key, a key mid-composition, a media key.
 */
export function canonicalCombo(event: KeyEventLike): Combo | null {
  const { key } = event;
  if (MODIFIER_KEYS.has(key)) return null;

  const mod = Boolean(event.metaKey || event.ctrlKey);
  const alt = Boolean(event.altKey);
  const shiftKey = Boolean(event.shiftKey);

  if (key === " ") return pressOf({ mod, shift: false, alt }, SPACE);
  if (NAMED_KEYS.has(key)) return pressOf({ mod, shift: shiftKey, alt }, key);
  if (!isPrintable(key)) return null;

  const letter = letterOf(key);
  if (letter === null) return pressOf({ mod, shift: false, alt }, key);
  const shift = mod || alt ? shiftKey : key !== letter;
  return pressOf({ mod, shift, alt }, letter);
}

/** One press of written text in canonical form, or null if it is not one. */
function parsePress(text: string): Combo | null {
  // `+` is both the separator and a key: `+` alone, or `mod++`.
  const plus = text === "+" || text.endsWith("++");
  const parts = plus ? text.slice(0, -1).split("+") : text.split("+");
  const key = plus ? "+" : (parts.pop() ?? "");
  if (plus) parts.pop();
  if (key === "") return null;

  const modifiers: Modifiers = { mod: false, shift: false, alt: false };
  for (const part of parts) {
    const name = part.toLowerCase();
    if (name !== "mod" && name !== "shift" && name !== "alt") return null;
    if (modifiers[name]) return null;
    modifiers[name] = true;
  }

  const named = NAMED_SPELLINGS.get(key.toLowerCase());
  if (named === SPACE) {
    return modifiers.shift ? null : pressOf(modifiers, SPACE);
  }
  if (named !== undefined) return pressOf(modifiers, named);
  if (!isPrintable(key)) return null;

  const letter = letterOf(key);
  if (letter === null) {
    return modifiers.shift ? null : pressOf(modifiers, key);
  }
  return pressOf(
    { ...modifiers, shift: modifiers.shift || key !== letter },
    letter
  );
}

/**
 * Written text as a canonical combo, or null when it breaks the grammar.
 * Accepts either vocabulary the apps have spelled keys in (`down` and
 * `ArrowDown`, `J` and `shift+j`, modifiers in any order) and always answers
 * in the canonical one, so a stored combo compares as a string.
 */
export function parseCombo(text: string): Combo | null {
  const presses = text.trim().split(/\s+/);
  if (presses.length > 2) return null;

  const parsed: Combo[] = [];
  for (const press of presses) {
    const combo = parsePress(press);
    if (combo === null) return null;
    parsed.push(combo);
  }

  if (parsed.length === 2 && !CHORD_OPENER.test(parsed[0] ?? "")) return null;
  return parsed.join(" ");
}

/** Whether written text is a combo the grammar accepts. */
export function isValidCombo(text: string): boolean {
  return parseCombo(text) !== null;
}
