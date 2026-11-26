import type { Clause } from "../ipc";

/**
 * The commit box's state: what the textarea holds, whether the person has typed in it, and the clauses they have
 * switched off. Until they type, the text is the suggestion with those clauses left out; once they have, the text is
 * theirs, a chip is on while the text still holds its words, and a click edits the text.
 */
export type Composer = {
  text: string;
  /** Whether the person has typed: from then on the suggestion never replaces the text. */
  edited: boolean;
  /** The words of the clauses switched off while the text still follows the suggestion. */
  dropped: readonly string[];
};

const SEPARATOR = ", ";

/** The suggestion's clauses, less the dropped ones, as one line the way the cli joins them. */
function joined(
  clauses: readonly Clause[],
  dropped: readonly string[]
): string {
  return clauses
    .filter((clause) => !dropped.includes(clause.text))
    .map((clause) => clause.text)
    .join(SEPARATOR);
}

/** A box that has not been touched: it holds the whole suggestion. */
export function untouched(clauses: readonly Clause[]): Composer {
  return { text: joined(clauses, []), edited: false, dropped: [] };
}

/** A box that opens on text the person had already written, which the suggestion never replaces. */
export function written(text: string): Composer {
  return { text, edited: true, dropped: [] };
}

/**
 * The box as the suggestion now stands: a box the person has typed in is theirs and is returned as it is; one they
 * have not follows the clauses, forgetting a switched-off clause the suggestion no longer has. Returns the same
 * object when nothing moved, so a render can call it freely.
 */
export function following(
  composer: Composer,
  clauses: readonly Clause[]
): Composer {
  if (composer.edited) return composer;
  const dropped = composer.dropped.filter((text) =>
    clauses.some((clause) => clause.text === text)
  );
  const text = joined(clauses, dropped);
  if (text === composer.text && dropped.length === composer.dropped.length) {
    return composer;
  }
  return { text, edited: false, dropped };
}

/** The box after the person typed `text`. */
export function typed(composer: Composer, text: string): Composer {
  return { ...composer, text, edited: true };
}

/** Whether the chip for `clause` shows pressed: its words are in the message. */
export function isOn(composer: Composer, clause: Clause): boolean {
  return composer.edited
    ? composer.text.includes(clause.text)
    : !composer.dropped.includes(clause.text);
}

/** `text` less the first run of `words`, and the separator that joined it to its neighbour. */
function without(text: string, words: string): string {
  const at = text.indexOf(words);
  if (at < 0) return text;
  const end = at + words.length;
  const next = text.slice(end);
  if (next.startsWith(SEPARATOR)) {
    return text.slice(0, at) + next.slice(SEPARATOR.length);
  }
  const before = text.slice(0, at);
  if (before.endsWith(SEPARATOR)) {
    return before.slice(0, -SEPARATOR.length) + next;
  }
  return before + next;
}

/** `text` with `words` added at its end, after a separator unless the text is empty or ends on one. */
function withAdded(text: string, words: string): string {
  const base = text.trimEnd().replace(/,$/, "");
  return base === "" ? words : `${base}${SEPARATOR}${words}`;
}

/**
 * A click on a clause's chip. On a box the person has not typed in it switches the clause off or on in the
 * suggestion; on one they have, it takes the clause's words out of their text or puts them back at its end.
 */
export function toggled(
  composer: Composer,
  clauses: readonly Clause[],
  clause: Clause
): Composer {
  const on = isOn(composer, clause);
  if (composer.edited) {
    const text = on
      ? without(composer.text, clause.text)
      : withAdded(composer.text, clause.text);
    return { ...composer, text };
  }
  const dropped = on
    ? [...composer.dropped, clause.text]
    : composer.dropped.filter((text) => text !== clause.text);
  return { text: joined(clauses, dropped), edited: false, dropped };
}
