import {
  type AudioEngine,
  type AudioEngineEvents,
  type CompareStatus,
  type LabSource,
  type LabStatus,
  silentEngine,
} from "@/components/music-player/player-engine";
import {
  DEFAULT_PLAYER_INITIAL,
  type PlayerInitial,
  type PlayerPolicy,
} from "@/components/music-player/player-initial";
import { createMetadataLoader } from "@/components/music-player/player-metadata";
import * as Q from "@/components/music-player/player-queue";
import {
  browserStorage,
  keptPosition,
  PlayerPrefs,
  type PlayerStorage,
  playerWriters,
  queueToStored,
  readStoredQueue,
  readStoredSettings,
  type StoredQueueEntry,
} from "@/components/music-player/player-storage";
import { resolveStoredQueue } from "@/components/music-player/queue-restore";
import {
  MusicPlayerTrack,
  RepeatMode,
  trackLabel,
} from "@/components/music-player/types";
import { bounceName } from "@/lib/dsp/bounce-name";
import {
  bounce as runBounceRender,
  defaultBounceDeps,
  type BounceDeps,
} from "@/lib/dsp/bounce";
import { createBrowserEngine } from "@/lib/dsp/browser-engine";
import { LabUnavailable } from "@/lib/dsp/lab-engine";
import {
  type Auditions,
  type CompSettings,
  type EqBand,
  type LabLoudness,
  type LabSettings,
  labWanted,
  type MatchEqSelection,
  elementRate,
  playbackSpeed,
  type ReverbSettings,
  type SpeedPitchMode,
} from "@/lib/dsp/lab-settings";
import type { PlayerSide } from "@/lib/dsp/processor-protocol";
import { clientGetTrackAudioDiff } from "@/lib/client-api";
import { clampToRange, labSettingsFrom } from "@/lib/policies/lab";
import type { ProjectTargetResolver } from "@/components/music-player/project-target";
import type { QueueEnd } from "@/lib/policies/playback";
import type { LoudnessHop } from "@workspace/dsp/analysis";
import type { TrackAudioDiff } from "@workspace/api/api";
import { isActionError } from "@workspace/api/lib/action-result";
import { isCoarsePointer } from "@workspace/ui/hooks/use-coarse-pointer";
import { imageUrl, mediaProxyUrl } from "@/lib/utils";

const nextRepeat: Record<RepeatMode, RepeatMode> = {
  off: "all",
  all: "one",
  one: "off",
};

const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v));

export type CompareState = {
  b: MusicPlayerTrack;
  active: "a" | "b";
  matched: boolean;
  /**
   * Whether this comparison plays on the elements directly rather than the
   * Lab — a coarse pointer's path, chosen when it starts, never Web Audio,
   * and never loudness-matched because there is no gain stage to ramp.
   * `AudioCompareControls` reads this to show the unmatched label instead of
   * the match toggle, and `LabView` reads it to hide every Lab-only
   * affordance while it runs.
   */
  unmatched: boolean;
  /**
   * `preparing` until the Lab plays both sources and the pair's alignment
   * has settled, `ready` once a swap lands on the same musical moment, and
   * `unavailable` when the Lab could not hold both. An unmatched comparison
   * has nothing to wait on and goes straight to `ready`.
   */
  phase: CompareStatus["phase"];
  /** Why the comparison is unavailable, written for the listener. */
  reason: string | null;
  /**
   * The pair's diff, per second of the A side: its change map and summary
   * for the change strip, and the offset B plays at. Null while it loads, and
   * when the server has none (a version not yet analysed).
   */
  diff: TrackAudioDiff | null;
};

/** The Lab as the player shows it: what is set, and where the engine is with it. */
export type LabState = {
  settings: LabSettings;
  phase: LabStatus["phase"];
  /** Preparing progress, 0..1. */
  fraction: number;
  /** Why the Lab is unavailable, written for the listener. */
  reason: string | null;
  source: LabSource;
  /** The listener keeps the Lab engaged with everything at its default. */
  pinned: boolean;
  /** The normalise target the playing track is heard at: its project's, else the policy's. */
  targetLufs: number;
};

/**
 * A bounce's lifecycle, from the render through the upload to the finished
 * attachment. Kept outside {@link LabState} rather than nested in it: every
 * checkpoint replaces this on its own, so a reader of the Lab's settings and
 * phase (`useLab`) never re-renders over a bounce in progress, and only
 * `useBounce` does.
 */
export type BounceState =
  | { phase: "rendering"; fraction: number }
  | { phase: "encoding" }
  | { phase: "uploading"; fraction: number }
  | { phase: "done"; assetId: number; name: string }
  | { phase: "failed"; reason: string };

/** Why the current asset's audio would not load; `message` is for logs and tests. */
type LoadError = { assetId: number; message: string };

/** Stands in for a media error the browser gave no message for. */
const LOAD_ERROR_FALLBACK = "The audio failed to load";

/** How early a crossfade timer may fire and still start the crossfade. */
const CROSSFADE_EARLY_SECONDS = 0.05;

/** Less of the track left than this, and it ends rather than crossfading. */
const MIN_OVERLAP_SECONDS = 0.05;

export type PlayerSnapshot = {
  current: MusicPlayerTrack | null;
  upcoming: Q.QueueEntry[];
  isPlaying: boolean;
  duration: number;
  /**
   * The current asset's load failure, or null: cleared when its metadata
   * arrives, when another asset loads, and by `retry`. Never set for an asset
   * that is no longer current.
   */
  loadError: LoadError | null;
  prefs: PlayerPrefs;
  /** Whether the volume pref reaches the output, or iOS owns the volume. */
  volumeControllable: boolean;
  /** The A/B comparison in progress, if any. `current` always stays the A track. */
  compare: CompareState | null;
  /**
   * The engine's analyser once a surface has asked for analysis and the graph
   * came up, for the now-playing scope. In the snapshot because the graph is
   * built on request rather than with the player, so a reader that mounts
   * before the request has to be told when the node arrives.
   */
  analyser: AnalyserNode | null;
  /**
   * Whether playback currently runs through Web Audio rather than the
   * elements' own output — the fact a coarse pointer costs a locked phone
   * its playback, and the reason `useSideFrames` and `LavaField` have
   * anything to read. True while the Lab is live, and once the elements'
   * graph is built.
   */
  routed: boolean;
  lab: LabState;
  /** A bounce's lifecycle, or null while none has run since the track loaded. */
  bounce: BounceState | null;
  /**
   * How far a preparing comparison has got, 0..1 in hundredths. A sibling of
   * `compare` rather than a field of it, so progress re-renders only its own
   * reader (`useCompareProgress`), not every reader of the comparison.
   */
  compareProgress: number;
};

/**
 * Gains that bring two sources to the quieter one's integrated loudness.
 * Attenuates the louder source rather than boosting the quieter one, since
 * boosting risks clipping.
 */
export function matchGains(
  lufsA: number | null | undefined,
  lufsB: number | null | undefined
): [number, number] {
  if (lufsA == null || lufsB == null) return [1, 1];
  const delta = lufsA - lufsB; // positive: A is louder
  const attenuate = Math.min(1, Math.pow(10, -Math.abs(delta) / 20));
  return delta > 0 ? [attenuate, 1] : [1, attenuate];
}

/** The reason a failed bounce shows the listener. */
function bounceFailureReason(error: unknown): string {
  if (error instanceof LabUnavailable) return error.reason;
  if (error instanceof Error) return error.message;
  return "The bounce failed";
}

export type PlayerActions = {
  playNow: (items: MusicPlayerTrack[], startIndex?: number) => void;
  /**
   * Play `item` from `position` seconds, however far its source has got: the
   * queue keeps its other tracks when `item` is the one playing, and is
   * replaced by `item` alone when it is not. A `position` past the end of the
   * source seeks to the start instead.
   */
  playAt: (item: MusicPlayerTrack, position: number) => void;
  enqueue: (items: MusicPlayerTrack[]) => void;
  playNext: (items: MusicPlayerTrack[]) => void;
  next: () => void;
  prev: () => void;
  seek: (position: number) => void;
  jump: (qIndex: number) => void;
  remove: (qIndex: number) => void;
  move: (fromQIndex: number, toQIndex: number) => void;
  clear: () => void;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  /**
   * Reloads the current source after a load failure and plays it from the
   * start. A no-op while `loadError` is null, so a second call before the
   * reload settles does nothing.
   */
  retry: () => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  setLabMode: (mode: SpeedPitchMode) => void;
  /** Speed, clamped to the Lab policy's speed range. */
  setSpeed: (speed: number) => void;
  /** Pitch in semitones, clamped to the Lab policy's pitch range. */
  setPitch: (semitones: number) => void;
  setEqBand: (index: number, patch: Partial<EqBand>) => void;
  /** A 31-band match-EQ curve in dB, or null for the parametric bands. */
  setEqCurve: (gains: number[] | null) => void;
  setComp: (patch: Partial<CompSettings>) => void;
  setReverb: (patch: Partial<ReverbSettings>) => void;
  setEqOn: (on: boolean) => void;
  setAudition: (patch: Partial<Auditions>) => void;
  /** Keeps the Lab engaged with every setting at its default. */
  pinLab: (on: boolean) => void;
  /** Every Lab setting back to its default. */
  resetLab: () => void;
  /**
   * Asks for the Web Audio analysis graph, for a surface the listener has
   * opened that reads the audio itself — the now-playing scope and its meters.
   * Playback runs off the audio element until this is called, which is what
   * lets a phone carry on with the screen off; routing gives that up for the
   * rest of the session, so only a surface actually on screen should ask.
   */
  requestAnalysis: () => void;
  /** Starts an A/B comparison against `current`, loudness-matched by default. */
  startCompare: (b: MusicPlayerTrack) => void;
  /** Swaps which of the two compared tracks reaches the output. */
  swapCompare: () => void;
  /**
   * Renders the current source through the Lab's chain at the listener's
   * settings, encodes it to 24-bit FLAC and attaches it to the track,
   * reporting each phase through the snapshot's `bounce`. A no-op without a
   * track loaded.
   */
  bounce: () => void;
  /** Toggles loudness matching between the two compared tracks. */
  setCompareMatched: (on: boolean) => void;
  /**
   * Ends the comparison, leaving the audible side playing where it is: B,
   * when it was heard, becomes the current track in A's place.
   */
  endCompare: () => void;
};

type LoudnessListener = (side: PlayerSide, frame: LoudnessHop) => void;

type SpectrumListener = (side: PlayerSide, db: Float32Array) => void;

type GrListener = (db: number) => void;

export type PlayerStore = {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => PlayerSnapshot;
  getServerSnapshot: () => PlayerSnapshot;
  subscribeProgress: (listener: (seconds: number) => void) => () => void;
  getProgress: () => number;
  /**
   * Live loudness frames from the engine's meters, one call per frame per
   * source (about 100 a second each). Deliberately not React state: readers
   * write the DOM from their own frame loop.
   */
  subscribeLoudness: (listener: LoudnessListener) => () => void;
  /**
   * Live spectrum frames from the engine's meters, one call per hop per
   * source (about twelve a second per source). Deliberately not React state:
   * readers write the DOM from their own frame loop.
   */
  subscribeSpectrum: (listener: SpectrumListener) => () => void;
  /**
   * The Lab compressor's live gain reduction, in dB, about every 10 ms while
   * it runs. Deliberately not React state, like the loudness and spectrum
   * frames: the rack's meter writes the DOM from its own frame loop.
   */
  subscribeGr: (listener: GrListener) => () => void;
  actions: PlayerActions;
  /**
   * The rules the store plays by from now on. Prefs and Lab settings are
   * live state and stay as they are; only the rules change.
   */
  setPolicy: (policy: PlayerPolicy) => void;
  /**
   * Brings back the queue a previous page load kept, where the playback
   * policy keeps the queue: each entry fetched afresh, the ones that no
   * longer resolve dropped, the position held on the entry that was
   * current (or the next one left). Nothing is kept until this has run, and
   * a queue the listener has started by the time the entries resolve is
   * left alone. Runs once per store; a second call does nothing.
   */
  restoreQueue: () => void;
  bindMediaSession: () => () => void;
  destroy: () => void;
};

/**
 * The snapshot a server render and hydration read: nothing loaded, and the
 * prefs and Lab settings `initial` starts from. A browser with nothing stored
 * builds exactly this as its first client snapshot, so hydration settles
 * where it started.
 */
function snapshotFrom(initial: PlayerInitial): PlayerSnapshot {
  return {
    current: null,
    upcoming: [],
    isPlaying: false,
    duration: 0,
    loadError: null,
    prefs: initial.prefs,
    volumeControllable: silentEngine.volumeControllable,
    compare: null,
    analyser: null,
    routed: silentEngine.routed,
    lab: {
      settings: initial.lab,
      phase: "off",
      fraction: 0,
      reason: null,
      source: "original",
      pinned: false,
      targetLufs: initial.policy.lab.normaliseTargetLufs,
    },
    bounce: null,
    compareProgress: 0,
  };
}

const mediaSession = () =>
  typeof navigator !== "undefined" && "mediaSession" in navigator
    ? navigator.mediaSession
    : null;

export type PlayerStoreOptions = {
  /** Builds the engine; tests pass fakes, a browser gets the hybrid engine. */
  createEngine?: (events: AudioEngineEvents) => AudioEngine;
  /** Runs a bounce; tests pass a fake, a browser gets the real render pipeline. */
  runBounce?: typeof runBounceRender;
  /** Builds the real dependencies a bounce runs against; tests pass fakes. */
  bounceDeps?: () => BounceDeps;
  /** Reads the diff between two versions, null without one; tests pass fakes. */
  fetchDiff?: (
    trackAudioId: number,
    otherId: number
  ) => Promise<TrackAudioDiff | null>;
  /**
   * What the store starts with and plays by: the shell's policies, or the
   * defaults.
   */
  initial?: PlayerInitial;
  /**
   * Answers the normalise target of the project a track belongs to, null where
   * it cannot. Without one, every track plays at the policy's target.
   */
  resolveProjectTarget?: ProjectTargetResolver;
  /**
   * Where the browser's live state is read from at construction and written
   * back to; null keeps nothing. `localStorage` in a browser by default.
   */
  persist?: PlayerStorage | null;
  /** Fetches a kept queue's entries afresh; tests pass fakes. */
  resolveQueue?: (
    entries: StoredQueueEntry[]
  ) => Promise<(MusicPlayerTrack | null)[]>;
};

async function fetchTrackAudioDiff(
  trackAudioId: number,
  otherId: number
): Promise<TrackAudioDiff | null> {
  const result = await clientGetTrackAudioDiff(trackAudioId, otherId);
  return result === null || isActionError(result) ? null : result;
}

/** Seconds B plays ahead of A by the pair's diff; 0 when the two did not align. */
function compareOffsetSeconds(diff: TrackAudioDiff | null): number {
  if (!diff?.aligned || diff.offsetMs == null) return 0;
  return diff.offsetMs / 1000;
}

export function createPlayerStore({
  createEngine = createBrowserEngine,
  runBounce = runBounceRender,
  bounceDeps = defaultBounceDeps,
  fetchDiff = fetchTrackAudioDiff,
  initial = DEFAULT_PLAYER_INITIAL,
  resolveProjectTarget,
  persist = browserStorage(),
  resolveQueue = resolveStoredQueue,
}: PlayerStoreOptions = {}): PlayerStore {
  const serverSnapshot = snapshotFrom(initial);
  let policy = initial.policy;
  /** The normalise targets the projects of played tracks have answered with. */
  const projectTargets = new Map<number, number>();
  const stored = persist
    ? readStoredSettings(persist, initial, {
        rememberAuditions: policy.lab.rememberAuditions,
      })
    : initial;
  const save = playerWriters(persist);
  let queue = Q.empty;
  let prefs = stored.prefs;
  let lab: LabState = { ...serverSnapshot.lab, settings: stored.lab };
  /** Whether the engine was last asked to engage rather than release. */
  let labEngaged = false;
  let releaseTimer: ReturnType<typeof setTimeout> | undefined;
  let isPlaying = false;
  let duration = 0;
  let loadError: LoadError | null = null;
  let progress = 0;
  let loadedSrc: string | null = null;
  let pendingSeek: number | null = null;
  let compare: CompareState | null = null;
  let compareProgress = 0;
  /** What a preparing comparison still waits on: the Lab, and the pair's diff. */
  let comparePending = { engine: false, diff: false };
  /** Bumped per comparison, so a diff read for an ended one is dropped. */
  let compareSeq = 0;
  let bounce: BounceState | null = null;
  /** Cancels a bounce in flight when a new one starts or the track changes. */
  let bounceAbort: AbortController | null = null;
  /**
   * Whether `restoreQueue` has read what a previous load kept. Until it has,
   * nothing is written, so the empty queue a store starts with never
   * overwrites the one it is about to bring back.
   */
  let keptQueueRead = false;
  let destroyed = false;
  /** Starts the crossfade out of the playing track, while one is due. */
  let crossfadeTimer: ReturnType<typeof setTimeout> | undefined;
  /**
   * The source the engine refused to crossfade out of: it plays to its end
   * and the next track loads then, as with no crossfade at all. The refusal
   * lasts for that play of the source; the next track adopted clears it.
   */
  let crossfadeRefused: string | null = null;
  /** The next source the engine was last told of, so it hears only changes. */
  let toldNext: string | null = null;

  const listeners = new Set<() => void>();
  const progressListeners = new Set<(seconds: number) => void>();
  const loudnessListeners = new Set<LoudnessListener>();
  const spectrumListeners = new Set<SpectrumListener>();
  const grListeners = new Set<GrListener>();

  // Derived values are rebuilt only when the queue is, so selector hooks can
  // compare them by identity and skip re-rendering on unrelated changes.
  let derivedFrom: Q.Queue | null = null;
  let derivedCurrent: MusicPlayerTrack | null = null;
  let derivedUpcoming: Q.QueueEntry[] = [];
  let snapshot: PlayerSnapshot = serverSnapshot;

  /** Keeps the queue as it now stands, where the playback policy keeps it. */
  function keepQueue() {
    if (keptQueueRead && policy.playback.persistQueue) {
      save.queue(queueToStored(queue));
    }
  }

  /** Source seconds heard per wall second: the Lab's speed while it plays, the element's rate otherwise. */
  const heardRate = () =>
    lab.phase === "live"
      ? playbackSpeed(lab.settings)
      : elementRate(lab.settings);

  /**
   * The queue a crossfade would move to, and the track it starts, or null
   * where none happens: crossfade off, repeat-one, a comparison running,
   * nothing after the playing track, or the same file again next (repeat-all
   * over one track).
   */
  function crossfadeTarget() {
    if (policy.playback.crossfadeSeconds <= 0) return null;
    if (compare || prefs.repeat === "one") return null;
    const advanced = Q.forward(queue, prefs.repeat);
    const track = advanced ? Q.current(advanced) : null;
    if (!advanced || !track) return null;
    const src = mediaProxyUrl(track.asset.assetPath);
    if (src === loadedSrc) return null;
    return { queue: advanced, track, source: { src, assetId: track.asset.id } };
  }

  /**
   * Where in the playing track, in its own seconds, the crossfade out of it
   * starts: the crossfade's length before its end, heard at the playing
   * rate, and never before halfway, so a track shorter than two crossfades
   * is heard before it fades.
   */
  const crossfadeStart = () =>
    Math.max(
      duration - policy.playback.crossfadeSeconds * heardRate(),
      duration / 2
    );

  /**
   * Re-derives the crossfade from the store's state: tells the engine what
   * comes next when that changes, and keeps a timer on the playing track's
   * crossfade point while it plays. With no crossfade set there is nothing
   * to tell and nothing to arm, so the engine plays exactly as it would
   * without one.
   */
  function syncCrossfade() {
    const target = crossfadeTarget();
    const nextSrc = target?.source.src ?? null;
    if (nextSrc !== toldNext) {
      toldNext = nextSrc;
      engine.prepareNext(target?.source ?? null);
    }
    clearTimeout(crossfadeTimer);
    crossfadeTimer = undefined;
    if (!target || !isPlaying || crossfadeRefused === loadedSrc) return;
    if (!(duration > 0) || !Number.isFinite(duration)) return;
    const wait = ((crossfadeStart() - engine.time) / heardRate()) * 1000;
    crossfadeTimer = setTimeout(beginCrossfade, Math.max(0, wait));
  }

  /**
   * Starts the next track under the playing one. A timer that fired early
   * (the playhead stalled behind the wall clock) is set again instead; one
   * that fired too late to overlap anything leaves the track to end. The
   * overlap is the crossfade's length, or what is left of the track when
   * that is less. An engine that cannot overlap here refuses, and the track
   * plays to its end and cuts.
   */
  function beginCrossfade() {
    crossfadeTimer = undefined;
    const target = crossfadeTarget();
    if (!target || !isPlaying || !(duration > 0)) return;
    const rate = heardRate();
    const time = engine.time;
    if (time < crossfadeStart() - CROSSFADE_EARLY_SECONDS * rate) {
      return syncCrossfade();
    }
    const remaining = (duration - time) / rate;
    if (remaining < MIN_OVERLAP_SECONDS) return;
    const seconds = Math.min(policy.playback.crossfadeSeconds, remaining);
    if (!engine.crossfade(target.source, seconds)) {
      crossfadeRefused = loadedSrc;
      return;
    }
    queue = target.queue;
    pendingSeek = null;
    adoptTrack(target.track, target.source.src);
    setMediaMetadata();
    syncPositionState();
    publish();
  }

  /**
   * The state changed: the crossfade is re-derived from it, then every
   * reader is told.
   */
  function publish() {
    if (derivedFrom !== queue) {
      derivedFrom = queue;
      derivedCurrent = Q.current(queue);
      derivedUpcoming = Q.upcoming(queue);
      keepQueue();
    }
    syncCrossfade();
    const { targetLufs } = loudnessOf(derivedCurrent);
    if (lab.targetLufs !== targetLufs) lab = { ...lab, targetLufs };
    snapshot = {
      current: derivedCurrent,
      upcoming: derivedUpcoming,
      isPlaying,
      duration,
      loadError,
      prefs,
      volumeControllable: engine.volumeControllable,
      compare,
      analyser: engine.analyser,
      routed: engine.routed,
      lab,
      bounce,
      compareProgress,
    };
    listeners.forEach((listener) => listener());
  }

  function updateBounce(next: BounceState | null) {
    bounce = next;
    publish();
  }

  function emitProgress(seconds: number) {
    progress = seconds;
    progressListeners.forEach((listener) => listener(seconds));
  }

  let frame = 0;

  function stopProgressLoop() {
    if (!frame) return;
    cancelAnimationFrame(frame);
    frame = 0;
  }

  function startProgressLoop() {
    if (frame) return;
    const tick = () => {
      emitProgress(engine.time);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
  }

  const engine: AudioEngine =
    typeof window === "undefined"
      ? silentEngine
      : createEngine({
          play: () => {
            isPlaying = true;
            setPlaybackState("playing");
            syncPositionState();
            startProgressLoop();
            publish();
          },
          pause: () => {
            isPlaying = false;
            setPlaybackState("paused");
            syncPositionState();
            stopProgressLoop();
            publish();
          },
          ended: () => advance({ auto: true }),
          error: (assetId, message) => {
            if (Q.current(queue)?.asset.id !== assetId) return;
            const next = message || LOAD_ERROR_FALLBACK;
            const known =
              loadError?.assetId === assetId && loadError.message === next;
            if (known && !isPlaying) return;
            // A source that fails after `play()` fires no `pause`: the element
            // stays unpaused with nothing to play, so the failure is the stop.
            if (isPlaying) {
              isPlaying = false;
              setPlaybackState("paused");
              syncPositionState();
              stopProgressLoop();
            }
            loadError = { assetId, message: next };
            publish();
          },
          duration: (seconds) => {
            duration = seconds;
            // Metadata for the current source is in, so it did load.
            if (seconds > 0) loadError = null;
            if (pendingSeek !== null) {
              const target = pendingSeek < seconds ? pendingSeek : 0;
              pendingSeek = null;
              engine.seek(target);
              emitProgress(target);
            }
            syncPositionState();
            publish();
          },
          loudness: (side, frame) =>
            loudnessListeners.forEach((listener) => listener(side, frame)),
          spectrum: (side, db) =>
            spectrumListeners.forEach((listener) => listener(side, db)),
          gr: (db) => grListeners.forEach((listener) => listener(db)),
          analysis: () => publish(),
          compareState: (status) => {
            if (!compare) return;
            if (status.phase === "preparing") {
              const fraction = Math.round(status.fraction * 100) / 100;
              if (fraction === compareProgress) return;
              compareProgress = fraction;
              publish();
              return;
            }
            if (status.phase === "unavailable") {
              compare = {
                ...compare,
                phase: "unavailable",
                reason: status.reason,
              };
              syncLab();
              publish();
              return;
            }
            comparePending = { ...comparePending, engine: false };
            settleCompare();
          },
          labState: (status) => {
            const fraction =
              status.phase === "preparing"
                ? Math.round(status.fraction * 100) / 100
                : status.phase === "live"
                  ? 1
                  : 0;
            const next: LabState = {
              ...lab,
              phase: status.phase,
              fraction,
              reason: status.phase === "unavailable" ? status.reason : null,
              source: "source" in status ? status.source : lab.source,
            };
            if (
              next.phase === lab.phase &&
              next.fraction === lab.fraction &&
              next.reason === lab.reason &&
              next.source === lab.source
            ) {
              return;
            }
            lab = next;
            publish();
          },
        });

  engine.applyPrefs(prefs);
  engine.lab.set(lab.settings, loudnessOf(null));
  syncLab();

  const metadata = createMetadataLoader((assetId, meta) => {
    queue = Q.withMetadata(queue, assetId, meta);
    const playing = Q.current(queue);
    if (playing?.asset.id === assetId) {
      setMediaMetadata();
      // The metadata is where a track built without its project learns it.
      resolveTargetOf(playing);
    }
    publish();
  });

  /**
   * What the lock-screen scrubber tracks. Browsers interpolate from the last
   * report, so this is called only when the timeline itself changes rather
   * than per frame. Reporting nothing is the only honest answer before a
   * duration arrives: the spec rejects a position past the end.
   */
  function syncPositionState() {
    const session = mediaSession();
    if (!session || !("setPositionState" in session)) return;
    if (!duration || !Number.isFinite(duration)) {
      session.setPositionState();
      return;
    }
    session.setPositionState({
      duration,
      playbackRate: playbackSpeed(lab.settings),
      position: Math.min(duration, engine.time),
    });
  }

  function setPlaybackState(state: MediaSessionPlaybackState) {
    const session = mediaSession();
    if (session) session.playbackState = state;
  }

  function setMediaMetadata() {
    const session = mediaSession();
    if (!session) return;
    const track = Q.current(queue);
    if (!track) {
      session.metadata = null;
      return;
    }
    session.metadata = new MediaMetadata({
      title: track.title || track.asset.name,
      artist: track.artists?.join(", ") || "",
      album: track.album || "",
      // The lock screen and the notification shade draw the cover small; the
      // 256px variant is what they need rather than the original upload.
      artwork: track.cover
        ? [{ src: imageUrl(track.cover, 256), sizes: "256x256" }]
        : [],
    });
  }

  /**
   * What the Lab's `normalise` reads while `track` plays: the target of the
   * project the track belongs to once that has been read, the policy's until
   * then and for a track with no project.
   */
  function loudnessOf(track: MusicPlayerTrack | null): LabLoudness {
    const projectTarget =
      track?.projectId == null
        ? undefined
        : projectTargets.get(track.projectId);
    return {
      lufs: track?.trackAudio?.lufs ?? null,
      targetLufs: projectTarget ?? policy.lab.normaliseTargetLufs,
    };
  }

  /**
   * Reads the normalise target of `track`'s project, and re-applies the Lab's
   * loudness when it lands for a track that is still the playing one and
   * differs from the target it plays at.
   */
  function resolveTargetOf(track: MusicPlayerTrack | null) {
    const projectId = track?.projectId;
    if (!resolveProjectTarget || projectId == null) return;
    if (projectTargets.has(projectId)) return;
    void resolveProjectTarget(projectId).then((target) => {
      if (destroyed || target === null) return;
      const applied = loudnessOf(Q.current(queue)).targetLufs;
      projectTargets.set(projectId, target);
      const playing = Q.current(queue);
      if (playing?.projectId !== projectId || target === applied) return;
      engine.lab.set(lab.settings, loudnessOf(playing));
      publish();
    });
  }

  /**
   * Whether a stored match-EQ reference no longer applies to `next`: `next`
   * is the reference version itself, or a version of another track. A
   * version switch within the reference's own track leaves it in place;
   * `MatchEq`'s own effect recomputes the gains for whichever version plays.
   */
  function matchEqStale(
    next: MusicPlayerTrack | null,
    matchEq: MatchEqSelection | null
  ): boolean {
    if (matchEq == null || next == null) return false;
    return (
      next.trackAudio?.id === matchEq.audioId ||
      next.ownerType !== matchEq.ownerType ||
      next.ownerId !== matchEq.ownerId
    );
  }

  /**
   * The single funnel from a queue change to the audio element. Reloading is
   * keyed on the resolved source, so actions that leave the playing track alone
   * (reordering, enqueuing behind it, metadata arriving) cost nothing. A
   * `position` asks for the track to start there, whichever of the three states
   * the source is in: new, loading, or loaded.
   */
  function loadCurrent({
    autoplay,
    position = null,
  }: {
    autoplay: boolean;
    position?: number | null;
  }) {
    const track = Q.current(queue);
    const src = track ? mediaProxyUrl(track.asset.assetPath) : null;

    // A seek within the loaded source leaves a comparison that is listening to
    // side A alone, as a plain seek does. Anything else ends it: a new source,
    // a queue change, or a seek while side B is the one being heard.
    const seekInPlace = src === loadedSrc && position !== null;
    if (compare && !(seekInPlace && compare.active === "a")) {
      clearCompare();
      engine.lab.compare.end("a");
      syncLab();
    }

    if (src !== loadedSrc) {
      // A new load: only this call's position applies to it, so one left over
      // from a load that never finished cannot seek the wrong track.
      pendingSeek = position;
      adoptTrack(track, src);
      if (track && src) engine.load({ src, assetId: track.asset.id });
      else engine.stop();
      setMediaMetadata();
    } else if (position !== null) {
      if (duration > 0) {
        // Loaded: no `duration` event is coming, so seek now.
        const target = position < duration ? position : 0;
        engine.seek(target);
        emitProgress(target);
      } else {
        // The same source is still loading; the `duration` callback applies it.
        pendingSeek = position;
      }
    }
    if (autoplay && src) engine.play();
    syncPositionState();
    publish();
  }

  /**
   * Resets what belongs to the loaded track for `track` at `src`: a bounce
   * in flight, a match-EQ reference that no longer applies, the duration,
   * the progress, the Lab's loudness figure and the source the engine
   * refused to crossfade out of. The caller loads the engine.
   */
  function adoptTrack(track: MusicPlayerTrack | null, src: string | null) {
    bounceAbort?.abort();
    bounceAbort = null;
    bounce = null;
    if (matchEqStale(track, lab.settings.auditions.matchEq)) {
      const settings = {
        ...lab.settings,
        auditions: { ...lab.settings.auditions, matchEq: null },
      };
      lab = { ...lab, settings };
      save.lab(settings);
      engine.lab.setEqCurve(null);
      syncLab();
    }
    loadedSrc = src;
    crossfadeRefused = null;
    duration = 0;
    loadError = null;
    emitProgress(0);
    engine.lab.set(lab.settings, loudnessOf(track));
    resolveTargetOf(track);
  }

  function clearCompare() {
    compareSeq += 1;
    compare = null;
    compareProgress = 0;
    comparePending = { engine: false, diff: false };
  }

  /** Marks a preparing comparison ready once nothing is pending. */
  function settleCompare() {
    if (!compare || compare.phase !== "preparing") return;
    if (comparePending.engine || comparePending.diff) return;
    compare = { ...compare, phase: "ready" };
    compareProgress = 1;
    publish();
  }

  /** Which engine plays a comparison: the elements alone when unmatched, else the Lab. */
  const compareEngine = (state: Pick<CompareState, "unmatched">) =>
    state.unmatched ? engine.compare : engine.lab.compare;

  /** Sends the comparison's audible side and loudness-matched gains to the engine. */
  function routeCompare() {
    if (!compare) return;
    const [a, b] = compare.matched
      ? matchGains(
          Q.current(queue)?.trackAudio?.lufs,
          compare.b.trackAudio?.lufs
        )
      : [1, 1];
    compareEngine(compare).route(compare.active, { a, b });
  }

  function prefetchMetadata() {
    const playing = Q.current(queue);
    metadata.prefetch([
      ...(playing ? [playing] : []),
      ...Q.upcoming(queue).map((entry) => entry.track),
      ...queue.tracks,
    ]);
  }

  function updatePrefs(changes: Partial<PlayerPrefs>) {
    prefs = { ...prefs, ...changes };
    engine.applyPrefs(prefs);
    save.prefs(prefs);
    publish();
  }

  /**
   * Applies the engagement rule: engage at once when the Lab is wanted;
   * otherwise release only once nothing has wanted the Lab for the Lab
   * policy's release delay, so flicking an audition off and on, or ending a
   * comparison, does not bounce between engines — and never, once engaged,
   * where the policy keeps the Lab engaged. An unmatched comparison
   * overrides the rule entirely rather than feeding into it: it plays on the
   * elements, never the Lab, so neither a pinned Lab nor a Lab-needing
   * setting may re-engage one while it runs, and any release this forces is
   * immediate rather than on the usual delay.
   */
  function syncLab() {
    if (compare?.unmatched) {
      clearTimeout(releaseTimer);
      releaseTimer = undefined;
      if (labEngaged) {
        labEngaged = false;
        engine.lab.release();
      }
      return;
    }
    const wanted = labWanted({
      settings: lab.settings,
      pinned: lab.pinned,
      comparing: compare !== null && compare.phase !== "unavailable",
    });
    if (wanted) {
      clearTimeout(releaseTimer);
      releaseTimer = undefined;
      labEngaged = true;
      engine.lab.engage();
      return;
    }
    if (!labEngaged) return;
    if (policy.lab.keepEngaged) {
      clearTimeout(releaseTimer);
      releaseTimer = undefined;
      return;
    }
    releaseTimer ??= setTimeout(() => {
      releaseTimer = undefined;
      labEngaged = false;
      engine.lab.release();
    }, policy.lab.releaseDelayMs);
  }

  function updateLab(changes: Partial<Omit<LabState, "settings">>) {
    lab = { ...lab, ...changes };
    syncLab();
    publish();
  }

  function updateLabSettings(change: (settings: LabSettings) => LabSettings) {
    const settings = change(lab.settings);
    lab = { ...lab, settings };
    engine.lab.set(settings, loudnessOf(Q.current(queue)));
    save.lab(settings);
    syncLab();
    syncPositionState();
    publish();
  }

  const updateRack = <K extends keyof LabSettings["rack"]>(
    block: K,
    patch: Partial<LabSettings["rack"][K]>
  ) =>
    updateLabSettings((settings) => ({
      ...settings,
      rack: {
        ...settings.rack,
        [block]: { ...settings.rack[block], ...patch },
      },
    }));

  /** What the last track ending does, as the playback policy says. */
  const queueEnds: Record<QueueEnd, () => void> = {
    stop: () => engine.pause(),
    rewind() {
      engine.pause();
      queue = Q.rewind(queue);
      loadCurrent({ autoplay: false, position: 0 });
    },
    clear: () => actions.clear(),
  };

  function advance({ auto }: { auto: boolean }) {
    if (auto && prefs.repeat === "one") return engine.restart();
    const advanced = Q.forward(queue, prefs.repeat);
    if (!advanced) {
      if (auto) queueEnds[policy.playback.queueEnd]();
      return;
    }
    queue = advanced;
    loadCurrent({ autoplay: true });
  }

  function addTracks(next: Q.Queue, wasEmpty: boolean) {
    queue = next;
    loadCurrent({
      autoplay: (wasEmpty && policy.playback.queueingStarts) || isPlaying,
    });
    prefetchMetadata();
  }

  const actions: PlayerActions = Object.freeze({
    playNow(items, startIndex = 0) {
      metadata.cancel();
      queue = Q.replace(items, startIndex, prefs.shuffle);
      loadCurrent({ autoplay: items.length > 0 });
      prefetchMetadata();
    },
    playAt(item, position) {
      const isCurrent = Q.current(queue)?.asset.id === item.asset.id;
      if (!isCurrent) {
        metadata.cancel();
        queue = Q.replace([item], 0, prefs.shuffle);
      }
      loadCurrent({ autoplay: true, position });
      if (!isCurrent) prefetchMetadata();
    },
    enqueue(items) {
      if (items.length === 0) return;
      addTracks(Q.append(queue, items), queue.pos < 0);
    },
    playNext(items) {
      if (items.length === 0) return;
      addTracks(Q.insertNext(queue, items), queue.pos < 0);
    },
    next: () => advance({ auto: false }),
    prev() {
      if (queue.pos < 0) return;
      if (engine.time > policy.playback.previousRestartsAfterSeconds) {
        return engine.restart();
      }
      queue = Q.backward(queue);
      loadCurrent({ autoplay: true });
    },
    seek(position) {
      engine.seek(position);
      emitProgress(position);
      syncPositionState();
      syncCrossfade();
    },
    jump(qIndex) {
      queue = Q.jumpTo(queue, qIndex);
      loadCurrent({ autoplay: true });
    },
    remove(qIndex) {
      queue = Q.removeAt(queue, qIndex);
      loadCurrent({ autoplay: isPlaying });
    },
    move(fromQIndex, toQIndex) {
      queue = Q.moveItem(queue, fromQIndex, toQIndex);
      publish();
    },
    clear() {
      metadata.cancel();
      queue = Q.empty;
      loadCurrent({ autoplay: false });
    },
    play() {
      if (queue.pos >= 0) engine.play();
    },
    pause: () => engine.pause(),
    retry() {
      if (!loadError) return;
      // Dropping the loaded source is what gets `loadCurrent` past its
      // same-source short-circuit; the reload it starts clears `loadError`.
      loadedSrc = null;
      loadCurrent({ autoplay: true });
    },
    togglePlay() {
      if (queue.pos < 0) return;
      if (isPlaying) engine.pause();
      else engine.play();
    },
    toggleShuffle() {
      const shuffle = !prefs.shuffle;
      queue = Q.reshuffle(queue, shuffle);
      updatePrefs({ shuffle });
    },
    cycleRepeat: () => updatePrefs({ repeat: nextRepeat[prefs.repeat] }),
    setVolume: (volume) =>
      updatePrefs({ volume: clamp(volume, 0, 1), muted: false }),
    toggleMute: () => updatePrefs({ muted: !prefs.muted }),
    setLabMode: (mode) =>
      updateLabSettings((settings) => ({ ...settings, mode })),
    setSpeed: (speed) =>
      updateLabSettings((settings) => ({
        ...settings,
        speed: clampToRange(speed, policy.lab.speedRange),
      })),
    setPitch: (semitones) =>
      updateLabSettings((settings) => ({
        ...settings,
        pitch: clampToRange(semitones, policy.lab.pitchRange),
      })),
    setEqBand: (index, patch) =>
      updateLabSettings((settings) => ({
        ...settings,
        rack: {
          ...settings.rack,
          eq: {
            ...settings.rack.eq,
            bands: settings.rack.eq.bands.map((band, i) =>
              i === index ? { ...band, ...patch } : band
            ),
          },
        },
      })),
    setEqCurve: (gains) => engine.lab.setEqCurve(gains),
    setEqOn: (on) => updateRack("eq", { on }),
    setComp: (patch) => updateRack("comp", patch),
    setReverb: (patch) => updateRack("reverb", patch),
    setAudition: (patch) =>
      updateLabSettings((settings) => ({
        ...settings,
        auditions: { ...settings.auditions, ...patch },
      })),
    pinLab: (pinned) => updateLab({ pinned }),
    resetLab: () => updateLabSettings(() => labSettingsFrom(policy.lab)),
    requestAnalysis: () =>
      engine.requestAnalysis(policy.playback.analysisOnTouch),
    startCompare(b) {
      const current = Q.current(queue);
      if (!current) return;
      if (compare) compareEngine(compare).end("a");
      const unmatched = isCoarsePointer();
      const started: CompareState = {
        b,
        active: "a",
        matched: !unmatched,
        unmatched,
        phase: "preparing",
        reason: null,
        diff: null,
      };
      compare = started;
      compareProgress = 0;
      const seq = ++compareSeq;
      const aId = current.trackAudio?.id;
      const bId = b.trackAudio?.id;
      // No structural alignment on a coarse pointer: there is no decode to
      // align against, so an unmatched comparison skips the diff fetch and
      // starts both sources from the same transport position.
      const aligns = !unmatched && aId != null && bId != null;
      // The Lab reports its own download progress through `compareState`; the
      // plain elements have nothing equivalent to wait on, so an unmatched
      // comparison is ready as soon as it is asked for.
      comparePending = { engine: !unmatched, diff: aligns };
      // `compare` is already `started`, so an unmatched comparison releases
      // the Lab here at once — a pinned Lab or a Lab-needing setting would
      // otherwise keep playing A out loud while B starts beside it on the
      // elements.
      syncLab();
      compareEngine(started).start({
        src: mediaProxyUrl(b.asset.assetPath),
        assetId: b.asset.id,
      });
      routeCompare();
      if (aligns) {
        // One read per comparison: B's offset and the change strip both come
        // from it. A failed read aligns nothing and draws no strip.
        void fetchDiff(aId, bId)
          .catch(() => null)
          .then((diff) => {
            if (seq !== compareSeq || compare?.phase !== "preparing") return;
            engine.lab.compare.align(compareOffsetSeconds(diff));
            compare = { ...compare, diff };
            comparePending = { ...comparePending, diff: false };
            publish();
            settleCompare();
          });
      }
      if (unmatched) settleCompare();
      publish();
    },
    swapCompare() {
      if (compare?.phase !== "ready") return;
      compare = { ...compare, active: compare.active === "a" ? "b" : "a" };
      routeCompare();
      publish();
    },
    setCompareMatched(on) {
      if (!compare) return;
      compare = { ...compare, matched: on };
      routeCompare();
      publish();
    },
    endCompare() {
      if (!compare) return;
      const { b, active, phase, unmatched } = compare;
      const keep = phase === "ready" ? active : "a";
      const endOn = unmatched ? engine.compare : engine.lab.compare;
      clearCompare();
      if (keep === "b") {
        queue = Q.withCurrent(queue, b);
        adoptTrack(b, mediaProxyUrl(b.asset.assetPath));
        setMediaMetadata();
      }
      endOn.end(keep);
      if (keep === "b") emitProgress(engine.time);
      syncLab();
      syncPositionState();
      publish();
    },
    bounce() {
      const current = Q.current(queue);
      if (!current) return;
      if (current.ownerType !== "track" || current.projectId == null) {
        updateBounce({ phase: "failed", reason: "Nothing to bounce yet" });
        return;
      }
      bounceAbort?.abort();
      const controller = new AbortController();
      bounceAbort = controller;
      const name = bounceName(
        trackLabel(current),
        current.trackAudio?.version,
        lab.settings,
        { ...policy.lab, normaliseTargetLufs: loudnessOf(current).targetLufs }
      );
      updateBounce({ phase: "rendering", fraction: 0 });
      void runBounce(
        {
          source: {
            src: mediaProxyUrl(current.asset.assetPath),
            assetId: current.asset.id,
          },
          settings: lab.settings,
          loudness: loudnessOf(current),
          curve: engine.lab.curve,
          projectId: current.projectId,
          trackId: current.ownerId,
          name,
        },
        bounceDeps(),
        (status) => {
          if (!controller.signal.aborted) updateBounce(status);
        },
        controller.signal
      ).then(
        (result) => {
          if (controller.signal.aborted) return;
          if (isActionError(result)) {
            updateBounce({ phase: "failed", reason: result.error });
            return;
          }
          updateBounce({
            phase: "done",
            assetId: result.id,
            name: result.name,
          });
        },
        (error: unknown) => {
          if (controller.signal.aborted) return;
          updateBounce({ phase: "failed", reason: bounceFailureReason(error) });
        }
      );
    },
  });

  publish();

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    getServerSnapshot: () => serverSnapshot,
    subscribeProgress(listener) {
      progressListeners.add(listener);
      return () => progressListeners.delete(listener);
    },
    getProgress: () => progress,
    subscribeLoudness(listener) {
      loudnessListeners.add(listener);
      return () => loudnessListeners.delete(listener);
    },
    subscribeSpectrum(listener) {
      spectrumListeners.add(listener);
      return () => spectrumListeners.delete(listener);
    },
    subscribeGr(listener) {
      grListeners.add(listener);
      return () => grListeners.delete(listener);
    },
    actions,

    setPolicy(next) {
      const retarget =
        next.lab.normaliseTargetLufs !== policy.lab.normaliseTargetLufs;
      const keeping = next.playback.persistQueue;
      const keepingChanged = keeping !== policy.playback.persistQueue;
      policy = next;
      if (retarget) engine.lab.set(lab.settings, loudnessOf(Q.current(queue)));
      // Turned on, the queue as it stands is kept at once; turned off, the
      // kept one is forgotten rather than waiting to come back later.
      if (keepingChanged && keptQueueRead) {
        if (keeping) keepQueue();
        else save.queue(null);
      }
      syncLab();
      syncCrossfade();
      if (retarget) publish();
    },

    restoreQueue() {
      if (keptQueueRead) return;
      keptQueueRead = true;
      if (!persist || !policy.playback.persistQueue) return;
      const kept = readStoredQueue(persist);
      if (!kept) return;
      void resolveQueue(kept.entries).then(
        (resolved) => {
          if (destroyed || queue.pos >= 0) return;
          const tracks = resolved.filter((track) => track !== null);
          if (tracks.length === 0) {
            keepQueue();
            return;
          }
          queue = Q.replace(tracks, keptPosition(resolved, kept.pos), false);
          loadCurrent({ autoplay: false });
          prefetchMetadata();
        },
        () => {}
      );
    },

    /**
     * Action handlers are document-global, so the last registration wins and
     * only a mounted store may hold them. Binding from an effect — rather than
     * at construction — keeps a store React discards from claiming the OS keys.
     */
    bindMediaSession() {
      const session = mediaSession();
      if (!session) return () => {};

      const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
        ["play", actions.play],
        ["pause", actions.pause],
        ["previoustrack", actions.prev],
        ["nexttrack", actions.next],
        [
          "seekto",
          (details) => {
            if (details.seekTime != null) actions.seek(details.seekTime);
          },
        ],
      ];

      handlers.forEach(([action, handler]) =>
        session.setActionHandler(action, handler)
      );
      setMediaMetadata();

      return () => {
        handlers.forEach(([action]) => session.setActionHandler(action, null));
        session.metadata = null;
        session.playbackState = "none";
      };
    },

    destroy() {
      destroyed = true;
      clearTimeout(releaseTimer);
      clearTimeout(crossfadeTimer);
      stopProgressLoop();
      metadata.cancel();
      bounceAbort?.abort();
      engine.destroy();
      listeners.clear();
      progressListeners.clear();
      loudnessListeners.clear();
      spectrumListeners.clear();
      grListeners.clear();
    },
  };
}
