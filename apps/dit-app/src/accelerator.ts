/**
 * The global shortcut as the app registers it: modifiers in the order Ctrl, Alt, Shift, Super, then the key, joined
 * with `+` ("Alt+Shift+D"). The key is named from the physical key (`KeyboardEvent.code`), so Option's alternate
 * characters on a Mac cannot change what was pressed.
 */

/** The press a recorder reads off a keydown: a shortcut, or why this press cannot be one. */
export type Capture = { accelerator: string } | { refusal: string };

type PressLike = Pick<
  KeyboardEvent,
  "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey"
>;

const NAMED_KEYS: Readonly<Record<string, string>> = {
  Space: "Space",
  Enter: "Enter",
  Tab: "Tab",
  Backspace: "Backspace",
  Delete: "Delete",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  Comma: "Comma",
  Period: "Period",
  Slash: "Slash",
  Backslash: "Backslash",
  Semicolon: "Semicolon",
  Quote: "Quote",
  BracketLeft: "BracketLeft",
  BracketRight: "BracketRight",
  Minus: "Minus",
  Equal: "Equal",
  Backquote: "Backquote",
};

const LETTER = /^Key([A-Z])$/;
const DIGIT = /^Digit([0-9])$/;
const FUNCTION_KEY = /^F([1-9]|1[0-9]|2[0-4])$/;

/** What a shortcut needs besides its key, said in the keys' own glyphs. */
export const NEEDS_A_MODIFIER =
  "A shortcut needs ⌃, ⌥ or ⌘ held with the key, or it would fire while you type.";

function keyOf(code: string): string | null {
  const letter = LETTER.exec(code);
  if (letter) return letter[1] ?? null;
  const digit = DIGIT.exec(code);
  if (digit) return digit[1] ?? null;
  if (FUNCTION_KEY.test(code)) return code;
  return NAMED_KEYS[code] ?? null;
}

/**
 * The shortcut a keydown stands for, null while it is only a modifier (or a key with no name here) and the person
 * is still reaching for the rest, and a refusal for a press that would fire while typing: a global shortcut needs
 * Ctrl, Alt or Super (F1 to F24 excepted), and Shift alone is a capital letter.
 */
export function captureShortcut(press: PressLike): Capture | null {
  const key = keyOf(press.code);
  if (key === null) return null;
  if (
    !press.ctrlKey &&
    !press.altKey &&
    !press.metaKey &&
    !FUNCTION_KEY.test(key)
  ) {
    return { refusal: NEEDS_A_MODIFIER };
  }
  const parts = [
    press.ctrlKey && "Ctrl",
    press.altKey && "Alt",
    press.shiftKey && "Shift",
    press.metaKey && "Super",
    key,
  ].filter((part): part is string => part !== false);
  return { accelerator: parts.join("+") };
}

const GLYPHS: Readonly<Record<string, string>> = {
  Ctrl: "⌃",
  Alt: "⌥",
  Shift: "⇧",
  Super: "⌘",
  Up: "↑",
  Down: "↓",
  Left: "←",
  Right: "→",
  Enter: "↵",
  Backspace: "⌫",
  Space: "space",
  Delete: "del",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  BracketLeft: "[",
  BracketRight: "]",
  Minus: "-",
  Equal: "=",
  Backquote: "`",
};

/** An accelerator as the key caps that print it: "Alt+Shift+D" is ⌥, ⇧, D. */
export function shortcutCaps(accelerator: string): string[] {
  return accelerator.split("+").map((part) => GLYPHS[part] ?? part);
}
