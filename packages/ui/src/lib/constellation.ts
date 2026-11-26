/** Where a node's note links out to; the node itself never navigates. */
export type ConstellationLink = { label: string; href: string };

/**
 * One mark in a Constellation, already placed. A set is a circle and an item
 * it uses a square; nothing else about a node is coded in shape or hue, except
 * `warn` (a sample Live can't find).
 */
export type ConstellationNode = {
  id: string;
  label: string;
  meta?: string;
  /** The note's count line: "in 191 sets", "12 devices · +3 own". */
  count: string;
  shape: "circle" | "square";
  x: number;
  y: number;
  /** Radius, or half the side of a square, in screen pixels. */
  size: number;
  warn?: boolean;
  link?: ConstellationLink;
};

/**
 * One drawn edge between two nodes, by index into `nodes`: `weight` runs 0 to
 * 1 with how rare its item is (faint ink at 0, soft ink at 1), `thickness` is
 * in screen pixels, 1 to 3. A tuple, since a library's web carries thousands
 * of them across the wire.
 */
export type ConstellationEdge = readonly [
  source: number,
  target: number,
  weight: number,
  thickness: number,
];

/**
 * A settled drawing: every position is decided before it reaches the browser.
 * `key` changes only when the drawing does, so a re-render with an equal
 * drawing keeps the graph and its camera.
 */
export type ConstellationData = {
  nodes: ConstellationNode[];
  edges: ConstellationEdge[];
  key: string;
};

/** Each node's neighbours and the edges that reach them, by node index. */
export type Adjacency = { neighbours: number[][]; edges: number[][] };

export function adjacencyOf({ nodes, edges }: ConstellationData): Adjacency {
  const neighbours: number[][] = nodes.map(() => []);
  const byNode: number[][] = nodes.map(() => []);
  edges.forEach(([source, target], index) => {
    neighbours[source]?.push(target);
    neighbours[target]?.push(source);
    byNode[source]?.push(index);
    byNode[target]?.push(index);
  });
  return { neighbours, edges: byNode };
}

/**
 * The nodes whose label or meta holds `query`, case-insensitively, the way an
 * inventory's rows filter on the same two lines (a device's manufacturer, a
 * sample's folder). A blank query matches none.
 */
export function matchesOf(
  nodes: readonly ConstellationNode[],
  query: string
): number[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [];
  const matches: number[] = [];
  nodes.forEach((node, index) => {
    if (
      node.label.toLowerCase().includes(needle) ||
      (node.meta ?? "").toLowerCase().includes(needle)
    ) {
      matches.push(index);
    }
  });
  return matches;
}

/** What the drawing lights: these nodes and edges in `--art`, the rest dim.
 *  `held` is the node the neighbourhood is lit around, if one is. */
export type Lit = {
  held: number | null;
  nodes: ReadonlySet<number>;
  edges: ReadonlySet<number>;
};

/**
 * What is lit. A held node (pinned, else hovered) lights itself, its edges and
 * its neighbours. With none held, the search's matches light on their own.
 * With neither, nothing is lit and nothing dims.
 */
export function litOf(
  adjacency: Adjacency,
  held: number | null,
  matches: readonly number[]
): Lit | null {
  if (held !== null) {
    return {
      held,
      nodes: new Set([held, ...(adjacency.neighbours[held] ?? [])]),
      edges: new Set(adjacency.edges[held] ?? []),
    };
  }
  if (matches.length > 0) {
    return { held: null, nodes: new Set(matches), edges: new Set() };
  }
  return null;
}

/** A point in the renderer's framed coordinates, where the whole drawing
 *  spans about one unit at a camera ratio of 1. */
export type FramedPoint = { x: number; y: number };

/**
 * The camera that frames `points`: centred on their box, zoomed so the box
 * fills about three quarters of the view, never closer than `minRatio` and
 * never further out than the whole drawing. No points frames the whole
 * drawing.
 */
export function fitOf(
  points: readonly FramedPoint[],
  minRatio: number
): { x: number; y: number; ratio: number } {
  if (points.length === 0) return { x: 0.5, y: 0.5, ratio: 1 };
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  const span = Math.max(maxX - minX, maxY - minY) / 0.75;
  return {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
    ratio: Math.min(1, Math.max(minRatio, span)),
  };
}
