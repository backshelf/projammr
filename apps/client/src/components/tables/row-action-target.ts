/**
 * Which rows a single row-level action applies to.
 *
 * Acting from inside a selection acts on the whole selection — the rule the
 * bulk action bar already follows — so right-clicking one of several ticked
 * rows does not silently discard the other ticks. A row outside the selection
 * is its own target, and the selection is left alone.
 *
 * A selection of exactly one is treated as a single-row action: the two mean
 * the same thing, and the single-row path is the cheaper request.
 */
export function rowActionTargetIds(
  rowId: number,
  selectedIds: number[]
): number[] {
  return selectedIds.length > 1 && selectedIds.includes(rowId)
    ? selectedIds
    : [rowId];
}
