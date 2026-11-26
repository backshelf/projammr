import type {
  AudioEngineEvents,
  LabSource,
  PlaybackSource,
} from "@/components/music-player/player-engine";
import type { PlayerPrefs } from "@/components/music-player/player-storage";
import { rampParam, type AudioOutput } from "@/lib/dsp/audio-output";
import {
  chainParams,
  changedParams,
  playbackSpeed,
  type ChainParams,
  type LabLoudness,
  type LabSettings,
} from "@/lib/dsp/lab-settings";
import {
  DSP_PROCESSOR,
  type PlayerCommand,
  type PlayerMessage,
  type PlayerRoleOptions,
  type PlayerSlot,
  type SourceSlot,
} from "@/lib/dsp/processor-protocol";
import { loadProcessor } from "@/lib/dsp/processor-module";

const MIB = 1024 * 1024;

/**
 * The largest source the Lab decodes on this device. Decoded audio is about
 * as large again in module memory as a WAV on disk, so a phone stops far
 * sooner than a desktop.
 */
const labSizeCap = (coarse: boolean) => (coarse ? 80 : 300) * MIB;

/** Why the Lab cannot play a source; `reason` is written for the listener. */
export class LabUnavailable extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "LabUnavailable";
  }
}

/** Where the playhead is, from both sides of a hand-over. */
export type Handover = { position: number; playing: boolean };

export type LabProgress = (fraction: number, source: LabSource) => void;

export type LabEngineDeps = {
  /**
   * Downloads a media URL. Narrower than `typeof fetch` on purpose: the
   * global's type carries `preconnect`, which a wrapping arrow function
   * cannot supply, and which differs between the DOM and Bun lib types.
   */
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  /** Whether the primary pointer is coarse, which sets the size cap. */
  coarse: () => boolean;
  /**
   * Asks the server for a 320 kbps copy of an asset over the cap, resolving
   * with the copy's media URL once its conversion job is done.
   */
  requestCopy: (assetId: number, signal: AbortSignal) => Promise<string>;
};

export type LabEngine = {
  /**
   * Downloads and decodes `source` and hands it to the processor, reporting
   * download progress; rejects with {@link LabUnavailable}. Emits `duration`
   * once the processor holds the source.
   */
  load: (
    source: PlaybackSource,
    onProgress: LabProgress,
    signal: AbortSignal
  ) => Promise<void>;
  /** Starts from a hand-over, ramping in over `seconds`. */
  start: (at: Handover, seconds: number) => void;
  /** Ramps out over `seconds`, then pauses without reporting it. */
  stop: (seconds: number) => void;
  play: () => void;
  pause: () => void;
  seek: (seconds: number) => void;
  readonly time: number;
  readonly playing: boolean;
  /** Where the loaded source came from. */
  readonly source: LabSource;
  set: (settings: LabSettings, loudness: LabLoudness) => void;
  setEqCurve: (gains: number[] | null) => void;
  applyPrefs: (prefs: PlayerPrefs) => void;
  /**
   * Downloads and decodes a comparison's second source into the processor
   * beside the playing one, which it follows in lockstep; rejects with
   * {@link LabUnavailable}.
   */
  loadCompare: (
    source: PlaybackSource,
    onProgress: LabProgress,
    signal: AbortSignal
  ) => Promise<void>;
  /** Places the compared source `seconds` ahead of the playing one. */
  alignCompare: (seconds: number) => void;
  /** Ramps to `active`'s chain at its gain, silencing the other. */
  routeCompare: (active: PlayerSlot, gains: Record<PlayerSlot, number>) => void;
  /** Drops the compared source; the playing one carries on at full gain. */
  unloadCompare: () => void;
  /**
   * Makes the compared source the only one, where it is: `time` and
   * `duration` become its own, and `duration` is emitted for it.
   */
  promoteCompare: () => void;
  /**
   * Downloads and decodes the source a crossfade moves to next into the
   * processor beside the playing one, where it waits silent until
   * `crossfade`; rejects with {@link LabUnavailable}. A later call waits for
   * an earlier one to settle, so their answers from the processor never
   * cross.
   */
  loadNext: (
    source: PlaybackSource,
    onProgress: LabProgress,
    signal: AbortSignal
  ) => Promise<void>;
  /** Drops a waiting next source. */
  unloadNext: () => void;
  /**
   * Starts the waiting next source from its beginning, fading it in over
   * `seconds` as the playing source fades out through its own chain: `time`,
   * `duration` and `source` become the new source's from here, and
   * `duration` is emitted for it once this call has returned. False, with
   * nothing changed, when no next source is loaded.
   */
  crossfade: (seconds: number) => boolean;
  readonly analyser: AnalyserNode;
  destroy: () => void;
};

type Pending = {
  resolve: (seconds: number) => void;
  reject: (error: LabUnavailable) => void;
};

/** Reads a response body to the end, reporting progress, or null past `cap` bytes. */
async function readCapped(
  response: Response,
  cap: number,
  onFraction: (fraction: number) => void
): Promise<ArrayBuffer | null> {
  const total = Number(response.headers.get("Content-Length")) || 0;
  if (total > cap) {
    void response.body?.cancel().catch(() => {});
    return null;
  }
  if (!response.body) return response.arrayBuffer();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > cap) {
      void reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
    if (total) onFraction(Math.min(1, received / total));
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}

/** Downloads `url` within this device's cap, reporting the fraction received, or null over it. */
async function fetchSource(
  deps: LabEngineDeps,
  url: string,
  signal: AbortSignal,
  onFraction: (fraction: number) => void
): Promise<ArrayBuffer | null> {
  let response: Response;
  try {
    response = await deps.fetch(url, { credentials: "include", signal });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new LabUnavailable("The file could not be downloaded");
  }
  if (!response.ok) {
    throw new LabUnavailable("The file could not be downloaded");
  }
  return readCapped(response, labSizeCap(deps.coarse()), onFraction);
}

/**
 * Downloads `target`'s bytes within this device's cap, falling back to a
 * 320 kbps copy over it — the network half of {@link LabEngine.load}, shared
 * with the bounce, which decodes into its own offline context rather than
 * the Lab's shared one. Rejects with {@link LabUnavailable} once both the
 * original and the copy are too large, or the download fails.
 */
export async function loadSourceBytes(
  target: PlaybackSource,
  deps: LabEngineDeps,
  onProgress: LabProgress,
  signal: AbortSignal
): Promise<{ buffer: ArrayBuffer; source: LabSource }> {
  let source: LabSource = "original";
  onProgress(0, source);
  let buffer = await fetchSource(deps, target.src, signal, (fraction) =>
    onProgress(fraction, "original")
  );
  if (!buffer) {
    source = "copy";
    onProgress(0, source);
    const copy = await deps.requestCopy(target.assetId, signal);
    buffer = await fetchSource(deps, copy, signal, (fraction) =>
      onProgress(fraction, "copy")
    );
    if (!buffer) {
      throw new LabUnavailable("This file is too large for the Lab here");
    }
  }
  onProgress(1, source);
  return { buffer, source };
}

/**
 * The Lab: a decoded-buffer player running in the `"player"` role of the DSP
 * processor, on the shared output's context:
 * `player node → labGain → analyser → destination`.
 *
 * `time` is synchronous, for the store's 60 Hz progress loop: it runs from
 * the last anchor on `ctx.currentTime` at the playback speed, and every
 * `position` frame the processor posts (about every 50 ms) re-anchors it.
 * A seek re-anchors at once and ignores the frames posted before the
 * processor saw it.
 */
export async function createLabEngine(
  output: AudioOutput,
  events: AudioEngineEvents,
  deps: LabEngineDeps
): Promise<LabEngine> {
  const { ctx, analyser } = output;
  const processor = await loadProcessor(ctx);
  if (!processor.ok) {
    throw new LabUnavailable(
      processor.reason === "unsupported"
        ? "This browser cannot run the Lab"
        : "The Lab could not load its processor"
    );
  }

  const node = new AudioWorkletNode(ctx, DSP_PROCESSOR, {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    processorOptions: {
      role: "player",
      module: processor.module,
    } satisfies PlayerRoleOptions,
  });
  const labGain = ctx.createGain();
  node.connect(labGain);
  labGain.connect(analyser);

  let volume = 1;
  let source: LabSource = "original";
  let loaded = false;
  let duration = 0;
  /** The compared source's duration and placement, while one is loaded. */
  let compared: { duration: number; offset: number } | null = null;
  /** The source waiting for a crossfade, once the processor holds it. */
  let next: { duration: number; source: LabSource } | null = null;
  /** The latest `loadNext`, which the next one waits on. */
  let loadingNext: Promise<unknown> = Promise.resolve();
  let playing = false;
  let speed = 1;
  let anchor = { position: 0, at: 0 };
  let seekSeq = 0;
  let sentParams: ChainParams | null = null;
  const pending: Partial<Record<SourceSlot, Pending>> = {};
  let stopTimer: ReturnType<typeof setTimeout> | undefined;

  const send = (command: PlayerCommand, transfer: Transferable[] = []) =>
    node.port.postMessage(command, transfer);

  const now = () => {
    if (!playing) return anchor.position;
    const elapsed = Math.max(0, ctx.currentTime - anchor.at);
    return Math.min(duration, anchor.position + elapsed * speed);
  };

  const reanchor = (position: number) => {
    anchor = { position, at: ctx.currentTime };
  };

  node.port.onmessage = (event: MessageEvent<PlayerMessage>) => {
    const message = event.data;
    switch (message.type) {
      case "duration":
        pending[message.slot]?.resolve(message.seconds);
        return;
      case "failed":
        pending[message.slot]?.reject(
          new LabUnavailable("There is not enough memory for this file here")
        );
        return;
      case "position":
        if (message.seq === seekSeq) {
          anchor = { position: message.frame / ctx.sampleRate, at: message.at };
        }
        return;
      case "pause":
        playing = false;
        reanchor(duration);
        events.pause();
        return;
      case "ended":
        events.ended();
        return;
      case "loudness":
        events.loudness?.(message.side, message.frame);
        return;
      case "spectrum":
        events.spectrum?.(message.side, message.db);
        return;
      case "gr":
        events.gr?.(message.db);
        return;
    }
  };

  const setGain = (target: number, seconds: number) =>
    rampParam(ctx, labGain.gain, target, seconds);

  const play = () => {
    if (!loaded) return;
    clearTimeout(stopTimer);
    void ctx.resume().catch(() => {});
    if (now() >= duration) reanchor(0);
    send({ type: "play" });
    playing = true;
    reanchor(anchor.position);
    events.play();
  };

  const pause = () => {
    const position = now();
    send({ type: "pause" });
    playing = false;
    reanchor(position);
    events.pause();
  };

  const seek = (seconds: number) => {
    const position = Math.min(duration, Math.max(0, seconds));
    seekSeq += 1;
    send({ type: "seek", seconds: position, seq: seekSeq });
    reanchor(position);
  };

  /**
   * Downloads, decodes and hands `target` to the processor's `slot`,
   * resolving with its duration once the processor holds it.
   */
  async function loadSlot(
    slot: SourceSlot,
    target: PlaybackSource,
    onProgress: LabProgress,
    signal: AbortSignal
  ): Promise<{ seconds: number; source: LabSource }> {
    const held = await loadSourceBytes(target, deps, onProgress, signal);
    let decoded: AudioBuffer;
    try {
      decoded = await ctx.decodeAudioData(held.buffer);
    } catch {
      throw new LabUnavailable("This format cannot be decoded here");
    }
    if (signal.aborted) throw signal.reason;

    const channels = Array.from(
      { length: Math.min(2, decoded.numberOfChannels) },
      (_, i) => decoded.getChannelData(i).slice()
    );
    const seconds = await new Promise<number>((resolve, reject) => {
      pending[slot] = { resolve, reject };
      send(
        { type: "load", slot, channels },
        channels.map((channel) => channel.buffer)
      );
    }).finally(() => {
      delete pending[slot];
    });
    return { seconds, source: held.source };
  }

  const route = (active: PlayerSlot, gains: Record<PlayerSlot, number>) =>
    send({ type: "route", active, gains });

  return {
    async load(target, onProgress, signal) {
      loaded = false;
      const held = await loadSlot("a", target, onProgress, signal);
      source = held.source;
      const seconds = held.seconds;
      duration = seconds;
      loaded = true;
      playing = false;
      reanchor(0);
      events.duration(seconds);
    },
    start(at, seconds) {
      seek(at.position);
      labGain.gain.value = 0;
      setGain(volume, seconds);
      if (at.playing) play();
    },
    stop(seconds) {
      setGain(0, seconds);
      const position = now();
      playing = false;
      reanchor(position);
      clearTimeout(stopTimer);
      stopTimer = setTimeout(() => send({ type: "pause" }), seconds * 1000);
    },
    play,
    pause,
    seek,
    get time() {
      return now();
    },
    get playing() {
      return playing;
    },
    get source() {
      return source;
    },
    set(settings, loudness) {
      const next = chainParams(settings, loudness);
      const changed = changedParams(sentParams, next);
      sentParams = next;
      if (changed.values.length || changed.bypass.length) {
        send({ type: "params", ...changed });
      }
      const nextSpeed = playbackSpeed(settings);
      if (nextSpeed !== speed) {
        reanchor(now());
        speed = nextSpeed;
      }
    },
    setEqCurve(gains) {
      send({ type: "curve", gains });
    },
    applyPrefs(prefs) {
      volume = prefs.muted ? 0 : prefs.volume;
      setGain(volume, 0.005);
    },
    async loadCompare(target, onProgress, signal) {
      compared = null;
      const held = await loadSlot("b", target, onProgress, signal);
      compared = { duration: held.seconds, offset: 0 };
    },
    alignCompare(seconds) {
      if (compared) compared.offset = seconds;
      send({ type: "offset", seconds });
    },
    routeCompare: route,
    unloadCompare() {
      compared = null;
      send({ type: "unload", slot: "b" });
      route("a", { a: 1, b: 1 });
    },
    promoteCompare() {
      if (!compared) return;
      const position = Math.min(
        compared.duration,
        Math.max(0, now() + compared.offset)
      );
      duration = compared.duration;
      compared = null;
      seekSeq += 1;
      send({ type: "promote", seq: seekSeq });
      route("a", { a: 1, b: 1 });
      reanchor(position);
      events.duration(duration);
    },
    loadNext(target, onProgress, signal) {
      next = null;
      const loading = loadingNext.then(async () => {
        if (signal.aborted) throw signal.reason;
        const held = await loadSlot("next", target, onProgress, signal);
        // Aborted once the processor already held it: it stays unused there
        // until `unloadNext` or the next load replaces it.
        if (signal.aborted) throw signal.reason;
        next = { duration: held.seconds, source: held.source };
      });
      loadingNext = loading.catch(() => {});
      return loading;
    },
    unloadNext() {
      next = null;
      send({ type: "unload", slot: "next" });
    },
    crossfade(seconds) {
      const incoming = next;
      if (!incoming) return false;
      next = null;
      compared = null;
      seekSeq += 1;
      send({ type: "crossfade", seconds, seq: seekSeq });
      duration = incoming.duration;
      source = incoming.source;
      reanchor(0);
      // After the caller has taken the new source on as its own, so the
      // duration lands on it rather than being reset along with the old one.
      const reported = duration;
      queueMicrotask(() => events.duration(reported));
      return true;
    },
    analyser,
    destroy() {
      clearTimeout(stopTimer);
      for (const slot of Object.values(pending)) {
        slot.reject(new LabUnavailable("The Lab closed"));
      }
      node.port.onmessage = null;
      send({ type: "unload", slot: "a" });
      send({ type: "unload", slot: "b" });
      send({ type: "unload", slot: "next" });
      node.disconnect();
      labGain.disconnect();
    },
  };
}
