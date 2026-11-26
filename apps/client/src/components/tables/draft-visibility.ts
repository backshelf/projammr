/** A row as the settle predicate reads it: its table row id and the section it
 *  belongs to. */
export type SectionedRow = {
  id: string;
  sectionKey: string;
};

const NONE: ReadonlySet<string> = new Set();

/**
 * The rows a draft row displaces when it opens: the rows of the draft's own
 * section that follow it in render order.
 *
 * Rows of other sections keep their place in the animation and take their new
 * position at once, so a draft opened under one group header never costs
 * Motion a measurement on the whole table. A draft with nothing below it in
 * its section — the one under the last row of the grid — displaces nothing.
 *
 * @param draftIndex where the draft sits among `rows`; negative when its
 * section holds no rows yet.
 */
export function siblingsToSettle(
  rows: readonly SectionedRow[],
  draftIndex: number,
  sectionKey: string
): ReadonlySet<string> {
  if (draftIndex < 0) return NONE;

  const settling = new Set<string>();
  for (let i = draftIndex; i < rows.length; i++) {
    const row = rows[i]!;
    if (row.sectionKey === sectionKey) settling.add(row.id);
  }
  return settling;
}
