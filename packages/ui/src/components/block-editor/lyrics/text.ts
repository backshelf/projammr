/** Words as a lyricist types them: apostrophes and internal hyphens are part
 * of the word. */
export const WORD = /[A-Za-z][A-Za-z'’-]*[A-Za-z']|[A-Za-z]/g;

/** Curly apostrophes are folded to straight ones so a word typed either way
 * hits the same dictionary entry. */
export const words = (text: string) =>
  (text.match(WORD) ?? []).map((w) => w.replace(/’/g, "'"));

export const lastWord = (text: string) => {
  const all = words(text);
  return all.length ? all[all.length - 1]! : null;
};
