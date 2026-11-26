import { z } from "zod";

/** A control's options from a record of labels, in the record's order. */
export const optionsOf = <V extends string>(
  labels: Readonly<Record<V, string>>
): { value: V; label: string }[] =>
  (Object.keys(labels) as V[]).map((value) => ({
    value,
    label: labels[value],
  }));

/** A control's options from plain values, each labelled as itself. */
export const listed = <V extends string>(
  values: readonly V[]
): { value: V; label: string }[] =>
  values.map((value) => ({ value, label: value }));

/**
 * A list the viewer arranges: its items in their order, each naming one of
 * the app's own ids at most once, and whether it shows.
 */
export const arrangedList = <T extends { id: string; shown: boolean }>(
  item: z.ZodType<T>
) =>
  z
    .array(item)
    .refine(
      (items) => new Set(items.map(({ id }) => id)).size === items.length,
      { message: "Each item is listed once." }
    );

/**
 * A stored arranged list made whole against its default: the stored rows
 * whose id the default names (stored order, an id's first row winning), then
 * each default row the stored list leaves out, so an id the store has never
 * heard of is shown, with the default's row for it.
 */
export const completeArrangedList = <T extends { id: string }>(
  stored: readonly T[],
  defaults: readonly T[]
): T[] => {
  const known = new Set(defaults.map(({ id }) => id));
  const kept = new Map<string, T>();
  for (const row of stored) {
    if (known.has(row.id) && !kept.has(row.id)) kept.set(row.id, row);
  }
  return [...kept.values(), ...defaults.filter(({ id }) => !kept.has(id))];
};

/** Every id of a list, in the list's own order, and each one shown. */
export const allShown = <Id extends string>(ids: readonly Id[]) =>
  ids.map((id) => ({ id, shown: true }));
