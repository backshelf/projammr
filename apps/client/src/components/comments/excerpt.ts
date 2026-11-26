/**
 * A comment's opening, short enough to sit inside a floating note without
 * opening the thread. Newlines collapse to spaces so a multi-line comment
 * reads as one line, and the cut lands on a word boundary rather than
 * splitting mid-word.
 */
export const excerptOf = (text: string, max = 90): string => {
  const flat = text.trim().replace(/\s+/g, " ");
  if (flat.length <= max) return flat;

  const cut = flat.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  const trimmed = lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
  return `${trimmed}…`;
};
