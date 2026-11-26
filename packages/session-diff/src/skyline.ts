import type { StructureDiff, TrackRow } from "./structure.js";
import { lastIndexOf, type RowNode, rowTree } from "./tree.js";

/** The longest chain a bar measures; a longer one stands no taller. */
export const CHAIN_CEILING = 8;

/** How many levels of group spans the skyline draws under its bars. */
export const SPAN_LEVELS = 3;

/** What a bar's mark under the baseline says happened to its track. */
export type SkylineMark = "added" | "removed" | "changed";

const MARK_OF: Record<TrackRow["status"], SkylineMark | null> = {
  same: null,
  added: "added",
  removed: "removed",
  renamed: "changed",
  changed: "changed",
};

/** The track kinds a mixer sets apart at its right-hand end. */
const BUS_KINDS: ReadonlySet<TrackRow["kind"]> = new Set(["return", "master"]);

export type SkylineBar = {
  /** The row's place in the flat list, which its outline row carries too. */
  index: number;
  name: string;
  color?: string;
  /** Chain length against the set's longest (itself held to `CHAIN_CEILING`),
   *  from 0 to 1, so the set's heaviest track always stands full height. */
  level: number;
  mark: SkylineMark | null;
  /** The first of the return and master tracks, which open after a gap. */
  busStart: boolean;
};

/** A group, drawn as a line under the bars it holds. */
export type SkylineSpan = {
  /** The group's own bar and the last bar it holds, both inclusive. */
  from: number;
  to: number;
  /** 0 for a group at the top of the set, 1 for a group inside one, and so on. */
  depth: number;
  name: string;
  color?: string;
};

/** How long a row's chain is in the save the row describes. */
const chainLength = (row: TrackRow): number =>
  row.status === "removed"
    ? row.devices.length
    : row.devices.filter((device) => device.status !== "removed").length;

function spansOf(nodes: RowNode[], depth: number): SkylineSpan[] {
  if (depth >= SPAN_LEVELS) return [];
  return nodes.flatMap((node) =>
    node.children.length === 0
      ? []
      : [
          {
            from: node.index,
            to: lastIndexOf(node),
            depth,
            name: node.row.name,
            color: node.row.color,
          },
          ...spansOf(node.children, depth + 1),
        ]
  );
}

/**
 * The set drawn as a skyline: a bar per track in the order the set reads,
 * each as tall as its chain is long against the set's longest, marked where
 * the save changed it, with every group a span under the bars it holds.
 */
export function skylineOf(diff: StructureDiff): {
  bars: SkylineBar[];
  spans: SkylineSpan[];
} {
  const chains = diff.rows.map((row) =>
    Math.min(chainLength(row), CHAIN_CEILING)
  );
  const longest = Math.max(1, ...chains);
  const bars = diff.rows.map((row, index) => ({
    index,
    name: row.name,
    color: row.color,
    level: chains[index]! / longest,
    mark: MARK_OF[row.status],
    busStart:
      BUS_KINDS.has(row.kind) &&
      !BUS_KINDS.has(diff.rows[index - 1]?.kind ?? row.kind),
  }));

  return { bars, spans: spansOf(rowTree(diff.rows), 0) };
}
