import { isEntityKind } from "@/entities";
import * as Q from "@/components/music-player/player-queue";
import {
  RepeatMode,
  type MusicPlayerOwnerType,
  type MusicPlayerTrack,
} from "@/components/music-player/types";
import {
  clampSpeed,
  type LabSettings,
  withoutDangerousAuditions,
} from "@/lib/dsp/lab-settings";

const PREFS_KEY = "music_player_prefs";
const LAB_KEY = "music_player_lab";
const QUEUE_KEY = "music_player_queue";

export type PlayerPrefs = {
  volume: number;
  muted: boolean;
  repeat: RepeatMode;
  shuffle: boolean;
};

/** Where a browser keeps the player's live state: `localStorage`, or a test's stand-in. */
export type PlayerStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type SettingsStorage = Pick<PlayerStorage, "getItem" | "setItem">;

/** The storage a store keeps its live state in: none during a server render. */
export const browserStorage = (): PlayerStorage | null =>
  typeof window === "undefined" ? null : localStorage;

const readJson = (storage: SettingsStorage, key: string): unknown => {
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A stored match-EQ reference, or null for anything that does not name its track. */
function matchEqFrom(value: unknown): LabSettings["auditions"]["matchEq"] {
  if (!isRecord(value)) return null;
  const { audioId, ownerType, ownerId } = value;
  return typeof audioId === "number" &&
    typeof ownerId === "number" &&
    typeof ownerType === "string" &&
    isEntityKind(ownerType)
    ? { audioId, ownerType, ownerId }
    : null;
}

/** A stored Lab blob over `base`, one level of nesting at a time. */
function labFrom(
  stored: Record<string, unknown>,
  base: LabSettings
): LabSettings {
  const rack = isRecord(stored.rack) ? stored.rack : {};
  const auditions = isRecord(stored.auditions) ? stored.auditions : {};
  const part = <T extends object>(value: unknown, fallback: T): T =>
    isRecord(value) ? { ...fallback, ...value } : fallback;
  return {
    ...base,
    ...stored,
    rack: {
      eq: part(rack.eq, base.rack.eq),
      comp: part(rack.comp, base.rack.comp),
      reverb: part(rack.reverb, base.rack.reverb),
    },
    auditions: {
      ...base.auditions,
      ...auditions,
      matchEq: matchEqFrom(auditions.matchEq),
    },
  } as LabSettings;
}

/** The prefs and Lab settings a player starts from. */
export type PlayerSettings = { prefs: PlayerPrefs; lab: LabSettings };

/**
 * The player's stored prefs and Lab settings over `initial`: every field the
 * browser stored wins, and every field it never stored comes from `initial`.
 * The dangerous auditions never survive a reload, and with
 * `rememberAuditions` off none of the auditions do. A prefs blob that still
 * carries the single `rate` the player once had is read once as linked-mode
 * speed (tape-style, which is what `rate` played) and both blobs are written
 * back without it.
 */
export function readStoredSettings(
  storage: SettingsStorage,
  initial: PlayerSettings,
  { rememberAuditions }: { rememberAuditions: boolean }
): PlayerSettings {
  const storedPrefs = readJson(storage, PREFS_KEY);
  const storedLab = readJson(storage, LAB_KEY);
  const { rate, ...prefsFields } = isRecord(storedPrefs) ? storedPrefs : {};
  const prefs = { ...initial.prefs, ...prefsFields } as PlayerPrefs;
  let lab = isRecord(storedLab) ? labFrom(storedLab, initial.lab) : initial.lab;

  if (typeof rate === "number") {
    if (!isRecord(storedLab)) {
      lab = { ...lab, mode: "linked", speed: clampSpeed(rate) };
    }
    write(storage, PREFS_KEY, prefs);
    write(storage, LAB_KEY, withoutDangerousAuditions(lab));
  }
  return {
    prefs,
    lab: rememberAuditions
      ? withoutDangerousAuditions(lab)
      : { ...lab, auditions: initial.lab.auditions },
  };
}

/**
 * A queued entry as a browser keeps it: only what fetches it afresh. A
 * version of a track is read again from the track's versions; any other
 * audio is read again as the file it is.
 */
export type StoredQueueEntry =
  | { kind: "version"; trackId: number; trackAudioId: number }
  | {
      kind: "asset";
      ownerType: MusicPlayerOwnerType;
      ownerId: number;
      assetId: number;
    };

/** The queue in play order, and the position of the entry that was current. */
export type StoredQueue = { entries: StoredQueueEntry[]; pos: number };

/** How `track` is kept, to be fetched afresh on the next load. */
function storedEntry(track: MusicPlayerTrack): StoredQueueEntry {
  return track.trackAudio
    ? {
        kind: "version",
        trackId: track.ownerId,
        trackAudioId: track.trackAudio.id,
      }
    : {
        kind: "asset",
        ownerType: track.ownerType,
        ownerId: track.ownerId,
        assetId: track.asset.id,
      };
}

/** `queue` as it is kept, in play order; null for an empty queue. */
export function queueToStored(queue: Q.Queue): StoredQueue | null {
  if (queue.pos < 0) return null;
  return {
    entries: queue.order.map((index) => storedEntry(queue.tracks[index]!)),
    pos: queue.pos,
  };
}

const isId = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value);

/** A stored entry, or null for anything that does not name what it plays. */
function entryFrom(value: unknown): StoredQueueEntry | null {
  if (!isRecord(value)) return null;
  const { kind, trackId, trackAudioId, ownerType, ownerId, assetId } = value;
  if (kind === "version" && isId(trackId) && isId(trackAudioId)) {
    return { kind, trackId, trackAudioId };
  }
  if (
    kind === "asset" &&
    typeof ownerType === "string" &&
    isEntityKind(ownerType) &&
    isId(ownerId) &&
    isId(assetId)
  ) {
    return { kind, ownerType, ownerId, assetId };
  }
  return null;
}

/**
 * The kept queue, or null when there is none. An entry that does not read
 * as one is dropped, and the position is held inside what is left.
 */
export function readStoredQueue(storage: SettingsStorage): StoredQueue | null {
  const stored = readJson(storage, QUEUE_KEY);
  if (!isRecord(stored) || !Array.isArray(stored.entries)) return null;
  const read = stored.entries.map(entryFrom);
  const entries = read.filter((entry) => entry !== null);
  if (entries.length === 0) return null;
  const pos = isId(stored.pos) ? stored.pos : 0;
  return { entries, pos: keptPosition(read, pos) };
}

/**
 * Where position `pos` of `entries` lands once the null ones are dropped:
 * on the same entry when it is kept, else on the next kept one, else on the
 * last.
 */
export function keptPosition(entries: readonly unknown[], pos: number): number {
  const kept = entries.filter((entry) => entry !== null).length;
  const before = entries
    .slice(0, Math.max(0, pos))
    .filter((entry) => entry !== null).length;
  return Math.max(0, Math.min(before, kept - 1));
}

function write(storage: SettingsStorage, key: string, value: unknown) {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

function remove(storage: PlayerStorage, key: string) {
  try {
    storage.removeItem(key);
  } catch {
    /* storage unavailable */
  }
}

const WRITE_DELAY_MS = 300;

/** Dragging a slider changes settings on every pointer move, so writes wait for a pause. */
function debounced<T>(apply: (value: T) => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (value: T) => {
    clearTimeout(timer);
    timer = setTimeout(() => apply(value), WRITE_DELAY_MS);
  };
}

/** What a player store writes its live state through. */
export type PlayerWriters = {
  prefs: (prefs: PlayerPrefs) => void;
  lab: (settings: LabSettings) => void;
  /** Keeps the queue, or with null forgets a kept one. */
  queue: (queue: StoredQueue | null) => void;
};

/** Writers into `storage`, each waiting for a pause; with no storage, nothing is kept. */
export function playerWriters(storage: PlayerStorage | null): PlayerWriters {
  if (!storage) return { prefs: () => {}, lab: () => {}, queue: () => {} };
  return {
    prefs: debounced((prefs) => write(storage, PREFS_KEY, prefs)),
    lab: debounced((settings: LabSettings) =>
      write(storage, LAB_KEY, withoutDangerousAuditions(settings))
    ),
    queue: debounced((queue: StoredQueue | null) =>
      queue ? write(storage, QUEUE_KEY, queue) : remove(storage, QUEUE_KEY)
    ),
  };
}
