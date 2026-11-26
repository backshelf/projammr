import type { SaveMeta, SessionTrack } from "./meta.js";
import { pluralizeCount } from "./format.js";
import { type DiffChip, type Facet, MINUS, signed } from "./facet.js";

/** How many per-track device changes are spelled out before they are summed. */
const MAX_DEVICE_CHIPS = 3;

const sameDevices = (a: SessionTrack, b: SessionTrack): boolean =>
  a.devices.length === b.devices.length &&
  a.devices.every((device, i) => device === b.devices[i]);

/**
 * The tracks present in `b` but not `a`, and vice versa, matched by name. A
 * track keeps its identity across a save as long as it keeps its name.
 */
export function partitionTracks(
  before: SessionTrack[],
  after: SessionTrack[]
): { added: SessionTrack[]; removed: SessionTrack[] } {
  const beforeNames = new Set(before.map((t) => t.name));
  const afterNames = new Set(after.map((t) => t.name));
  return {
    added: after.filter((t) => !beforeNames.has(t.name)),
    removed: before.filter((t) => !afterNames.has(t.name)),
  };
}

/**
 * Renaming a track looks exactly like removing one and adding another. A pair
 * that sits at the same index, is the same kind and carries the same devices is
 * read as the one track it almost certainly is, and reported as a rename rather
 * than as an unrelated add and remove.
 */
export function pairRenames(
  added: SessionTrack[],
  removed: SessionTrack[],
  before: SessionTrack[],
  after: SessionTrack[]
): {
  renames: { from: string; to: string }[];
  added: SessionTrack[];
  removed: SessionTrack[];
} {
  const renames: { from: string; to: string }[] = [];
  const pairedAdds = new Set<SessionTrack>();
  const pairedRemoves = new Set<SessionTrack>();

  for (const gone of removed) {
    const index = before.indexOf(gone);
    const candidate = after[index];
    if (
      candidate &&
      added.includes(candidate) &&
      !pairedAdds.has(candidate) &&
      candidate.kind === gone.kind &&
      sameDevices(candidate, gone)
    ) {
      renames.push({ from: gone.name, to: candidate.name });
      pairedAdds.add(candidate);
      pairedRemoves.add(gone);
    }
  }

  return {
    renames,
    added: added.filter((t) => !pairedAdds.has(t)),
    removed: removed.filter((t) => !pairedRemoves.has(t)),
  };
}

/** Both saves' tracks, split into what was added, removed and renamed. */
function trackChanges(before: SaveMeta | null, after: SaveMeta) {
  const a = before?.structure?.tracks ?? [];
  const b = after.structure?.tracks ?? [];
  const partitioned = partitionTracks(a, b);
  return {
    a,
    b,
    ...pairRenames(partitioned.added, partitioned.removed, a, b),
  };
}

/**
 * Per-track device changes, for the tracks that exist in both saves. Beyond a
 * few tracks the individual chips stop being readable, so the tail is summed
 * into a single count.
 */
function deviceChips(
  before: SessionTrack[],
  after: SessionTrack[]
): DiffChip[] {
  const beforeByName = new Map(before.map((t) => [t.name, t]));
  const chips: DiffChip[] = [];
  let extra = 0;

  for (const track of after) {
    const was = beforeByName.get(track.name);
    if (!was) continue;

    const had = new Set(was.devices);
    const has = new Set(track.devices);
    const added = track.devices.filter((d) => !had.has(d));
    const removed = was.devices.filter((d) => !has.has(d));

    const entries: { label: string; sign: "add" | "remove" }[] = [
      ...added.map((d) => ({
        label: `+${d} on ${track.name}`,
        sign: "add" as const,
      })),
      ...removed.map((d) => ({
        label: `${MINUS}${d} on ${track.name}`,
        sign: "remove" as const,
      })),
    ];
    for (const entry of entries) {
      if (chips.length < MAX_DEVICE_CHIPS) {
        chips.push({ kind: "devices", ...entry });
      } else {
        extra++;
      }
    }
  }

  if (extra > 0) {
    chips.push({
      kind: "devices",
      label: pluralizeCount(extra, "device change"),
    });
  }
  return chips;
}

/**
 * The set's tracks and what is on them: tracks added and removed, renames,
 * and the devices each surviving track gained or lost. The card draws this
 * facet as the skyline and the outline rather than as a readout.
 */
export const structureFacet: Facet = {
  id: "structure",
  capability: "structure",
  compare(before, after) {
    const { a, b, renames, added, removed } = trackChanges(before, after);
    const chips: DiffChip[] = [];

    if (added.length > 0) {
      chips.push({ kind: "tracks", ...signed(added.length, "track") });
    }
    if (removed.length > 0) {
      chips.push({ kind: "tracks", ...signed(-removed.length, "track") });
    }
    for (const { from, to } of renames) {
      chips.push({ kind: "rename", label: `${from} → ${to}`, from, to });
    }
    chips.push(...deviceChips(a, b));

    return chips.length > 0 ? { chips } : null;
  },
};

/** One device on a track's chain, in diff mode. */
export type DeviceRow = {
  name: string;
  status: "same" | "added" | "removed";
  origin: "builtin" | "plugin";
  /** The plugin format it is hosted in ("vst3", "clap"); absent for the DAW's own devices. */
  host?: string;
};

/** One track row of an outline, in `after` order (a removed track sits where
 *  it stood in `before`). */
export type TrackRow = {
  /** Stable across renders: the row's status and name are not unique alone,
   *  since Live allows duplicate track names, so the row's position joins them. */
  key: string;
  kind: SessionTrack["kind"];
  name: string;
  /** The former name, when the row is a rename. */
  was?: string;
  status: "same" | "added" | "removed" | "renamed" | "changed";
  devices: DeviceRow[];
  /** The DAW's own track id, which an outline nests groups by. */
  id?: number;
  /** The `id` of the group this row sits in; absent at the top level. */
  groupId?: number;
  /** The colour the DAW shows the track in, as `#rrggbb`. */
  color?: string;
};

export type StructureDiff = {
  rows: TrackRow[];
  truncated: boolean;
};

/**
 * The set's tracks as rows: every track's status and its device chain, in
 * the order the set reads top to bottom. `before === null` is the plain
 * outline for a session's first known save, every row `same`. Shares
 * `partitionTracks`/`pairRenames` with the structure facet rather than
 * re-deriving rename pairing.
 */
export function diffStructure(
  before: SaveMeta | null,
  after: SaveMeta
): StructureDiff {
  const { a, b, renames, removed } = trackChanges(before, after);
  const plugins = {
    ...before?.structure?.plugins,
    ...after.structure?.plugins,
  };
  const device = (name: string, status: DeviceRow["status"]): DeviceRow => {
    const host = plugins[name]?.host;
    return {
      name,
      status,
      origin: host == null ? "builtin" : "plugin",
      ...(host != null && { host }),
    };
  };

  const renamedTo = new Map(renames.map((r) => [r.to, r.from]));
  const beforeByName = new Map(a.map((t) => [t.name, t]));
  for (const { from, to } of renames)
    beforeByName.set(to, beforeByName.get(from)!);

  const deviceRows = (
    was: SessionTrack | undefined,
    now: SessionTrack
  ): DeviceRow[] => {
    if (!was) return now.devices.map((name) => device(name, "same"));
    const had = new Set(was.devices);
    const has = new Set(now.devices);
    // The new chain in order, with additions marked, then whatever the chain
    // dropped appended at the end.
    return [
      ...now.devices.map((name) =>
        device(name, had.has(name) ? "same" : "added")
      ),
      ...was.devices
        .filter((d) => !has.has(d))
        .map((name) => device(name, "removed")),
    ];
  };

  const rows: TrackRow[] = [];
  let nextRemoved = 0;
  const removedAtIndex = new Map<number, SessionTrack[]>();
  for (const t of removed) {
    const i = a.indexOf(t);
    removedAtIndex.set(i, [...(removedAtIndex.get(i) ?? []), t]);
  }
  // A removed track is emitted at the index it held in `before`, before
  // whatever now stands there, so the outline still reads top to bottom as
  // the set did.
  const pushRemoved = (index: number) => {
    for (const t of removedAtIndex.get(index) ?? []) {
      rows.push({
        key: `removed:${t.name}:${rows.length}`,
        kind: t.kind,
        name: t.name,
        status: "removed",
        id: t.id,
        groupId: t.groupId,
        color: t.color,
        devices: t.devices.map((name) => device(name, "removed")),
      });
    }
  };

  b.forEach((now, i) => {
    while (nextRemoved <= i) pushRemoved(nextRemoved++);
    const was = beforeByName.get(now.name);
    const devices = deviceRows(before ? was : undefined, now);
    const status: TrackRow["status"] = !before
      ? "same"
      : renamedTo.has(now.name)
        ? "renamed"
        : !was
          ? "added"
          : devices.some((d) => d.status !== "same")
            ? "changed"
            : "same";
    rows.push({
      key: `${status}:${now.name}:${rows.length}`,
      kind: now.kind,
      name: now.name,
      was: renamedTo.get(now.name),
      status,
      devices,
      id: now.id,
      groupId: now.groupId,
      color: now.color,
    });
  });
  while (nextRemoved <= a.length) pushRemoved(nextRemoved++);

  return {
    rows,
    truncated: Boolean(
      after.structure?.truncated || before?.structure?.truncated
    ),
  };
}
