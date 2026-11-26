import type { SaveMeta, SessionTrack } from "./meta.js";
import { pluralizeCount } from "./format.js";
import { type DiffChip, type Facet, MINUS, signed } from "./facet.js";

/** How many per-track device changes are spelled out before they are summed. */
const MAX_DEVICE_CHIPS = 3;

const sameDevices = (a: SessionTrack, b: SessionTrack): boolean =>
  a.devices.length === b.devices.length &&
  a.devices.every((device, i) => device === b.devices[i]);

const countValues = (items: readonly string[]): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const item of items) {
    counts.set(item, (counts.get(item) ?? 0) + 1);
  }
  return counts;
};

const multisetDiff = (
  before: readonly string[],
  after: readonly string[]
): { added: string[]; removed: string[] } => {
  const beforeCounts = countValues(before);
  const added: string[] = [];
  for (const device of after) {
    const remaining = beforeCounts.get(device) ?? 0;
    if (remaining > 0) beforeCounts.set(device, remaining - 1);
    else added.push(device);
  }

  const afterCounts = countValues(after);
  const removed: string[] = [];
  for (const device of before) {
    const remaining = afterCounts.get(device) ?? 0;
    if (remaining > 0) afterCounts.set(device, remaining - 1);
    else removed.push(device);
  }
  return { added, removed };
};

type TrackNameKey =
  | { kind: "literal"; value: string }
  | { kind: "numbered"; value: string }
  | { kind: "returnLettered"; value: string };

/**
 * 1-based position of each track in its DAW numbering sequence: regular tracks
 * (audio, midi, group, other) share one 1-based counter, return tracks carry
 * their own 1-based letter counter, and master has no number (0).
 */
function trackPositions(
  tracks: readonly SessionTrack[]
): Map<SessionTrack, number> {
  const positions = new Map<SessionTrack, number>();
  let trackNum = 0;
  let returnNum = 0;
  for (const track of tracks) {
    if (track.kind === "return") {
      positions.set(track, ++returnNum);
    } else if (track.kind === "master") {
      positions.set(track, 0);
    } else {
      positions.set(track, ++trackNum);
    }
  }
  return positions;
}

/**
 * Splits off an auto-numbered prefix when a track's name starts with its own
 * 1-based track number (including zero-padded forms like `03 Kick` from `##`)
 * or, for return tracks, its 1-based letter (`A`..`Z`) followed by a separator
 * or end of name.
 */
function trackNameKey(track: SessionTrack, pos: number): TrackNameKey {
  const { name } = track;
  if (track.kind === "return") {
    if (pos >= 1 && pos <= 26) {
      const letter = String.fromCharCode(64 + pos);
      if (
        name.startsWith(letter) &&
        (name.length === 1 || name[1] === " " || name[1] === "-")
      ) {
        return { kind: "returnLettered", value: name.slice(1) };
      }
    }
    return { kind: "literal", value: name };
  }
  if (track.kind === "master") {
    return { kind: "literal", value: name };
  }
  let digitsEnd = 0;
  while (digitsEnd < name.length) {
    const code = name.charCodeAt(digitsEnd);
    if (code < 48 || code > 57) break;
    digitsEnd++;
  }
  if (digitsEnd > 0 && Number(name.slice(0, digitsEnd)) === pos) {
    return { kind: "numbered", value: name.slice(digitsEnd) };
  }
  return { kind: "literal", value: name };
}

/**
 * True when two paired track names differ solely because the track's 1-based
 * position shifted and the DAW updated its leading auto-number prefix.
 */
function isTrackRenumber(
  was: SessionTrack,
  wasPos: number,
  now: SessionTrack,
  nowPos: number
): boolean {
  if (was.name === now.name || wasPos === nowPos) return false;
  const a = trackNameKey(was, wasPos);
  const b = trackNameKey(now, nowPos);
  return a.kind !== "literal" && a.kind === b.kind && a.value === b.value;
}

/**
 * Pairs tracks across two saves: first by stable DAW track id when both sides
 * carry one, then by exact name occurrence order, then by auto-numbered
 * canonical key so shifted `#` / default track numbers pair 1-to-1 rather than
 * colliding or reading as add+remove.
 */
function matchTracks(
  before: SessionTrack[],
  after: SessionTrack[],
  beforePos = trackPositions(before),
  afterPos = trackPositions(after)
): {
  pairs: Map<SessionTrack, SessionTrack>;
  added: SessionTrack[];
  removed: SessionTrack[];
} {
  const pairs = new Map<SessionTrack, SessionTrack>();
  const usedBefore = new Set<SessionTrack>();
  const usedAfter = new Set<SessionTrack>();

  const beforeById = new Map<number, SessionTrack[]>();
  for (const track of before) {
    if (track.id != null) {
      const list = beforeById.get(track.id);
      if (list) list.push(track);
      else beforeById.set(track.id, [track]);
    }
  }
  for (const track of after) {
    if (track.id == null) continue;
    const candidates = beforeById.get(track.id);
    const matched = candidates?.find((candidate) => !usedBefore.has(candidate));
    if (matched) {
      pairs.set(track, matched);
      usedBefore.add(matched);
      usedAfter.add(track);
    }
  }

  const beforeByName = new Map<string, SessionTrack[]>();
  for (const track of before) {
    if (usedBefore.has(track)) continue;
    const list = beforeByName.get(track.name);
    if (list) list.push(track);
    else beforeByName.set(track.name, [track]);
  }
  for (const track of after) {
    if (usedAfter.has(track)) continue;
    const candidates = beforeByName.get(track.name);
    // Avoid pairing two tracks that carry distinct explicit DAW ids.
    const matched = candidates?.find(
      (candidate) =>
        !usedBefore.has(candidate) &&
        (candidate.id == null || track.id == null || candidate.id === track.id)
    );
    if (matched) {
      pairs.set(track, matched);
      usedBefore.add(matched);
      usedAfter.add(track);
    }
  }

  const beforeByKey = new Map<string, SessionTrack[]>();
  for (const track of before) {
    if (usedBefore.has(track)) continue;
    const key = trackNameKey(track, beforePos.get(track) ?? 0);
    if (key.kind === "literal") continue;
    const bucket = `${track.kind}\0${key.kind}\0${key.value}`;
    const list = beforeByKey.get(bucket);
    if (list) list.push(track);
    else beforeByKey.set(bucket, [track]);
  }
  for (const track of after) {
    if (usedAfter.has(track)) continue;
    const key = trackNameKey(track, afterPos.get(track) ?? 0);
    if (key.kind === "literal") continue;
    const candidates = beforeByKey.get(
      `${track.kind}\0${key.kind}\0${key.value}`
    );
    const matched = candidates?.find(
      (candidate) =>
        !usedBefore.has(candidate) &&
        (candidate.id == null || track.id == null || candidate.id === track.id)
    );
    if (matched) {
      pairs.set(track, matched);
      usedBefore.add(matched);
      usedAfter.add(track);
    }
  }

  return {
    pairs,
    added: after.filter((t) => !usedAfter.has(t)),
    removed: before.filter((t) => !usedBefore.has(t)),
  };
}

/**
 * The tracks present in `after` but not `before`, and vice versa, preferring
 * stable track id when present and otherwise matching duplicate names by occurrence.
 */
export function partitionTracks(
  before: SessionTrack[],
  after: SessionTrack[]
): { added: SessionTrack[]; removed: SessionTrack[] } {
  const { added, removed } = matchTracks(before, after);
  return { added, removed };
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

/** Both saves' tracks, paired and split into what was added, removed and renamed. */
function trackChanges(before: SaveMeta | null, after: SaveMeta) {
  const a = before?.structure?.tracks ?? [];
  const b = after.structure?.tracks ?? [];
  const beforePos = trackPositions(a);
  const afterPos = trackPositions(b);
  const matched = matchTracks(a, b, beforePos, afterPos);
  const idRenames: { from: string; to: string }[] = [];
  const renamedTrack = new Map<SessionTrack, string>();

  for (const [now, was] of matched.pairs) {
    if (
      was.name !== now.name &&
      !isTrackRenumber(
        was,
        beforePos.get(was) ?? 0,
        now,
        afterPos.get(now) ?? 0
      )
    ) {
      idRenames.push({ from: was.name, to: now.name });
      renamedTrack.set(now, was.name);
    }
  }

  const indexRenames: { from: string; to: string }[] = [];
  const pairedAdds = new Set<SessionTrack>();
  const pairedRemoves = new Set<SessionTrack>();
  for (const gone of matched.removed) {
    const index = a.indexOf(gone);
    const candidate = b[index];
    if (
      candidate &&
      matched.added.includes(candidate) &&
      !pairedAdds.has(candidate) &&
      candidate.kind === gone.kind &&
      sameDevices(candidate, gone) &&
      (gone.id == null || candidate.id == null || gone.id === candidate.id)
    ) {
      indexRenames.push({ from: gone.name, to: candidate.name });
      matched.pairs.set(candidate, gone);
      renamedTrack.set(candidate, gone.name);
      pairedAdds.add(candidate);
      pairedRemoves.add(gone);
    }
  }

  return {
    a,
    b,
    pairs: matched.pairs,
    renamedTrack,
    renames: [...idRenames, ...indexRenames],
    added: matched.added.filter((t) => !pairedAdds.has(t)),
    removed: matched.removed.filter((t) => !pairedRemoves.has(t)),
  };
}

/**
 * Per-track device changes, for the tracks that exist in both saves. Beyond a
 * few tracks the individual chips stop being readable, so the tail is summed
 * into a single count.
 */
function deviceChips(
  after: SessionTrack[],
  pairs: Map<SessionTrack, SessionTrack>
): DiffChip[] {
  const chips: DiffChip[] = [];
  let extra = 0;

  for (const track of after) {
    const was = pairs.get(track);
    if (!was) continue;

    const { added, removed } = multisetDiff(was.devices, track.devices);

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
    const { b, pairs, renames, added, removed } = trackChanges(before, after);
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
    chips.push(...deviceChips(b, pairs));

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
  const { a, b, pairs, renamedTrack, removed } = trackChanges(before, after);
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

  const deviceRows = (
    was: SessionTrack | undefined,
    now: SessionTrack
  ): DeviceRow[] => {
    if (!was) return now.devices.map((name) => device(name, "same"));
    const hadRemaining = countValues(was.devices);
    const hasRemaining = countValues(now.devices);
    const currentRows = now.devices.map((name) => {
      const remaining = hadRemaining.get(name) ?? 0;
      if (remaining > 0) {
        hadRemaining.set(name, remaining - 1);
        return device(name, "same");
      }
      return device(name, "added");
    });
    const removedRows: DeviceRow[] = [];
    for (const name of was.devices) {
      const remaining = hasRemaining.get(name) ?? 0;
      if (remaining > 0) {
        hasRemaining.set(name, remaining - 1);
      } else {
        removedRows.push(device(name, "removed"));
      }
    }
    return [...currentRows, ...removedRows];
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
    const was = pairs.get(now);
    const formerName = renamedTrack.get(now);
    const devices = deviceRows(before ? was : undefined, now);
    const status: TrackRow["status"] = !before
      ? "same"
      : formerName != null
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
      was: formerName,
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
