import type { TrackRow } from "./structure.js";

/** One row of the set with the rows its group holds; `index` is its place in the flat list. */
export type RowNode = { row: TrackRow; index: number; children: RowNode[] };

/**
 * The flat rows as the tree the set actually is, nested by `groupId`. Ids are
 * collected before anything is attached, so a track listed before its group
 * still finds it; a row whose group was truncated away, or a set parsed
 * before track ids were read, stands at the top level.
 */
export function rowTree(rows: TrackRow[]): RowNode[] {
  const nodes: RowNode[] = rows.map((row, index) => ({
    row,
    index,
    children: [],
  }));
  const byId = new Map<number, RowNode>();
  for (const node of nodes) {
    if (node.row.id != null) byId.set(node.row.id, node);
  }

  const roots: RowNode[] = [];
  for (const node of nodes) {
    const { groupId } = node.row;
    const parent = groupId == null ? undefined : byId.get(groupId);
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

/** How many rows a group holds, groups inside it included. */
export const subtreeSize = (node: RowNode): number =>
  node.children.reduce(
    (total, child) => total + subtreeSize(child),
    node.children.length
  );

/** Whether anything a group holds changed, however deep. */
export const subtreeChanged = (node: RowNode): boolean =>
  node.children.some(
    (child) => child.row.status !== "same" || subtreeChanged(child)
  );

/** The index of the last row a group holds, however deep. */
export const lastIndexOf = (node: RowNode): number =>
  node.children.reduce(
    (last, child) => Math.max(last, lastIndexOf(child)),
    node.index
  );
