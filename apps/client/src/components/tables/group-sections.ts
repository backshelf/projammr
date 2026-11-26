/**
 * Splits a server-ordered page of rows into sections, one per grouping key.
 * Rows are normally contiguous by group, but the server orders groups by a
 * separate column (e.g. `statuses.percentage`), so two distinct keys that share
 * that ordering value can interleave. Each key therefore gets exactly one
 * section, reusing an earlier one if its rows turn out not to be contiguous.
 *
 * `groups` is the server's summary of the *full* filtered set — every group and
 * its cross-page total. A section's header count comes from there, not from the
 * rows on this page, so a group split across a page boundary still shows its
 * real size. A key with no matching summary (should not happen) falls back to
 * the rows present.
 *
 * `getKey` may return several keys for a row (a track under each of its labels
 * or artists); that row is then placed in each of those sections. `null`, `""`,
 * or an empty array put the row in the `__none__` bucket.
 */
export type GroupSummary = { key: string; label: string; count: number };

export type Section<TRow> = {
  key: string;
  label: string;
  count: number;
  rows: TRow[];
};

export function sectionize<TRow>(
  rows: readonly TRow[],
  getKey: (row: TRow) => string | string[] | null,
  groups: readonly GroupSummary[]
): Section<TRow>[] {
  const summaryByKey = new Map(groups.map((g) => [g.key, g]));
  const sections: Section<TRow>[] = [];
  const sectionByKey = new Map<string, Section<TRow>>();

  const keysOf = (row: TRow): string[] => {
    const raw = getKey(row);
    const list = (Array.isArray(raw) ? raw : [raw]).filter(
      (k): k is string => typeof k === "string" && k !== ""
    );
    return list.length > 0 ? list : ["__none__"];
  };

  for (const row of rows) {
    for (const key of keysOf(row)) {
      const existing = sectionByKey.get(key);
      if (existing) {
        existing.rows.push(row);
        continue;
      }
      const summary = summaryByKey.get(key);
      const section: Section<TRow> = {
        key,
        label: summary?.label ?? key,
        count: summary?.count ?? 0,
        rows: [row],
      };
      sections.push(section);
      sectionByKey.set(key, section);
    }
  }

  for (const section of sections) {
    if (section.count === 0) section.count = section.rows.length;
  }

  return sections;
}

/**
 * The filter a section's "Show all" drills into, or `null` when the section
 * offers no drill-in: the page already holds the whole group, the grouping
 * column has no filter param to narrow by, or the section is the "no value"
 * bucket, which has no value to filter on.
 *
 * Both the grid's header row and the card list's sticky header read the same
 * answer from here, so the two presentations of a section agree on when the
 * group is complete.
 */
export function sectionDrillIn<TRow>(
  section: Section<TRow>,
  filterParam: string | undefined
): { param: string; value: string } | null {
  if (section.count <= section.rows.length) return null;
  if (!filterParam || section.key === "__none__") return null;
  return { param: filterParam, value: section.key };
}
