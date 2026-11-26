/** Where a cursor step lands: a row id, nowhere (`null`, no rows), or past the
 *  loaded rows, in which case the row at `load` (an index into `rowIds`) has
 *  to be loaded first. */
export type CursorMove = string | null | { load: number };

/**
 * Where the cursor lands after a step of `delta` rows, `count` times, through
 * `rowIds`. A cursor that is unset, or names a row no longer shown, enters
 * from the side the step points at: down lands on the first row, up on the
 * last, and a count carries on from there.
 *
 * A single step (`count` 1) wraps at either end, but only once `hasMore` is
 * false — everything is loaded. Stepping past the last loaded row while more
 * rows exist returns `{ load }` instead of wrapping, for the caller to load
 * the rows up to that index and move once they land. Stepping back past the
 * first row while more exist has nothing new to load, so the cursor just
 * stays put.
 *
 * A counted step never wraps: it clamps at the first row, and at the last
 * once everything is loaded. Past the last loaded row while more exist it
 * returns `{ load }` like a single step.
 */
export function nextCursor(
  rowIds: string[],
  current: string | null,
  delta: 1 | -1,
  { hasMore }: { hasMore: boolean },
  count = 1
): CursorMove {
  const total = rowIds.length;
  if (total === 0) return null;

  const index = current == null ? -1 : rowIds.indexOf(current);
  const entering = index === -1;
  const from = entering ? (delta === 1 ? -1 : total) : index;
  const target = from + delta * count;
  const wraps = count === 1 && !entering;

  if (target >= total) {
    if (hasMore) return { load: target };
    return rowIds[wraps ? 0 : total - 1]!;
  }
  if (target < 0) {
    if (!wraps) return rowIds[0]!;
    return hasMore ? current! : rowIds[total - 1]!;
  }
  return rowIds[target]!;
}
