import type {
  AudioEngine,
  AudioEngineEvents,
  CompareControls,
  ElementEngine,
  PlaybackSource,
} from "@/components/music-player/player-engine";
import type { PlayerPrefs } from "@/components/music-player/player-storage";
import {
  LabUnavailable,
  type Handover,
  type LabEngine,
} from "@/lib/dsp/lab-engine";
import {
  DEFAULT_LAB,
  elementRate,
  type LabLoudness,
  type LabSettings,
} from "@/lib/dsp/lab-settings";
import type { PlayerSlot } from "@/lib/dsp/processor-protocol";

/** Seconds the cross-fade between the element and the Lab takes. */
const HANDOVER_RAMP_SECONDS = 0.012;

export type HybridEngineDeps = {
  /** The audio-element engine; created at once. */
  createPlain: (events: AudioEngineEvents) => ElementEngine;
  /** The Lab; created on first engagement, rejecting with `LabUnavailable`. */
  createLab: (events: AudioEngineEvents) => Promise<LabEngine>;
  /** Releases what the two engines share, once both are destroyed. */
  destroy?: () => void;
};

type Live = "plain" | "lab";

/** A comparison's second source, from `start` until `end` or a new track. */
type Comparison = {
  source: PlaybackSource;
  offset: number;
  active: PlayerSlot;
  gains: Record<PlayerSlot, number>;
  /** Download progress of the compared source, 0..1. */
  fraction: number;
  /** Whether the Lab holds the compared source. */
  loaded: boolean;
  ready: boolean;
  controller: AbortController;
};

const reasonFor = (error: unknown) =>
  error instanceof LabUnavailable ? error.reason : "The Lab could not start";

/**
 * One `AudioEngine` over two: plain listening on the audio element, and the
 * Lab's decoded-buffer player behind the same interface. Exactly one is live;
 * each engine reports through its own event object and only the live one's
 * events reach the store, which is what keeps `isPlaying` honest across a
 * hand-over (the element's pause as it fades out, the Lab's as it releases).
 *
 * Engaging captures nothing up front: the Lab downloads and decodes while the
 * element keeps playing, then starts from the element's position and play
 * state as they are at that moment, and the two cross-fade. Releasing
 * reverses it. A new track while the Lab is live (or preparing) falls back to
 * the element at once and re-engages if the Lab is still wanted.
 *
 * A comparison prepares its second source on the Lab beside the first, while
 * the store holds the Lab engaged for it, and is ready once both play there.
 * Its progress is the mean of the two downloads while the Lab itself is
 * still preparing. Ending it on the compared source hands the Lab's second
 * source to the first slot and loads the same file on the element, so a
 * later release carries on from it.
 *
 * A crossfade runs on whichever engine is live. On the element it is the
 * element engine's own two-element overlap, and a Lab still preparing the
 * outgoing track starts again on the incoming one. On the live Lab, the
 * incoming track has to be decoded before it can overlap anything, so while
 * the Lab plays, with no comparison running, it prepares whatever the store
 * says comes next; the crossfade then starts it inside the processor, each
 * track through its own chain, and loads the same file on the element so a
 * later release carries on from it. A Lab crossfade whose next track is not
 * ready yet is refused, and the store lets the track end instead.
 */
export function createHybridEngine(
  events: AudioEngineEvents,
  deps: HybridEngineDeps
): AudioEngine {
  let live: Live = "plain";
  /** Whether the store has asked for the Lab and not released it. */
  let wanted = false;
  /** The engagement in flight, cancelled by a release, a load or a stop. */
  let engaging: AbortController | null = null;
  let source: PlaybackSource | null = null;
  /** The source the Lab failed on and why, so nothing retries it. */
  let unavailable: { src: string; reason: string } | null = null;
  let lab: LabEngine | null = null;
  let creatingLab: Promise<LabEngine> | null = null;
  /** How far the Lab's own preparation has got, for a comparison's progress. */
  let labFraction = 0;
  let comparison: Comparison | null = null;
  /** What the store says a crossfade moves to next. */
  let upcoming: PlaybackSource | null = null;
  /**
   * The next track the Lab holds or is decoding for a crossfade, until one
   * takes it or it is dropped. One that failed stays, unready, so it is not
   * tried again.
   */
  let prepared: {
    source: PlaybackSource;
    controller: AbortController;
    ready: boolean;
  } | null = null;

  let prefs: PlayerPrefs | null = null;
  let settings: LabSettings = DEFAULT_LAB;
  let loudness: LabLoudness | null = null;
  let curve: number[] | null = null;

  /** Forwards an engine's events only while that engine is live. */
  const eventsFor = (engine: Live): AudioEngineEvents => {
    const whileLive =
      <A extends unknown[]>(forward: (...args: A) => void) =>
      (...args: A) => {
        if (live === engine) forward(...args);
      };
    return {
      play: whileLive(() => events.play()),
      pause: whileLive(() => events.pause()),
      ended: whileLive(() => events.ended()),
      duration: whileLive((seconds: number) => events.duration(seconds)),
      error: whileLive((assetId: number, message: string) =>
        events.error(assetId, message)
      ),
      loudness: whileLive((side, frame) => events.loudness?.(side, frame)),
      spectrum: whileLive((side, db) => events.spectrum?.(side, db)),
      gr: whileLive((db) => events.gr?.(db)),
      analysis: () => events.analysis?.(),
    };
  };

  const plain = deps.createPlain(eventsFor("plain"));

  function labEngine(): Promise<LabEngine> {
    if (lab) return Promise.resolve(lab);
    creatingLab ??= deps.createLab(eventsFor("lab")).then(
      (created) => {
        lab = created;
        if (prefs) lab.applyPrefs(prefs);
        if (loudness) lab.set(settings, loudness);
        if (curve) lab.setEqCurve(curve);
        return created;
      },
      (error: unknown) => {
        creatingLab = null;
        throw error;
      }
    );
    return creatingLab;
  }

  async function engage() {
    wanted = true;
    if (live === "lab" || engaging || !source) return;
    if (unavailable?.src === source.src) return;
    const target = source;
    const controller = new AbortController();
    engaging = controller;
    const current = () => engaging === controller;
    labFraction = 0;
    events.labState?.({ phase: "preparing", fraction: 0, source: "original" });
    try {
      const engine = await labEngine();
      if (!current()) return;
      await engine.load(
        target,
        (fraction, from) => {
          if (current()) {
            labFraction = fraction;
            events.labState?.({ phase: "preparing", fraction, source: from });
            reportComparison();
          }
        },
        controller.signal
      );
      if (!current()) return;
      engaging = null;
      // The element's position as it is now, not as it was when the
      // download began: a six-second download moves the playhead six seconds.
      const now: Handover = { position: plain.time, playing: plain.playing };
      live = "lab";
      engine.start(now, HANDOVER_RAMP_SECONDS);
      plain.fadeOut(HANDOVER_RAMP_SECONDS);
      events.labState?.({ phase: "live", source: engine.source });
      events.analysis?.();
      reportComparison();
      syncPrepared();
    } catch (error) {
      if (!current()) return;
      engaging = null;
      unavailable = { src: target.src, reason: reasonFor(error) };
      events.labState?.({ phase: "unavailable", reason: unavailable.reason });
      failComparison(unavailable.reason);
    }
  }

  /** Reports a comparison's preparation, and readiness once both sources play on the live Lab. */
  function reportComparison() {
    if (!comparison || comparison.ready) return;
    if (comparison.loaded && live === "lab") {
      comparison.ready = true;
      events.compareState?.({ phase: "ready" });
      return;
    }
    const fraction =
      live === "lab"
        ? comparison.fraction
        : (labFraction + comparison.fraction) / 2;
    events.compareState?.({ phase: "preparing", fraction });
  }

  function failComparison(reason: string) {
    if (!comparison) return;
    comparison.controller.abort();
    events.compareState?.({ phase: "unavailable", reason });
  }

  async function prepareComparison(prepared: Comparison) {
    const current = () => comparison === prepared;
    try {
      const engine = await labEngine();
      if (!current()) return;
      await engine.loadCompare(
        prepared.source,
        (fraction) => {
          if (!current()) return;
          prepared.fraction = fraction;
          reportComparison();
        },
        prepared.controller.signal
      );
      if (!current()) return;
      engine.alignCompare(prepared.offset);
      engine.routeCompare(prepared.active, prepared.gains);
      prepared.loaded = true;
      reportComparison();
    } catch (error) {
      if (current()) failComparison(reasonFor(error));
    }
  }

  /** Drops a comparison in any state, leaving the playing source alone. */
  function dropComparison() {
    if (!comparison) return;
    comparison.controller.abort();
    if (comparison.loaded) lab?.unloadCompare();
    comparison = null;
  }

  /** Drops the next track the Lab holds or is decoding, in any state. */
  function dropPrepared() {
    if (!prepared) return;
    prepared.controller.abort();
    lab?.unloadNext();
    prepared = null;
  }

  /**
   * Brings the Lab's next track in line with what comes next: decoding it
   * while the Lab plays with no comparison running, and holding nothing
   * otherwise — the element needs nothing prepared, and a comparison has the
   * processor's second source.
   */
  function syncPrepared() {
    const next = live === "lab" && lab && !comparison ? upcoming : null;
    if (prepared && prepared.source.src === next?.src) return;
    dropPrepared();
    if (!next || !lab) return;
    const entry = {
      source: next,
      controller: new AbortController(),
      ready: false,
    };
    prepared = entry;
    lab
      .loadNext(next, () => {}, entry.controller.signal)
      .then(
        () => {
          if (prepared === entry) entry.ready = true;
        },
        // A track the Lab cannot hold stays unready, and its crossfade cuts.
        () => {}
      );
  }

  const compare: CompareControls = {
    start(next) {
      dropComparison();
      comparison = {
        source: next,
        offset: 0,
        active: "a",
        gains: { a: 1, b: 1 },
        fraction: 0,
        loaded: false,
        ready: false,
        controller: new AbortController(),
      };
      syncPrepared();
      // The Lab failed on the playing source, so B would never play beside it.
      if (source && unavailable?.src === source.src) {
        failComparison(unavailable.reason);
        return;
      }
      reportComparison();
      void prepareComparison(comparison);
    },
    align(seconds) {
      if (!comparison) return;
      comparison.offset = seconds;
      if (comparison.loaded) lab?.alignCompare(seconds);
    },
    route(active, gains) {
      if (!comparison) return;
      comparison.active = active;
      comparison.gains = gains;
      if (comparison.loaded) lab?.routeCompare(active, gains);
    },
    end(keep) {
      const ended = comparison;
      if (!ended) return;
      if (keep === "b" && ended.ready && live === "lab" && lab) {
        comparison = null;
        lab.promoteCompare();
        source = ended.source;
        unavailable = null;
        plain.load(ended.source);
      } else {
        dropComparison();
      }
      syncPrepared();
    },
  };

  /** Cancels a preparing Lab; true when there was one. */
  function cancelEngaging(): boolean {
    if (!engaging) return false;
    engaging.abort();
    engaging = null;
    return true;
  }

  /** Makes the element live again, carrying `at` over when given. */
  function handBack(at: Handover | null, seconds: number) {
    if (live !== "lab" || !lab) return;
    live = "plain";
    syncPrepared();
    if (at) {
      plain.seek(at.position);
      if (at.playing) plain.play();
    }
    plain.fadeIn(seconds);
    lab.stop(seconds);
    events.analysis?.();
  }

  function release() {
    wanted = false;
    unavailable = null;
    dropComparison();
    cancelEngaging();
    if (live === "lab" && lab) {
      handBack(
        { position: lab.time, playing: lab.playing },
        HANDOVER_RAMP_SECONDS
      );
    }
    events.labState?.({ phase: "off" });
  }

  /** Drops the Lab for whatever the element does next, keeping `wanted`. */
  function fallBack() {
    dropComparison();
    const wasLab = cancelEngaging() || live === "lab";
    handBack(null, 0);
    return wasLab;
  }

  const onLive = <T>(onPlain: () => T, onLab: (engine: LabEngine) => T) =>
    live === "lab" && lab ? onLab(lab) : onPlain();

  return {
    load(next) {
      const wasLab = fallBack();
      source = next;
      unavailable = null;
      plain.load(next);
      if (wanted) void engage();
      else if (wasLab) events.labState?.({ phase: "off" });
    },
    play: () => onLive(plain.play, (engine) => engine.play()),
    pause: () => onLive(plain.pause, (engine) => engine.pause()),
    stop() {
      if (fallBack()) events.labState?.({ phase: "off" });
      source = null;
      plain.stop();
    },
    seek: (seconds) =>
      onLive(
        () => plain.seek(seconds),
        (engine) => engine.seek(seconds)
      ),
    restart: () =>
      onLive(plain.restart, (engine) => {
        engine.seek(0);
        engine.play();
      }),
    applyPrefs(next) {
      prefs = next;
      plain.applyPrefs(next);
      lab?.applyPrefs(next);
    },
    get time() {
      return onLive(
        () => plain.time,
        (engine) => engine.time
      );
    },
    get volumeControllable() {
      return plain.volumeControllable;
    },
    requestAnalysis: (onTouch) => plain.requestAnalysis(onTouch),
    get analyser() {
      return onLive(
        () => plain.analyser,
        (engine) => engine.analyser
      );
    },
    get routed() {
      return live === "lab" || plain.routed;
    },
    compare: plain.compare,
    lab: {
      engage: () => void engage(),
      release,
      set(next, nextLoudness) {
        settings = next;
        loudness = nextLoudness;
        plain.setRate(elementRate(next));
        lab?.set(next, nextLoudness);
      },
      setEqCurve(gains) {
        curve = gains;
        lab?.setEqCurve(gains);
      },
      get curve() {
        return curve;
      },
      compare,
    },
    crossfade(next, seconds) {
      if (live === "lab" && lab) {
        const ready =
          !comparison && prepared?.ready && prepared.source.src === next.src;
        if (!ready || !lab.crossfade(seconds)) return false;
        prepared = null;
        source = next;
        unavailable = null;
        plain.load(next);
        return true;
      }
      if (!plain.crossfade(next, seconds)) return false;
      cancelEngaging();
      source = next;
      unavailable = null;
      if (wanted) void engage();
      return true;
    },
    prepareNext(next) {
      upcoming = next;
      syncPrepared();
    },
    destroy() {
      dropComparison();
      dropPrepared();
      cancelEngaging();
      lab?.destroy();
      plain.destroy();
      deps.destroy?.();
    },
  };
}
