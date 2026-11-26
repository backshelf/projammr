import type { Combo } from "./parse";

/** Named keys as a key cap prints them; any other key prints as it is. */
const NAMED_LABELS: Readonly<Record<string, string>> = {
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  Backspace: "⌫",
  Delete: "del",
  End: "end",
  Enter: "↵",
  Escape: "esc",
  Home: "home",
  Insert: "ins",
  PageDown: "pgdn",
  PageUp: "pgup",
  Tab: "tab",
  space: "space",
};

/**
 * One press as a key cap prints it. A letter keeps its case (`j`, and `J` for
 * `shift+j`), because case is part of the key; under a modifier it takes the
 * keyboard legend's capital (`⌘Z`). Modifiers print as Apple's glyphs in
 * Apple's order on Apple platforms and as words elsewhere.
 */
function formatPress(press: Combo, apple: boolean): string {
  const parts = press === "+" ? ["+"] : press.split("+");
  if (press.endsWith("++")) parts.splice(-2, 2, "+");
  const key = parts.pop() ?? "";
  const mod = parts.includes("mod");
  const alt = parts.includes("alt");
  const shift = parts.includes("shift");

  const letter = key.length === 1 && key.toLowerCase() !== key.toUpperCase();
  const cap =
    NAMED_LABELS[key] ?? (letter && (mod || alt) ? key.toUpperCase() : key);

  if (letter && shift && !mod && !alt) return key.toUpperCase();

  const modifiers = apple
    ? [alt && "⌥", shift && "⇧", mod && "⌘"]
    : [mod && "Ctrl+", alt && "Alt+", shift && "Shift+"];
  return `${modifiers.filter(Boolean).join("")}${cap}`;
}

/** A combo as a key cap prints it: a chord's presses side by side (`gg`). */
export function formatCombo(combo: Combo, apple: boolean): string {
  return combo
    .split(" ")
    .map((press) => formatPress(press, apple))
    .join("");
}
