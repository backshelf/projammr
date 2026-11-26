import { PlayerPrefs } from "@/components/music-player/player-storage";
import { rampParam, type AudioOutputs } from "@/lib/dsp/audio-output";
import type { LabLoudness, LabSettings } from "@/lib/dsp/lab-settings";
import {
  DSP_PROCESSOR,
  type MeterMessage,
  type MeterRoleOptions,
  type PlayerSide,
  type PlayerSlot,
} from "@/lib/dsp/processor-protocol";
import { loadProcessor } from "@/lib/dsp/processor-module";
import type { LoudnessHop } from "@workspace/dsp/analysis";
import { isCoarsePointer } from "@workspace/ui/hooks/use-coarse-pointer";

/** Where the Lab's source came from: the upload itself, or a 320 kbps copy of it. */
export type LabSource = "original" | "copy";

/** The Lab's lifecycle as the engine reports it. */
export type LabStatus =
  | { phase: "off" }
  | { phase: "preparing"; fraction: number; source: LabSource }
  | { phase: "live"; source: LabSource }
  | { phase: "unavailable"; reason: string };

/** An A/B comparison's second source as the engine prepares it. */
export type CompareStatus =
  | { phase: "preparing"; fraction: number }
  | { phase: "ready" }
  | { phase: "unavailable"; reason: string };

export type AudioEngineEvents = {
  play: () => void;
  pause: () => void;
  ended: () => void;
  duration: (seconds: number) => void;
  /**
   * The source loaded for `assetId` failed. `message` is the media error's own
   * text, empty when the browser gives none.
   */
  error: (assetId: number, message: string) => void;
  /** A live loudness frame for one side, about every 10 ms while audio flows. */
  loudness?: (side: PlayerSide, frame: LoudnessHop) => void;
  /** A live spectrum frame for one side, once per hop while audio flows. */
  spectrum?: (side: PlayerSide, db: Float32Array) => void;
  /** The Lab's compressor gain reduction in dB, about every 10 ms while it runs. */
  gr?: (db: number) => void;
  /** `routed` or `analyser` changed: the graph came up, or the Lab engaged or released. */
  analysis?: () => void;
  /** The Lab moved through its lifecycle. */
  labState?: (status: LabStatus) => void;
  /** A comparison's second source moved through its preparation. */
  compareState?: (status: CompareStatus) => void;
};

/** What the player loads: the media URL and the asset behind it. */
export type PlaybackSource = { src: string; assetId: number };

/**
 * The A/B comparison, run on the Lab: the playing source is `"a"`, the
 * compared one `"b"`, both decoded into the processor and played in
 * lockstep through their own chains.
 */
export type CompareControls = {
  /**
   * Prepares `source` beside the playing one, reporting through
   * `compareState`; the Lab must be engaged for it to become ready.
   */
  start: (source: PlaybackSource) => void;
  /** Places the compared source `seconds` ahead of the playing one. */
  align: (seconds: number) => void;
  /** Which source is heard, and each source's gain (0..1) while heard; ramped. */
  route: (active: PlayerSlot, gains: Record<PlayerSlot, number>) => void;
  /**
   * Ends the comparison, keeping `keep` audible where it is: `"a"` drops the
   * compared source, `"b"` makes it the playing source in place of `"a"`.
   */
  end: (keep: PlayerSlot) => void;
};

/** The store's handle on the Lab. */
type LabControls = {
  /** Prepares the Lab and hands playback to it; also re-engages after a track change. */
  engage: () => void;
  /** Hands playback back to the audio element. */
  release: () => void;
  /** The settings the Lab plays with, and what its `normalise` reads. */
  set: (settings: LabSettings, loudness: LabLoudness) => void;
  /** A 31-band match-EQ curve in dB, or null for the parametric bands. */
  setEqCurve: (gains: number[] | null) => void;
  /**
   * The curve `setEqCurve` last set, for the bounce to print what is heard.
   * Tracked independently of whether the Lab is engaged, since a match EQ
   * can be chosen while the Lab is off.
   */
  readonly curve: number[] | null;
  /** The A/B comparison, which holds the Lab engaged while it runs. */
  compare: CompareControls;
};

export type AudioEngine = {
  load: (source: PlaybackSource) => void;
  play: () => void;
  pause: () => void;
  stop: () => void;
  seek: (seconds: number) => void;
  restart: () => void;
  applyPrefs: (prefs: PlayerPrefs) => void;
  readonly time: number;
  /** Whether `applyPrefs`'s volume has any audible effect. */
  readonly volumeControllable: boolean;
  /**
   * Asks for the Web Audio graph, for a surface that reads the audio itself —
   * the scope and the live meters. Routing costs the
   * ability to play with the screen off, so it happens only on request and
   * only once; there is no matching release, because an element routed into a
   * graph can never be taken back out of it.
   *
   * A no-op on a coarse pointer unless `onTouch` (the playback policy's
   * analysis on touch devices) says a touch device may route: a phone never
   * routes through Web Audio on its own, and this is the one place that rule
   * lives, so no caller has to know the pointer type.
   */
  requestAnalysis: (onTouch: boolean) => void;
  /** The analyser node for the lava field; null until routed. Never used as a flag. */
  readonly analyser: AnalyserNode | null;
  /**
   * Whether playback currently runs through Web Audio (the Lab, or the
   * element's graph built on request) rather than the element's own output.
   * The fact `useRouted` reads: a coarse pointer never costs itself this on
   * its own, and a surface that draws from the graph (the lava field, the
   * live scales) has nothing to read until it is true.
   */
  readonly routed: boolean;
  /**
   * A comparison played straight on the elements, with no Web Audio in
   * between: the second source plays on its own element from the same
   * transport position, and a swap is one element's `muted` flag against the
   * other's. It cannot match loudness — there is no gain stage to ramp — so
   * this is the path a coarse pointer's comparison uses instead of the Lab's,
   * and `AudioCompareControls` labels it unmatched. Every call is a no-op on
   * the silent engine.
   */
  readonly compare: CompareControls;
  /** The Lab surface; every call is a no-op on the silent engine. */
  readonly lab: LabControls;
  /**
   * Starts `next` under the playing source and overlaps the two for
   * `seconds`, the playing one fading out as `next` fades in; from then on
   * `next` is the source every call and event is about, and the one fading
   * out reports nothing more. False, with nothing changed, where this engine
   * cannot overlap two sources here — iOS owning the volume with nothing
   * routed, or a comparison running — and the caller lets the playing source
   * end and loads `next` then, as it would with no crossfade at all.
   */
  crossfade: (next: PlaybackSource, seconds: number) => boolean;
  /**
   * The source a crossfade will move to next, or null for none, told ahead
   * so an engine that needs time to prepare it (the Lab decodes a whole file)
   * can start. Only ever called while a crossfade is set.
   */
  prepareNext: (next: PlaybackSource | null) => void;
  destroy: () => void;
};

/** The audio-element engine: plain playback, and the Lab's hand-over partner. */
export type ElementEngine = Omit<AudioEngine, "load" | "lab"> & {
  load: (source: PlaybackSource) => void;
  /** Whether the playback element is playing, or asked to. */
  readonly playing: boolean;
  /** The element's own playback rate; pitch moves with it. */
  setRate: (rate: number) => void;
  /** Ramps the output down over `seconds`, then pauses. */
  fadeOut: (seconds: number) => void;
  /** Cancels a pending fade-out's pause and ramps the output back up over `seconds`. */
  fadeIn: (seconds: number) => void;
};

/**
 * iOS pins `HTMLMediaElement.volume` to 1 — the hardware buttons are the only
 * volume control — and there is no feature flag for it, so a write that does
 * not stick is the only signal. The element is discarded straight away; it is
 * never loaded or played.
 */
function probeVolumeControl(): boolean {
  const probe = new Audio();
  probe.volume = 0.5;
  return probe.volume === 0.5;
}

/**
 * The context the elements are routed into, once a surface has asked for
 * analysis, and what every routed element joins there.
 */
type Graph = {
  ctx: AudioContext;
  /** Where each element's gain goes: the output's analyser. */
  destination: AudioNode;
  /** The meter tap every routed element feeds, once its worklet has loaded. */
  meter: AudioNode | null;
};

/** An element's own path through the graph. */
type Route = {
  source: MediaElementAudioSourceNode;
  /**
   * What the element is heard at: the hand-over to and from the Lab ramps
   * it, and so does a crossfade.
   */
  fade: GainNode;
};

/**
 * One of the engine's audio elements: the one playing, the one a crossfade
 * leaves fading out, or an idle one kept for the next crossfade.
 */
type Voice = {
  el: HTMLAudioElement;
  /**
   * Where a crossfade has the element, 0..1. Unrouted, the element's own
   * volume carries it (the listener's volume times this); routed, its gain
   * does and the element's volume stays the listener's.
   */
  level: number;
  route: Route | null;
  /** Takes the engine's listeners back off the element. */
  unlisten: () => void;
};

/**
 * Taps every routed element, after its gain, into a meter running on the
 * audio thread: the reading is what the elements play, posted as side `"a"`
 * — during a crossfade, the two tracks as they are heard together. Nothing is
 * connected onwards — a node with no outputs is processed for its input
 * alone. A browser without AudioWorklet simply never reports, and the meter
 * UI stays at its static reading.
 */
async function attachMeters(
  graph: Graph,
  routes: () => Route[],
  events: AudioEngineEvents
) {
  const processor = await loadProcessor(graph.ctx);
  if (!processor.ok) return;
  const { module } = processor;
  try {
    const node = new AudioWorkletNode(graph.ctx, DSP_PROCESSOR, {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      processorOptions: { role: "meter", module } satisfies MeterRoleOptions,
    });
    node.port.onmessage = (event: MessageEvent<MeterMessage>) => {
      const message = event.data;
      if (message.type === "loudness") events.loudness?.("a", message.frame);
      else events.spectrum?.("a", message.db);
    };
    graph.meter = node;
    for (const route of routes()) route.fade.connect(node);
  } catch {
    // metering is an extra; playback never depends on it
  }
}

/**
 * Routes `element` through the graph so the Lab can cross-fade against it,
 * a crossfade can ramp it, and the now-playing scope has an analyser to
 * read. Returns null wherever the nodes can't be created — the element keeps
 * working with its own output in that case.
 *
 * `createMediaElementSource` is the point of no return: an element routed
 * into a context never goes back to playing on its own output, and if that
 * context will not run the element is simply silent. Callers must hand this a
 * graph whose context they have already seen reach `running`.
 */
function attachRoute(graph: Graph, element: HTMLAudioElement): Route | null {
  try {
    const fade = graph.ctx.createGain();
    const source = graph.ctx.createMediaElementSource(element);
    source.connect(fade);
    fade.connect(graph.destination);
    if (graph.meter) fade.connect(graph.meter);
    return { source, fade };
  } catch {
    return null; // the element keeps playing straight to the output
  }
}

/** How often an unrouted element's volume steps along a crossfade. */
const FADE_TICK_MS = 25;

/**
 * How long past a crossfade's end the element fading out is given before it
 * is let go, for a playhead a little behind the wall clock.
 */
const TAIL_GRACE_MS = 250;

/** A crossfade ends at once, however far it had got, over this. */
const SNAP_SECONDS = 0.012;

/**
 * Wraps a detached `HTMLAudioElement`. Playback state is never pushed into the
 * element from React — callers issue commands, and the element reports back
 * through `events`. A rejected `play()` therefore simply never fires `play`,
 * which is what keeps the UI from claiming to play a track the browser blocked.
 * A refusal is not a failure: only a source the element itself reports as
 * broken — its `error` event, or a rejected `play()` with `error` set — reaches
 * `events.error`, so an autoplay block or an abort from a source change stays
 * silent.
 *
 * `output` is the context and analyser the graph joins when a surface asks
 * for analysis; its owner closes it.
 *
 * One element plays. A crossfade is the only thing that ever creates a
 * second: the incoming track starts on it under the playing one, the two
 * fade across, and the one faded out is emptied and kept idle for the next
 * crossfade. With no crossfade the engine never has more than the one
 * element, exactly as though crossfading did not exist; the plain
 * comparison's second source is separate and has its own element.
 */
export function createAudioEngine(
  events: AudioEngineEvents,
  output: AudioOutputs
): ElementEngine {
  let currentPrefs: PlayerPrefs | null = null;
  let rate = 1;
  let graph: Graph | null = null;
  let building = false;
  let fadeTimer: ReturnType<typeof setTimeout> | undefined;
  /** The asset the playing element was loaded with; null while it has no source. */
  let assetId: number | null = null;

  /** The plain comparison's second source, from `compare.start` to `compare.end`. */
  let compareB: HTMLAudioElement | null = null;
  let compareBAssetId: number | null = null;
  let compareActive: PlayerSlot = "a";

  /** The element a crossfade is fading out, until it is let go. */
  let tail: { voice: Voice; timer: ReturnType<typeof setTimeout> } | null =
    null;
  /** An element a finished crossfade left idle, for the next one. */
  let spare: Voice | null = null;
  /** Volume ramps on unrouted elements, stepped by `fadeTicker`. */
  let fades: {
    voice: Voice;
    from: number;
    to: number;
    startedAt: number;
    ms: number;
  }[] = [];
  let fadeTicker: ReturnType<typeof setInterval> | undefined;

  /** The element playing: every command and every reported event is its. */
  let primary = createVoice();
  const volumeControllable = probeVolumeControl();

  /**
   * A new element with the engine's listeners on it. Each listener reports
   * only while its element is the playing one, so the element a crossfade is
   * fading out says nothing more — its `ended` lets it go instead. Once the
   * graph is built, a new element is routed into it at once.
   */
  function createVoice(): Voice {
    const el = new Audio();
    el.preservesPitch = false;
    const voice: Voice = { el, level: 1, route: null, unlisten: () => {} };
    const playing = () => voice === primary;
    const handlers: [string, () => void][] = [
      ["error", () => playing() && reportError()],
      ["play", () => playing() && events.play()],
      ["pause", () => playing() && events.pause()],
      [
        "ended",
        () => {
          if (playing()) events.ended();
          else if (voice === tail?.voice) endTail(false);
        },
      ],
      ["durationchange", () => playing() && reportDuration()],
      [
        "loadedmetadata",
        () => {
          if (playing()) reportDuration();
          // audio.load() resets playbackRate/volume to their defaults, so
          // re-assert the current prefs once the new source's metadata is in.
          if (currentPrefs) applyPrefs(currentPrefs);
          applyRate();
        },
      ],
    ];
    for (const [type, handler] of handlers) el.addEventListener(type, handler);
    voice.unlisten = () => {
      for (const [type, handler] of handlers) {
        el.removeEventListener(type, handler);
      }
    };
    if (graph) voice.route = attachRoute(graph, el);
    return voice;
  }

  const reportDuration = () => events.duration(primary.el.duration || 0);

  const reportError = () => {
    if (assetId !== null) {
      events.error(assetId, primary.el.error?.message ?? "");
    }
  };

  /** `voice`'s element volume: the listener's, times its level where it has no gain of its own. */
  const applyVolume = (voice: Voice) => {
    const volume = currentPrefs?.volume ?? 1;
    voice.el.volume = voice.route ? volume : volume * voice.level;
  };

  /**
   * The elements' `muted` flags together: the listener's own preference on
   * every one, plus whichever side a comparison is not currently playing out
   * loud. Muting rather than pausing the silent side is what lets a swap be
   * instant — both sources are already decoding and in sync.
   */
  const syncMuted = () => {
    const userMuted = currentPrefs?.muted ?? false;
    primary.el.muted =
      userMuted || (compareB !== null && compareActive === "b");
    if (tail) tail.voice.el.muted = userMuted;
    if (compareB) compareB.muted = userMuted || compareActive === "a";
  };

  const applyPrefs = (prefs: PlayerPrefs) => {
    currentPrefs = prefs;
    applyVolume(primary);
    if (tail) applyVolume(tail.voice);
    syncMuted();
    if (compareB) compareB.volume = prefs.volume;
  };

  const applyRate = () => {
    primary.el.playbackRate = rate;
    if (tail) tail.voice.el.playbackRate = rate;
  };

  function stepFades() {
    const now = performance.now();
    fades = fades.filter((fade) => {
      const done =
        fade.ms > 0 ? Math.min(1, (now - fade.startedAt) / fade.ms) : 1;
      fade.voice.level = fade.from + (fade.to - fade.from) * done;
      applyVolume(fade.voice);
      return done < 1;
    });
    if (fades.length === 0 && fadeTicker !== undefined) {
      clearInterval(fadeTicker);
      fadeTicker = undefined;
    }
  }

  /**
   * Moves `voice` to `level` over `seconds`: on its own gain, sample-accurate,
   * where it is routed, and by stepping its volume on the wall clock where it
   * is not. Zero seconds sets it at once.
   */
  function fadeVoice(voice: Voice, level: number, seconds: number) {
    fades = fades.filter((fade) => fade.voice !== voice);
    if (graph && voice.route) {
      // From the level the voice was last set to: a fade set at this same
      // instant (the silent start of a crossfade) is not in `gain.value` yet.
      const from = voice.level;
      voice.level = level;
      rampParam(graph.ctx, voice.route.fade.gain, level, seconds, from);
      return;
    }
    fades.push({
      voice,
      from: voice.level,
      to: level,
      startedAt: performance.now(),
      ms: seconds * 1000,
    });
    fadeTicker ??= setInterval(stepFades, FADE_TICK_MS);
    stepFades();
  }

  /**
   * Lets go of the element a crossfade is fading out: stopped, emptied and
   * kept idle for the next crossfade. `snap` finishes the fade-in at once
   * too, for a crossfade the listener cuts short with a pause, a seek or
   * another track. Nothing to do without a crossfade in flight.
   */
  function endTail(snap: boolean) {
    const ending = tail;
    if (!ending) return;
    tail = null;
    clearTimeout(ending.timer);
    fades = fades.filter((fade) => fade.voice !== ending.voice);
    ending.voice.el.pause();
    ending.voice.el.removeAttribute("src");
    ending.voice.el.load();
    spare = ending.voice;
    if (snap) fadeVoice(primary, 1, SNAP_SECONDS);
  }

  /** Every element with its own gain, for the meter to tap. */
  const routes = () =>
    [primary, tail?.voice, spare].flatMap((voice) =>
      voice?.route ? [voice.route] : []
    );

  /**
   * Builds the graph for the first surface that asks for it. The order here is
   * the whole point: the context is started and seen to be `running` before
   * any element is attached, because attaching is irreversible and a
   * context that never starts would leave the player silent with no way back.
   * A context that will not run is closed again and the elements are left
   * exactly as they were, playing on their own output with nothing to
   * analyse. A crossfade in flight is finished at once first, so only the
   * playing element (and an idle one, to be ready) is routed.
   */
  async function buildGraph() {
    if (graph || building) return;
    building = true;
    try {
      const opened = await output.open();
      if (!opened) return;
      endTail(true);
      const built: Graph = {
        ctx: opened.ctx,
        destination: opened.analyser,
        meter: null,
      };
      const route = attachRoute(built, primary.el);
      if (!route) return;
      primary.route = route;
      graph = built;
      if (spare) {
        spare.route = attachRoute(built, spare.el);
        // An element that would not route is no use to a routed crossfade;
        // the next one makes a fresh element instead.
        if (!spare.route) {
          spare.unlisten();
          spare = null;
        }
      }
      if (events.loudness || events.spectrum) {
        void attachMeters(built, routes, events);
      }
      events.analysis?.();
    } finally {
      building = false;
    }
  }

  const play = () => {
    // Only resume a context that already exists. Starting one here would
    // route every play through Web Audio, which is what a locked phone will
    // not follow — see `requestAnalysis`.
    if (graph) void graph.ctx.resume().catch(() => {});
    const { el } = primary;
    void el.play().catch(() => {
      // A refusal (autoplay, an abort from a source change) is not a failure;
      // the element saying it is in error is.
      if (el.error && el === primary.el) reportError();
    });
    if (compareB) void compareB.play().catch(() => {});
  };

  const pause = () => {
    endTail(true);
    primary.el.pause();
    compareB?.pause();
  };

  /**
   * Whether `voice` can be faded here: on its own gain where it is routed,
   * else only where the element's volume is ours to set — iOS keeps it.
   */
  const fadeable = (voice: Voice) => voice.route !== null || volumeControllable;

  /** Drops the compared element without touching the playing one. */
  const dropCompareB = () => {
    if (!compareB) return;
    compareB.pause();
    compareB.removeAttribute("src");
    compareB = null;
  };

  const compare: CompareControls = {
    start(source) {
      endTail(true);
      dropCompareB();
      const b = new Audio();
      b.preservesPitch = false;
      b.playbackRate = rate;
      if (currentPrefs) b.volume = currentPrefs.volume;
      compareB = b;
      compareBAssetId = source.assetId;
      compareActive = "a";
      syncMuted();
      // Placed at the playing source's position once its own metadata is in,
      // rather than at 0: a comparison can start mid-track.
      const join = () => {
        if (compareB !== b) return;
        b.currentTime = primary.el.currentTime;
        if (!primary.el.paused) void b.play().catch(() => {});
      };
      b.addEventListener("loadedmetadata", join, { once: true });
      b.src = source.src;
      b.load();
    },
    // There is no structural offset to place without the Lab's diff-aligned
    // decode; an unmatched comparison plays both sources from the same
    // transport position instead.
    align: () => {},
    route(active) {
      if (!compareB) return;
      compareActive = active;
      syncMuted();
    },
    end(keep) {
      const b = compareB;
      if (!b) return;
      if (keep === "b") {
        compareB = null;
        assetId = compareBAssetId;
        const { el } = primary;
        el.src = b.src;
        el.currentTime = b.currentTime;
        if (!b.paused) void el.play().catch(() => {});
        syncMuted();
        b.pause();
        b.removeAttribute("src");
      } else {
        dropCompareB();
        syncMuted();
      }
    },
  };

  return {
    load: (source) => {
      endTail(true);
      assetId = source.assetId;
      primary.el.src = source.src;
      primary.el.load();
    },
    play,
    pause,
    stop: () => {
      endTail(true);
      assetId = null;
      primary.el.pause();
      primary.el.removeAttribute("src");
      primary.el.load();
      dropCompareB();
    },
    seek: (seconds) => {
      endTail(true);
      primary.el.currentTime = seconds;
      if (compareB) compareB.currentTime = seconds;
    },
    restart: () => {
      endTail(true);
      primary.el.currentTime = 0;
      if (compareB) compareB.currentTime = 0;
      play();
    },
    applyPrefs,
    get time() {
      return primary.el.currentTime;
    },
    get playing() {
      return !primary.el.paused;
    },
    volumeControllable,
    setRate: (next) => {
      rate = next;
      applyRate();
      if (compareB) compareB.playbackRate = next;
    },
    fadeOut: (seconds) => {
      clearTimeout(fadeTimer);
      endTail(true);
      const route = primary.route;
      if (!graph || !route) return pause();
      rampParam(graph.ctx, route.fade.gain, 0, seconds);
      fadeTimer = setTimeout(pause, seconds * 1000);
    },
    fadeIn: (seconds) => {
      clearTimeout(fadeTimer);
      const route = primary.route;
      if (graph && route) {
        rampParam(graph.ctx, route.fade.gain, primary.level, seconds);
      }
    },
    crossfade(next, seconds) {
      // Checked before anything is made: where iOS keeps the volume and
      // nothing is routed there is no way to fade, and the element path
      // stays exactly as it is with no crossfade set.
      if (compareB || !fadeable(primary)) return false;
      endTail(true);
      const incoming = spare ?? createVoice();
      spare = null;
      if (!fadeable(incoming)) {
        spare = incoming;
        return false;
      }
      const outgoing = primary;
      primary = incoming;
      assetId = next.assetId;
      incoming.el.src = next.src;
      incoming.el.load();
      // Silent before it makes a sound: the level goes to 0 after the load,
      // which may reset the element's volume, and before the play.
      fadeVoice(incoming, 0, 0);
      applyRate();
      syncMuted();
      play();
      fadeVoice(outgoing, 0, seconds);
      fadeVoice(incoming, 1, seconds);
      tail = {
        voice: outgoing,
        timer: setTimeout(() => endTail(false), seconds * 1000 + TAIL_GRACE_MS),
      };
      return true;
    },
    // An element starts quickly enough from a network source; there is
    // nothing to prepare ahead of the crossfade.
    prepareNext: () => {},
    requestAnalysis: (onTouch) => {
      // Read fresh rather than once at module load, so a hybrid device (a
      // touchscreen laptop with a mouse plugged in, say) answers by the
      // pointer in play right now.
      if (onTouch || !isCoarsePointer()) void buildGraph();
    },
    get analyser() {
      return graph ? (output.current?.analyser ?? null) : null;
    },
    get routed() {
      return graph !== null;
    },
    compare,
    destroy: () => {
      clearTimeout(fadeTimer);
      endTail(false);
      clearInterval(fadeTicker);
      fades = [];
      primary.el.pause();
      primary.unlisten();
      spare?.unlisten();
      primary.el.removeAttribute("src");
      dropCompareB();
    },
  };
}

/** Stands in during server rendering, where there is no `Audio` constructor. */
export const silentEngine: AudioEngine = {
  load: () => {},
  play: () => {},
  pause: () => {},
  stop: () => {},
  seek: () => {},
  restart: () => {},
  applyPrefs: () => {},
  time: 0,
  // Matches a desktop browser, so the pre-hydration markup a server render
  // produces is the markup the common case hydrates into.
  volumeControllable: true,
  requestAnalysis: () => {},
  analyser: null,
  routed: false,
  compare: {
    start: () => {},
    align: () => {},
    route: () => {},
    end: () => {},
  },
  lab: {
    engage: () => {},
    release: () => {},
    set: () => {},
    setEqCurve: () => {},
    curve: null,
    compare: {
      start: () => {},
      align: () => {},
      route: () => {},
      end: () => {},
    },
  },
  crossfade: () => false,
  prepareNext: () => {},
  destroy: () => {},
};
