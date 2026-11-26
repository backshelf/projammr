import type { PaletteEmptyGroup } from "@/lib/policies/shell";

/**
 * What an empty palette query offers: the groups the shell policy lists, in
 * its order and each once, those with nothing in them left out; `none` when
 * that leaves nothing at all.
 */
export function emptyQueryGroups(
  order: readonly PaletteEmptyGroup[],
  sizes: Readonly<Record<PaletteEmptyGroup, number>>
): { groups: PaletteEmptyGroup[]; none: boolean } {
  const groups = [...new Set(order)].filter((group) => sizes[group] > 0);
  return { groups, none: groups.length === 0 };
}
