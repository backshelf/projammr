import { pluralizeCount } from "@workspace/session-diff/format";
import type {
  ConstellationData,
  ConstellationEdge,
  ConstellationNode,
} from "@workspace/ui/lib/constellation";
import type { PatchCable, PatchNode } from "@workspace/ui/lib/patchbay";
import { UndirectedGraph } from "graphology";
import circular from "graphology-layout/circular";
import forceAtlas2 from "graphology-layout-forceatlas2";
import noverlap from "graphology-layout-noverlap";

/*
 * The inventory pages' web: the sets and the items they use (devices,
 * samples) as a node-link drawing, laid out here on the server so the browser
 * only ever draws settled positions. ForceAtlas2 and noverlap run in this
 * module alone; a client component must never import it.
 */

/** One set using one item, with how many times it uses it where that is known
 *  (a device's track entries in one session). */
export type WebCable = PatchCable & { uses?: number };

/** What an inventory graph hands the web: the Patchbay's rails and cables. */
export type WebInput = {
  /** The sets, each linking to its session. */
  left: readonly PatchNode[];
  /** The items, each linking to its row. */
  right: readonly PatchNode[];
  cables: readonly WebCable[];
};

export type InventoryWebOptions = {
  /**
   * An item fewer sets than this use is not a node: it counts on each of its
   * sets' notes as "+n own". Plugins keep every device (1); samples fold the
   * ones a single set uses (2), which would be most of the drawing and say
   * nothing about sharing.
   */
  minShared: number;
  /** Draws the stock chain in the web too (`?stock=1`). */
  stock: boolean;
  /** The item's noun on a set's count line: "device", "sample". */
  item: string;
  /**
   * Awaited between passes of the layout, which is up to a second of
   * synchronous work on a large library: a server hands the event loop back
   * here so the page it is part of can stream, and other requests run. With
   * none, the passes run back to back.
   */
  pause?: () => Promise<void>;
};

/** An item the stock chain parks out of the web, listed under it instead. */
export type StockItem = {
  id: string;
  label: string;
  /** How many of the page's sets use it. */
  sets: number;
  href?: string;
};

export type InventoryWeb = {
  web: ConstellationData;
  /** The stock chain, most used first, whether or not it is drawn. */
  stock: StockItem[];
};

/** An item in more than this share of the page's sets is stock chain: the
 *  gear every set carries, which would otherwise carry most of the ink. */
const STOCK_SHARE = 0.4;

/** ...as long as at least this many sets carry it. A project with a handful
 *  of sets has no stock chain: a device in two of its three sets is not the
 *  gear every set carries, and parking it would leave the web empty. */
export const STOCK_MIN_SETS = 5;

/** A set's dot, and the band an item's square scales within (half its side). */
const SET_SIZE = 2.5;
const ITEM_SIZE = { min: 2.5, max: 5.5 } as const;

/** How many pixels the drawing's longer side spans once the camera fits it,
 *  near enough: noverlap reads node sizes in the same unit as positions. */
const FRAME_PX = 1000;
const NOVERLAP_MARGIN_PX = 3;
const FORCE_ITERATIONS = 300;
/** ForceAtlas2 runs in passes of this many iterations, a few tens of
 *  milliseconds each on the largest library, with `pause` between them. */
const FORCE_PASS = 25;
const NOVERLAP_ITERATIONS = 60;

/** An item's rarity: 1 for an item one set uses, about 0.13 for one 190 sets
 *  use. It is both the edge's brightness and its pull in the layout, so a set
 *  settles beside the rare gear it shares rather than the common gear. */
export const rarityOf = (sets: number) => 1 / Math.log2(1 + sets);

/** One to three pixels: a device a set uses on many tracks draws heavier. */
export const thicknessOf = (uses: number | undefined) =>
  uses === undefined ? 1 : Math.min(3, 1 + Math.log2(Math.max(1, uses)));

type Pair = { set: string; item: string; uses?: number };

/** One pair per distinct set and item, uses summed; a cable naming an unknown
 *  id is dropped. */
function pairsOf(
  cables: readonly WebCable[],
  sets: ReadonlyMap<string, PatchNode>,
  items: ReadonlyMap<string, PatchNode>
): Pair[] {
  const pairs = new Map<string, Pair>();
  for (const cable of cables) {
    if (!sets.has(cable.left) || !items.has(cable.right)) continue;
    const key = JSON.stringify([cable.left, cable.right]);
    const pair = pairs.get(key);
    if (!pair) {
      pairs.set(key, { set: cable.left, item: cable.right, uses: cable.uses });
    } else if (cable.uses !== undefined) {
      pair.uses = (pair.uses ?? 0) + cable.uses;
    }
  }
  return [...pairs.values()];
}

function byFirst<T>(nodes: readonly T[], id: (node: T) => string) {
  const map = new Map<string, T>();
  for (const node of nodes) if (!map.has(id(node))) map.set(id(node), node);
  return map;
}

/** FNV-1a over the drawing's identity, so an equal drawing has an equal key. */
function keyOf(parts: readonly string[]): string {
  let hash = 0x811c9dc5;
  for (const part of parts) {
    for (let i = 0; i < part.length; i++) {
      hash ^= part.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    hash ^= 0x1f;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

const round = (value: number) => Math.round(value * 10) / 10;

/**
 * Lays the web out. Items fewer than `minShared` sets use fold into their
 * sets' "+n own"; items more than {@link STOCK_SHARE} of the page's sets use
 * (and at least {@link STOCK_MIN_SETS}) are the stock chain and stay out
 * unless `stock` is on; an item no set uses has nothing to draw. A set left
 * with no drawn edge is not drawn either: everything it carries is the stock
 * chain or its own. What remains is laid out by ForceAtlas2 (Barnes-Hut, edges
 * weighted by rarity) from a circle in input order, then spread by noverlap so
 * no two marks overlap at the fitted zoom. The result depends only on the
 * input, in the order given.
 */
export async function inventoryWeb(
  { left, right, cables }: WebInput,
  { minShared, stock, item, pause }: InventoryWebOptions
): Promise<InventoryWeb> {
  const sets = byFirst(left, (node) => node.id);
  const items = byFirst(right, (node) => node.id);
  const pairs = pairsOf(cables, sets, items);

  const carriers = new Map<string, number>();
  for (const pair of pairs) {
    carriers.set(pair.item, (carriers.get(pair.item) ?? 0) + 1);
  }
  const setsOnPage = new Set(pairs.map((pair) => pair.set)).size;
  const carried = (id: string) => carriers.get(id) ?? 0;

  const folded = (id: string) => carried(id) < minShared;
  const parked = (id: string) =>
    !folded(id) &&
    carried(id) >= STOCK_MIN_SETS &&
    carried(id) > STOCK_SHARE * setsOnPage;

  const stockItems: StockItem[] = [...items.values()]
    .filter((node) => carried(node.id) > 0 && parked(node.id))
    .map((node) => ({
      id: node.id,
      label: node.label,
      sets: carried(node.id),
      ...(node.href === undefined ? {} : { href: node.href }),
    }))
    .sort(
      (a, b) =>
        b.sets - a.sets ||
        (a.label < b.label ? -1 : a.label > b.label ? 1 : 0) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    );

  const drawnItem = (id: string) =>
    carried(id) > 0 && !folded(id) && (stock || !parked(id));
  const drawnPairs = pairs.filter((pair) => drawnItem(pair.item));

  const own = new Map<string, number>();
  const kept = new Map<string, number>();
  for (const pair of pairs) {
    const tally = folded(pair.item) ? own : kept;
    tally.set(pair.set, (tally.get(pair.set) ?? 0) + 1);
  }

  const drawnSets = new Set(drawnPairs.map((pair) => pair.set));
  const setNodes = [...sets.values()].filter((node) => drawnSets.has(node.id));
  const itemNodes = [...items.values()].filter((node) => drawnItem(node.id));

  const widest = Math.max(1, ...itemNodes.map((node) => carried(node.id)));
  const itemSize = (id: string) =>
    widest === 1
      ? ITEM_SIZE.min
      : ITEM_SIZE.min +
        (ITEM_SIZE.max - ITEM_SIZE.min) *
          Math.sqrt((carried(id) - 1) / (widest - 1));

  const nodes: ConstellationNode[] = [
    ...setNodes.map((node): ConstellationNode => {
      const ownCount = own.get(node.id) ?? 0;
      return {
        id: `set:${node.id}`,
        label: node.label,
        ...(node.meta === undefined ? {} : { meta: node.meta }),
        count: [
          pluralizeCount(kept.get(node.id) ?? 0, item),
          ...(ownCount > 0 ? [`+${ownCount} own`] : []),
        ].join(" · "),
        shape: "circle",
        x: 0,
        y: 0,
        size: SET_SIZE,
        ...(node.href === undefined
          ? {}
          : { link: { label: "Open set", href: node.href } }),
      };
    }),
    ...itemNodes.map((node): ConstellationNode => ({
      id: `item:${node.id}`,
      label: node.label,
      ...(node.meta === undefined ? {} : { meta: node.meta }),
      count: `in ${pluralizeCount(carried(node.id), "set")}`,
      shape: "square",
      x: 0,
      y: 0,
      size: round(itemSize(node.id)),
      ...(node.missing ? { warn: true } : {}),
      ...(node.href === undefined
        ? {}
        : { link: { label: "Show row", href: node.href } }),
    })),
  ];

  const index = new Map(nodes.map((node, at) => [node.id, at]));
  const edges: ConstellationEdge[] = drawnPairs.flatMap((pair) => {
    const source = index.get(`set:${pair.set}`);
    const target = index.get(`item:${pair.item}`);
    if (source === undefined || target === undefined) return [];
    return [
      [
        source,
        target,
        Math.round(rarityOf(carried(pair.item)) * 1000) / 1000,
        Math.round(thicknessOf(pair.uses) * 100) / 100,
      ] as const,
    ];
  });

  await place(nodes, edges, pause);

  return {
    web: {
      nodes,
      edges,
      key: keyOf([
        ...nodes.map((node) => node.id),
        ...edges.map((edge) => edge.join("-")),
      ]),
    },
    stock: stockItems,
  };
}

/** Writes settled positions onto `nodes`, in pixels at the fitted zoom. */
async function place(
  nodes: ConstellationNode[],
  edges: ConstellationEdge[],
  pause: (() => Promise<void>) | undefined
) {
  if (nodes.length === 0) return;

  const graph = new UndirectedGraph<
    { x: number; y: number; size: number },
    { weight: number }
  >();
  nodes.forEach((node, at) =>
    graph.addNode(String(at), { x: 0, y: 0, size: node.size })
  );
  for (const [source, target, weight] of edges) {
    graph.mergeEdge(String(source), String(target), { weight });
  }

  circular.assign(graph, { scale: 100 });
  const settings = {
    ...forceAtlas2.inferSettings(graph),
    barnesHutOptimize: graph.order > 100,
    edgeWeightInfluence: 1,
    // Gravity holds the sets that share nothing drawn close to the rest, so
    // they do not stretch the fitted frame; the gentler slow-down settles
    // within the iteration cap.
    gravity: 0.5,
    slowDown: 2,
  };
  for (let done = 0; done < FORCE_ITERATIONS; done += FORCE_PASS) {
    if (done > 0) await pause?.();
    forceAtlas2.assign(graph, {
      iterations: Math.min(FORCE_PASS, FORCE_ITERATIONS - done),
      getEdgeWeight: "weight",
      settings,
    });
  }
  await pause?.();

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  graph.forEachNode((_, { x, y }) => {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  });
  const scale = FRAME_PX / Math.max(maxX - minX, maxY - minY, 1);
  graph.updateEachNodeAttributes((_, attributes) => ({
    ...attributes,
    x: (attributes.x - (minX + maxX) / 2) * scale,
    y: (attributes.y - (minY + maxY) / 2) * scale,
  }));

  noverlap.assign(graph, {
    maxIterations: NOVERLAP_ITERATIONS,
    settings: { margin: NOVERLAP_MARGIN_PX, ratio: 1 },
  });

  graph.forEachNode((key, { x, y }) => {
    const node = nodes[Number(key)];
    if (!node) return;
    node.x = round(x);
    node.y = round(y);
  });
}
