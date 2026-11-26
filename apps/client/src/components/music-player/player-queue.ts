import {
  MusicPlayerMetadata,
  MusicPlayerTrack,
  RepeatMode,
} from "@/components/music-player/types";
import { arrayMove } from "@dnd-kit/sortable";

/**
 * `order` holds indices into `tracks`; `pos` is an index into `order`, or -1
 * when nothing is loaded. Shuffling rewrites `order` and leaves `tracks` alone,
 * so a track's queue identity (`qIndex`) survives reordering.
 *
 * Removing a track renumbers every `qIndex` above it, so `keys` runs alongside
 * `tracks` with a number that never changes for the life of the entry: what a
 * row is keyed by when it has to be told apart from the row that took its
 * index. `nextKey` is the next one to hand out.
 */
export type Queue = {
  tracks: MusicPlayerTrack[];
  keys: number[];
  nextKey: number;
  order: number[];
  pos: number;
};

export type QueueEntry = {
  track: MusicPlayerTrack;
  qIndex: number;
  /** Stable for the entry's lifetime; the same track queued twice has two. */
  key: number;
};

export const empty: Queue = {
  tracks: [],
  keys: [],
  nextKey: 0,
  order: [],
  pos: -1,
};

const identity = (n: number) => Array.from({ length: n }, (_, i) => i);

const shuffled = (n: number, first: number) => {
  const rest = identity(n).filter((i) => i !== first);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j]!, rest[i]!];
  }
  return [first, ...rest];
};

const clampIndex = (i: number, length: number) =>
  Math.max(0, Math.min(length - 1, i));

export const current = (q: Queue): MusicPlayerTrack | null =>
  q.pos >= 0 ? (q.tracks[q.order[q.pos]!] ?? null) : null;

export const upcoming = (q: Queue): QueueEntry[] =>
  q.order.slice(q.pos + 1).map((qIndex) => ({
    track: q.tracks[qIndex]!,
    qIndex,
    key: q.keys[qIndex]!,
  }));

export const replace = (
  items: MusicPlayerTrack[],
  startIndex: number,
  shuffle: boolean
): Queue => {
  if (items.length === 0) return empty;
  const start = clampIndex(startIndex, items.length);
  const order = shuffle
    ? shuffled(items.length, start)
    : identity(items.length);
  return {
    tracks: items,
    keys: identity(items.length),
    nextKey: items.length,
    order,
    pos: shuffle ? 0 : start,
  };
};

const insert = (q: Queue, items: MusicPlayerTrack[], at: number): Queue => {
  if (items.length === 0) return q;
  const added = items.map((_, i) => q.tracks.length + i);
  const tracks = [...q.tracks, ...items];
  const keys = [...q.keys, ...items.map((_, i) => q.nextKey + i)];
  const nextKey = q.nextKey + items.length;
  if (q.pos < 0) return { tracks, keys, nextKey, order: added, pos: 0 };
  return {
    tracks,
    keys,
    nextKey,
    order: [...q.order.slice(0, at), ...added, ...q.order.slice(at)],
    pos: q.pos,
  };
};

export const append = (q: Queue, items: MusicPlayerTrack[]) =>
  insert(q, items, q.order.length);

export const insertNext = (q: Queue, items: MusicPlayerTrack[]) =>
  insert(q, items, q.pos + 1);

/** `null` when the queue has run off the end and `repeat` doesn't wrap it. */
export const forward = (q: Queue, repeat: RepeatMode): Queue | null => {
  if (q.pos < 0) return null;
  const next = q.pos + 1;
  if (next < q.order.length) return { ...q, pos: next };
  return repeat === "all" ? { ...q, pos: 0 } : null;
};

export const backward = (q: Queue): Queue =>
  q.pos <= 0 ? q : { ...q, pos: q.pos - 1 };

/** Back to the first track in play order; an empty queue stays empty. */
export const rewind = (q: Queue): Queue => (q.pos <= 0 ? q : { ...q, pos: 0 });

export const jumpTo = (q: Queue, qIndex: number): Queue => {
  const pos = q.order.indexOf(qIndex);
  return pos < 0 ? q : { ...q, pos };
};

export const removeAt = (q: Queue, qIndex: number): Queue => {
  const removedPos = q.order.indexOf(qIndex);
  if (removedPos < 0) return q;

  const tracks = q.tracks.filter((_, i) => i !== qIndex);
  const keys = q.keys.filter((_, i) => i !== qIndex);
  const order = q.order
    .filter((i) => i !== qIndex)
    .map((i) => (i > qIndex ? i - 1 : i));
  // An emptied queue keeps counting rather than reusing keys, so a row that is
  // still fading out never shares one with a row queued straight after it.
  if (order.length === 0) return { ...empty, nextKey: q.nextKey };

  const pos =
    removedPos < q.pos
      ? q.pos - 1
      : removedPos === q.pos
        ? clampIndex(q.pos, order.length)
        : q.pos;

  return { tracks, keys, nextKey: q.nextKey, order, pos };
};

export const moveItem = (q: Queue, fromQIndex: number, toQIndex: number) => {
  const from = q.order.indexOf(fromQIndex);
  const to = q.order.indexOf(toQIndex);
  if (from < 0 || to < 0 || from === to) return q;

  const playing = q.pos >= 0 ? q.order[q.pos]! : -1;
  const order = arrayMove(q.order, from, to);
  return { ...q, order, pos: playing >= 0 ? order.indexOf(playing) : q.pos };
};

export const reshuffle = (q: Queue, shuffle: boolean): Queue => {
  if (q.pos < 0) return q;
  const playing = q.order[q.pos]!;
  const order = shuffle
    ? shuffled(q.tracks.length, playing)
    : identity(q.tracks.length);
  return { ...q, order, pos: order.indexOf(playing) };
};

/** `q` with the track at the current position replaced by `track`, keeping its place and key. */
export const withCurrent = (q: Queue, track: MusicPlayerTrack): Queue => {
  if (q.pos < 0) return q;
  const index = q.order[q.pos]!;
  return {
    ...q,
    tracks: q.tracks.map((t, i) => (i === index ? track : t)),
  };
};

export const withMetadata = (
  q: Queue,
  assetId: number,
  meta: MusicPlayerMetadata
): Queue => ({
  ...q,
  tracks: q.tracks.map((t) => (t.asset.id === assetId ? { ...t, ...meta } : t)),
});
