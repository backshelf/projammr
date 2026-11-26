/** One row on a Patchbay rail. `id` is unique within its rail; `missing` draws
 *  the node hollow and dashes every cable it has. */
export type PatchNode = {
  id: string;
  label: string;
  meta?: string;
  href?: string;
  missing?: boolean;
};

/** One use: the left node `left` patched to the right node `right`, by id. */
export type PatchCable = { left: string; right: string; missing?: boolean };

/** The rails in drawing order, the cables as row indexes into them, and what
 *  the drawing leaves out: each left node's single-use right nodes (`own`, by
 *  left id) and the rows cut by a cap (`moreLeft`, `moreRight`). */
export type PatchbayLayout = {
  left: PatchNode[];
  right: PatchNode[];
  cables: { left: number; right: number; missing: boolean }[];
  own: Map<string, number>;
  moreLeft: number;
  moreRight: number;
};

/** Every row's fixed height in pixels, so a cable's endpoints and a node's
 *  row are known from its index without measuring the page. */
export const PATCHBAY_ROW_PX = 24;

export type PatchbayOptions = {
  maxLeft?: number;
  maxRight?: number;
};

type Side = "left" | "right";

/** A cable between two known nodes, with `missing` already folded in from
 *  both ends. */
type Pair = { left: string; right: string; missing: boolean };

/** A fixed locale, so a server render and the hydration after it agree. */
const collator = new Intl.Collator("en", { numeric: true });

function byLabel(a: PatchNode, b: PatchNode): number {
  return (
    collator.compare(a.label, b.label) ||
    (a.id === b.id ? 0 : a.id < b.id ? -1 : 1)
  );
}

/** The first node for each id, so one id is never drawn twice. */
function uniqueNodes(nodes: PatchNode[]): Map<string, PatchNode> {
  const byId = new Map<string, PatchNode>();
  for (const node of nodes) if (!byId.has(node.id)) byId.set(node.id, node);
  return byId;
}

/** One pair per distinct (left, right), dashed if any cable between them or
 *  either end is missing; a cable naming an unknown id is dropped. */
function pairsOf(
  cables: PatchCable[],
  leftById: Map<string, PatchNode>,
  rightById: Map<string, PatchNode>
): Pair[] {
  const pairs = new Map<string, Pair>();
  for (const cable of cables) {
    const l = leftById.get(cable.left);
    const r = rightById.get(cable.right);
    if (!l || !r) continue;
    const key = JSON.stringify([l.id, r.id]);
    const missing = Boolean(cable.missing || l.missing || r.missing);
    const pair = pairs.get(key);
    if (pair) pair.missing ||= missing;
    else pairs.set(key, { left: l.id, right: r.id, missing });
  }
  return [...pairs.values()];
}

/** Each node on `side`, by id, to the ids it is patched to across the bay. */
function neighboursOf(pairs: Pair[], side: Side): Map<string, Set<string>> {
  const across: Side = side === "left" ? "right" : "left";
  const map = new Map<string, Set<string>>();
  for (const pair of pairs) {
    const set = map.get(pair[side]) ?? new Set<string>();
    set.add(pair[across]);
    map.set(pair[side], set);
  }
  return map;
}

/** `nodes` sorted by the mean row of their neighbours in `across` (the
 *  barycentre); a node with none sorts last. Stable, so the order `nodes`
 *  arrive in settles a tie. */
function byBarycentre(
  nodes: PatchNode[],
  neighbours: Map<string, Set<string>>,
  across: PatchNode[]
): PatchNode[] {
  const row = new Map(across.map((node, index) => [node.id, index]));
  const centre = new Map(
    nodes.map((node) => {
      const rows = [...(neighbours.get(node.id) ?? [])].flatMap(
        (id) => row.get(id) ?? []
      );
      const mean =
        rows.length > 0
          ? rows.reduce((sum, r) => sum + r, 0) / rows.length
          : Number.POSITIVE_INFINITY;
      return [node.id, mean] as const;
    })
  );
  const at = (node: PatchNode) => centre.get(node.id) ?? 0;
  return [...nodes].sort((a, b) =>
    at(a) === at(b) ? 0 : at(a) < at(b) ? -1 : 1
  );
}

function capped(nodes: PatchNode[], max: number | undefined): PatchNode[] {
  return max === undefined ? nodes : nodes.slice(0, Math.max(0, max));
}

/**
 * Lays two rails out for the Patchbay. A right node only one left node uses
 * leaves the right rail and counts into that left node's `own`. The left rail
 * orders by cable count, most first, then label; the right rail by the mean
 * row of its left neighbours (the barycentre), then label; one more sweep
 * re-orders the left rail by the mean row of its right neighbours, keeping
 * the previous order on a tie. The caps cut each rail after it is ordered,
 * dropping the cables to a cut row. A cable
 * naming an unknown id is dropped. The result depends only on the nodes and
 * cables given, never on the order they arrive in.
 */
export function layoutPatchbay(
  left: PatchNode[],
  right: PatchNode[],
  cables: PatchCable[],
  options: PatchbayOptions = {}
): PatchbayLayout {
  const leftById = uniqueNodes(left);
  const rightById = uniqueNodes(right);
  const pairs = pairsOf(cables, leftById, rightById);

  const own = new Map<string, number>();
  const folded = new Set<string>();
  for (const [rightId, lefts] of neighboursOf(pairs, "right")) {
    if (lefts.size !== 1) continue;
    folded.add(rightId);
    for (const leftId of lefts) own.set(leftId, (own.get(leftId) ?? 0) + 1);
  }

  const drawn = pairs.filter((pair) => !folded.has(pair.right));
  const rightsOfLeft = neighboursOf(drawn, "left");
  const leftsOfRight = neighboursOf(drawn, "right");
  const degree = (node: PatchNode) => rightsOfLeft.get(node.id)?.size ?? 0;

  const firstLeft = [...leftById.values()].sort(
    (a, b) => degree(b) - degree(a) || byLabel(a, b)
  );
  const rightOrder = byBarycentre(
    [...rightById.values()]
      .filter((node) => !folded.has(node.id))
      .sort(byLabel),
    leftsOfRight,
    firstLeft
  );
  const leftOrder = byBarycentre(firstLeft, rightsOfLeft, rightOrder);

  const keptLeft = capped(leftOrder, options.maxLeft);
  const keptRight = capped(rightOrder, options.maxRight);
  const leftRow = new Map(keptLeft.map((node, index) => [node.id, index]));
  const rightRow = new Map(keptRight.map((node, index) => [node.id, index]));

  return {
    left: keptLeft,
    right: keptRight,
    cables: drawn
      .flatMap((pair) => {
        const l = leftRow.get(pair.left);
        const r = rightRow.get(pair.right);
        return l === undefined || r === undefined
          ? []
          : [{ left: l, right: r, missing: pair.missing }];
      })
      .sort((a, b) => a.left - b.left || a.right - b.right),
    own: new Map(
      keptLeft.flatMap((node) => {
        const count = own.get(node.id);
        return count ? [[node.id, count] as const] : [];
      })
    ),
    moreLeft: leftOrder.length - keptLeft.length,
    moreRight: rightOrder.length - keptRight.length,
  };
}
