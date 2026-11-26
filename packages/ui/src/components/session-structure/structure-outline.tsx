import type { SessionTrack } from "@workspace/api/api";
import {
  Row,
  RowMain,
  RowNum,
  Rows,
  RowTitle,
} from "@workspace/ui/components/layout/rows";
import { TrackSwatch } from "@workspace/ui/components/session-structure/track-swatch";
import { pluralizeCount } from "@workspace/session-diff/format";
import { keyedByContent } from "@workspace/ui/lib/keyed";
import type {
  DeviceRow,
  StructureDiff,
  TrackRow,
} from "@workspace/session-diff";
import {
  type RowNode,
  rowTree,
  subtreeChanged,
  subtreeSize,
} from "@workspace/session-diff/tree";
import { LABEL } from "@workspace/ui/lib/shell";
import { cn } from "@workspace/ui/lib/utils";
import {
  IconArrowBackUp,
  IconChevronRight,
  IconDeviceSpeaker,
  IconDots,
  IconFolder,
  IconPiano,
  IconWaveSine,
} from "@tabler/icons-react";
import { Fragment } from "react";

const KIND_GLYPH: Record<
  SessionTrack["kind"],
  { Icon: typeof IconWaveSine; title: string }
> = {
  audio: { Icon: IconWaveSine, title: "Audio track" },
  midi: { Icon: IconPiano, title: "MIDI track" },
  return: { Icon: IconArrowBackUp, title: "Return track" },
  group: { Icon: IconFolder, title: "Group track" },
  master: { Icon: IconDeviceSpeaker, title: "Master track" },
  other: { Icon: IconDots, title: "Other track" },
};

/** Each status's gutter mark, the diff grammar the site's hunks are set in:
 *  `+` added, `−` removed, `~` changed, and what a screen reader hears. */
const GUTTER: Record<
  Exclude<TrackRow["status"], "same">,
  { mark: string; tone: string; word: string }
> = {
  added: { mark: "+", tone: "text-art", word: "Added" },
  removed: { mark: "−", tone: "text-ink-faint", word: "Removed" },
  renamed: { mark: "~", tone: "text-ink-soft", word: "Renamed" },
  changed: { mark: "~", tone: "text-ink-soft", word: "Changed" },
};

/** A device's own mark on a track that survived the save. */
const DEVICE_MARK: Record<DeviceRow["status"], string> = {
  same: "",
  added: "+",
  removed: "−",
};

/** Hidden while a client shows only what changed; a row that changed, or a
 *  group holding one, stays. Whatever carries it also carries
 *  `data-unchanged`, which tells the client a row inside it is hidden. */
const UNCHANGED = "group-data-[mode=changes]/save-diff:hidden";

/** A whole row's treatment in diff mode: an added or removed track colours
 *  its name and its entire device chain, overriding the per-device status. */
function rowTone(row: TrackRow): string | null {
  if (row.status === "added") return "text-art";
  if (row.status === "removed") return "text-ink-faint line-through";
  return null;
}

function deviceTone(row: TrackRow, device: DeviceRow): string {
  const tone = rowTone(row);
  if (tone) return tone;
  if (device.status === "added") return "text-art";
  if (device.status === "removed") return "text-ink-faint line-through";
  return device.origin === "plugin" ? "text-ink" : "text-ink-soft";
}

/** A track's chain in signal order, each device pointing on to the next. */
function DeviceChain({ row }: { row: TrackRow }) {
  if (row.devices.length === 0) return null;
  // A track that came or went is marked as a whole; its devices carry no
  // marks of their own.
  const marked = rowTone(row) == null;

  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
      {keyedByContent(row.devices, (device) => device.name).map(
        ({ key, item: device }, index) => (
          <Fragment key={key}>
            {index > 0 && (
              <IconChevronRight
                size={10}
                aria-hidden
                className="shrink-0 text-ink-faint"
              />
            )}
            <span className="inline-flex min-w-0 items-baseline gap-1">
              <span
                className={cn("truncate text-small", deviceTone(row, device))}
              >
                {marked && DEVICE_MARK[device.status]}
                {device.name}
              </span>
              {device.host != null && (
                <span className={cn(LABEL, "shrink-0 text-ink-faint")}>
                  {device.host}
                </span>
              )}
            </span>
          </Fragment>
        )
      )}
    </span>
  );
}

type Columns = {
  /** Keep a gutter for the diff's marks. */
  marks: boolean;
  /** Keep a place for the DAW's track colours. */
  colors: boolean;
  /** Keep a chevron's width on rows beside a group row. */
  disclosure: boolean;
};

function OutlineRow({
  node,
  columns,
  groupCount,
  hideable = false,
}: {
  node: RowNode;
  columns: Columns;
  /** Set on a group row: how many tracks its subtree holds. */
  groupCount?: number;
  /** The row hides while a client shows only what changed. */
  hideable?: boolean;
}) {
  const { row } = node;
  const { Icon, title } = KIND_GLYPH[row.kind];
  const gutter = row.status === "same" ? null : GUTTER[row.status];

  return (
    <Row
      data-diff-row={node.index}
      data-change={row.status === "same" ? undefined : row.status}
      data-unchanged={hideable ? "" : undefined}
      className={cn(
        "data-hot:bg-[color-mix(in_oklab,var(--ink)_4%,transparent)]",
        hideable && UNCHANGED
      )}
    >
      {/* Positions come off the flat list, so a track keeps the number the
          DAW gives it however deeply it is nested. */}
      <RowNum className="group-data-hot/row:text-art">{node.index + 1}</RowNum>
      {columns.marks && (
        <span
          className={cn(
            "w-2 shrink-0 text-center font-sub text-small leading-none",
            gutter?.tone
          )}
        >
          {gutter && (
            <>
              <span aria-hidden>{gutter.mark}</span>
              <span className="sr-only">{gutter.word}</span>
            </>
          )}
        </span>
      )}
      {columns.colors && <TrackSwatch color={row.color} />}
      {groupCount != null ? (
        <IconChevronRight
          size={12}
          className="shrink-0 text-ink-faint motion-move group-open/disclosure:rotate-90"
        />
      ) : (
        columns.disclosure && <span aria-hidden className="w-3 shrink-0" />
      )}
      <Icon size={14} className="shrink-0 text-ink-faint" title={title} />
      <RowMain className="flex flex-wrap items-baseline gap-x-3 gap-y-1 phone:flex-col phone:items-start">
        <span className="flex min-w-0 items-baseline gap-1.5">
          <RowTitle className={cn("w-auto flex-none", rowTone(row))}>
            {row.name}
          </RowTitle>
          {row.was != null && (
            <span className="truncate text-small text-ink-faint line-through">
              {row.was}
            </span>
          )}
        </span>
        <DeviceChain row={row} />
      </RowMain>
      {groupCount != null && (
        <span className="shrink-0 text-micro text-ink-soft tabular-nums">
          {pluralizeCount(groupCount, "track")}
        </span>
      )}
    </Row>
  );
}

/** How large a group has to be before it arrives shut. Its row carries the
 *  subtree count either way, so a shut group says why it is shut. */
const GROUP_COLLAPSE_THRESHOLD = 8;

/** Far deeper than any real set nests; a bound so ids that somehow point in a
 *  circle render flat rather than recursing forever. */
const MAX_GROUP_DEPTH = 16;

/** A group arrives open unless it is large, and always opens when something
 *  inside it changed — a diff can never hide a change behind a shut row. */
const startsOpen = (node: RowNode): boolean =>
  subtreeChanged(node) || subtreeSize(node) <= GROUP_COLLAPSE_THRESHOLD;

/** A node that neither changed nor holds a change, which a client showing
 *  only the changes hides. */
const unchanged = (node: RowNode): boolean =>
  node.row.status === "same" && !subtreeChanged(node);

/** A run of two or more unchanged rows, folded behind a native disclosure —
 *  cheaper than showing them, and needs no client JS. A single unchanged row
 *  renders in place instead, since folding one row costs more than showing it. */
function CollapsedRun({
  nodes,
  columns,
}: {
  nodes: RowNode[];
  columns: Columns;
}) {
  return (
    <details
      data-unchanged=""
      className={cn("border-t border-rule", UNCHANGED)}
    >
      <summary className="cursor-pointer list-none px-2 py-2.5 text-micro text-ink-soft [&::-webkit-details-marker]:hidden">
        {nodes.length} unchanged tracks
      </summary>
      <div>
        {nodes.map((node) => (
          <OutlineRow key={node.row.key} node={node} columns={columns} />
        ))}
      </div>
    </details>
  );
}

type Block = { fold: boolean; nodes: RowNode[] };

/** Consecutive unchanged rows become one foldable block once there are at least
 *  two of them; everything else renders as its own block of one row. A group is
 *  never folded into a run — it carries its own disclosure already. */
function toBlocks(nodes: RowNode[], collapseUnchanged: boolean): Block[] {
  const blocks: Block[] = [];
  let run: RowNode[] = [];

  const flushRun = () => {
    if (run.length === 0) return;
    blocks.push({ fold: collapseUnchanged && run.length >= 2, nodes: run });
    run = [];
  };

  for (const node of nodes) {
    if (node.row.status === "same" && node.children.length === 0) {
      run.push(node);
    } else {
      flushRun();
      blocks.push({ fold: false, nodes: [node] });
    }
  }
  flushRun();
  return blocks;
}

/** One level of the outline: the tracks at this depth, with each group holding
 *  the level below it. */
function OutlineLevel({
  nodes,
  columns,
  collapseUnchanged,
  depth,
}: {
  nodes: RowNode[];
  columns: Omit<Columns, "disclosure">;
  collapseUnchanged: boolean;
  depth: number;
}) {
  const level: Columns = {
    ...columns,
    disclosure: nodes.some((node) => node.children.length > 0),
  };

  const renderNode = (node: RowNode) =>
    node.children.length === 0 || depth >= MAX_GROUP_DEPTH ? (
      <OutlineRow
        key={node.row.key}
        node={node}
        columns={level}
        hideable={unchanged(node)}
      />
    ) : (
      <details
        key={node.row.key}
        data-unchanged={unchanged(node) ? "" : undefined}
        className={cn("group/disclosure", unchanged(node) && UNCHANGED)}
        open={startsOpen(node)}
      >
        <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
          <OutlineRow
            node={node}
            columns={level}
            groupCount={subtreeSize(node)}
          />
        </summary>
        <div className="pl-4">
          <OutlineLevel
            nodes={node.children}
            columns={columns}
            collapseUnchanged={collapseUnchanged}
            depth={depth + 1}
          />
        </div>
      </details>
    );

  return (
    <>
      {toBlocks(nodes, collapseUnchanged).map((block) =>
        block.fold ? (
          <CollapsedRun
            key={`fold-${block.nodes[0]!.row.key}`}
            nodes={block.nodes}
            columns={level}
          />
        ) : (
          block.nodes.map(renderNode)
        )
      )}
    </>
  );
}

/**
 * A session's track list as an outline: one row per track, led by its
 * position and the DAW's colour for it, with its device chain in signal order
 * inline and groups holding the tracks inside them. In diff mode (`diff` from
 * `diffStructure(before, after)`) a gutter carries each changed row's mark in
 * the diff grammar the site's hunks use, and additions, removals, renames and
 * per-device changes are drawn on the same row shape rather than a separate
 * view. Every row carries its index in the flat list (`data-diff-row`), the
 * same index its skyline bar carries.
 */
export function StructureOutline({
  diff,
  collapseUnchanged = false,
  colors = false,
}: {
  diff: StructureDiff;
  collapseUnchanged?: boolean;
  /** The DAW reports track colours, so every row keeps a swatch. */
  colors?: boolean;
}) {
  const columns = {
    marks: diff.rows.some((row) => row.status !== "same"),
    colors,
  };

  return (
    <Rows>
      <OutlineLevel
        nodes={rowTree(diff.rows)}
        columns={columns}
        collapseUnchanged={collapseUnchanged}
        depth={0}
      />
      {diff.truncated && (
        <div className="border-t border-rule px-2 py-2.5 text-micro text-ink-soft">
          Larger than is recorded; showing the first 256 tracks.
        </div>
      )}
    </Rows>
  );
}
