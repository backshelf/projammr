const NAMED_KEYS: Record<string, string> = {
  shift: "⇧",
  space: "Space",
  Enter: "↵",
  Escape: "Esc",
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
};

/** A combo as the keys a reader presses: one array per chord half, each of
 *  those a modifier-and-key run held down together. Shared by the shortcuts
 *  overlay (one `<kbd>` per key) and the palette row (a single joined
 *  string), so a combo reads the same way in both places. */
export function comboKeys(combo: string, apple: boolean): string[][] {
  return combo.split(" ").map((segment) =>
    segment.split("+").map((key) => {
      if (key === "mod") return apple ? "⌘" : "Ctrl";
      if (key === "alt") return apple ? "⌥" : "Alt";
      return NAMED_KEYS[key] ?? (key.length === 1 ? key.toUpperCase() : key);
    })
  );
}

/** A combo as one line of text — the palette row's dense shortcut hint,
 *  chords joined by a space, held-together keys by "+". */
export function comboLabel(combo: string, apple: boolean): string {
  return comboKeys(combo, apple)
    .map((segment) => segment.join("+"))
    .join(" ");
}
