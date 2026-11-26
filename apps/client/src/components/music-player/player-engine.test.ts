import { afterEach, describe, expect, it, jest, mock } from "bun:test";
import { stubGlobal, unstubAllGlobals } from "@workspace/test/globals";

import { createAudioOutput } from "@/lib/dsp/audio-output";
import { createAudioEngine, type AudioEngineEvents } from "./player-engine";

const engineWith = (e: AudioEngineEvents) =>
  createAudioEngine(e, createAudioOutput());

const events: AudioEngineEvents = {
  play: () => {},
  pause: () => {},
  ended: () => {},
  duration: () => {},
  error: () => {},
  spectrum: () => {},
};

const track = { src: "https://example.test/a.mp3", assetId: 1 };

/**
 * The parts of `HTMLAudioElement` the engine touches. `pinVolume` reproduces
 * iOS Safari, where a write to `volume` is dropped and the property reads back
 * as 1.
 */
function audioStub({ pinVolume }: { pinVolume: boolean }) {
  return class {
    written = 1;
    muted = false;
    playbackRate = 1;
    preservesPitch = false;
    currentTime = 0;
    duration = 0;
    paused = true;
    src = "";
    /** The element's `MediaError`, as it reads after a failed load. */
    error: { message: string } | null = null;
    /** What `play()` rejects with, when set. */
    playRejection: Error | null = null;
    private handlers = new Map<string, Set<() => void>>();

    get volume() {
      return pinVolume ? 1 : this.written;
    }
    set volume(value: number) {
      this.written = value;
    }

    addEventListener(type: string, handler: () => void) {
      const forType = this.handlers.get(type) ?? new Set<() => void>();
      forType.add(handler);
      this.handlers.set(type, forType);
    }
    removeEventListener(type: string, handler: () => void) {
      this.handlers.get(type)?.delete(handler);
    }
    removeAttribute() {
      this.src = "";
    }
    load() {}
    pause() {
      this.paused = true;
    }
    play() {
      if (this.playRejection) return Promise.reject(this.playRejection);
      this.paused = false;
      return Promise.resolve();
    }
    emit(type: string) {
      this.handlers.get(type)?.forEach((handler) => handler());
    }
  };
}

/**
 * Two `Audio()` calls happen inside `createAudioEngine`, in order: the
 * playback element and the throwaway volume probe.
 */
function stubTwoAudios({ pinVolume }: { pinVolume: boolean }) {
  type Stub = InstanceType<ReturnType<typeof audioStub>>;
  const Base = audioStub({ pinVolume });
  const created: Stub[] = [];
  class Tracked extends Base {
    constructor() {
      super();
      created.push(this);
    }
  }
  stubGlobal("Audio", Tracked);
  return {
    created,
    playback: () => created[0]!,
    probe: () => created[1]!,
  };
}

afterEach(() => unstubAllGlobals());

describe("createAudioEngine volume capability", () => {
  it("reports volume as controllable when a write to it sticks", () => {
    stubGlobal("Audio", audioStub({ pinVolume: false }));

    expect(engineWith(events).volumeControllable).toBe(true);
  });

  it("reports volume as uncontrollable when the element drops the write", () => {
    stubGlobal("Audio", audioStub({ pinVolume: true }));

    expect(engineWith(events).volumeControllable).toBe(false);
  });
});

describe("createAudioEngine elements", () => {
  it("creates only the playback element and the volume probe", () => {
    const stub = stubTwoAudios({ pinVolume: false });
    const engine = engineWith(events);

    engine.load(track);
    engine.seek(42);

    expect(stub.created).toHaveLength(2);
    expect(stub.playback().src).toBe("https://example.test/a.mp3");
    expect(stub.playback().currentTime).toBe(42);
    expect(stub.probe().src).toBe("");
  });

  it("applies the mute pref to the playback element", () => {
    const stub = stubTwoAudios({ pinVolume: false });
    const engine = engineWith(events);

    engine.applyPrefs({
      volume: 0.4,
      muted: true,
      repeat: "off",
      shuffle: false,
    });

    expect(stub.playback().muted).toBe(true);
    expect(stub.playback().volume).toBe(0.4);
  });
});

describe("createAudioEngine load failure", () => {
  const failed = { message: "MEDIA_ELEMENT_ERROR: Format error" };

  it("reports the element's error with its message and the loaded asset", () => {
    const stub = stubTwoAudios({ pinVolume: false });
    const reports: [number, string][] = [];
    const engine = engineWith({
      ...events,
      error: (assetId, message) => reports.push([assetId, message]),
    });
    engine.load(track);

    stub.playback().error = failed;
    stub.playback().emit("error");

    expect(reports).toEqual([[1, failed.message]]);
  });

  it("reports an empty message when the browser gives the error none", () => {
    const stub = stubTwoAudios({ pinVolume: false });
    const reports: string[] = [];
    const engine = engineWith({
      ...events,
      error: (_assetId, message) => reports.push(message),
    });
    engine.load(track);

    stub.playback().emit("error");

    expect(reports).toEqual([""]);
  });

  it("stays silent for an error after the source is stopped", () => {
    const stub = stubTwoAudios({ pinVolume: false });
    const reports: number[] = [];
    const engine = engineWith({
      ...events,
      error: (assetId) => reports.push(assetId),
    });
    engine.load(track);
    engine.stop();

    stub.playback().emit("error");

    expect(reports).toEqual([]);
  });

  it("reports a rejected play() when the element is in error", async () => {
    const stub = stubTwoAudios({ pinVolume: false });
    const reports: [number, string][] = [];
    const engine = engineWith({
      ...events,
      error: (assetId, message) => reports.push([assetId, message]),
    });
    engine.load(track);
    stub.playback().error = failed;
    stub.playback().playRejection = new DOMException("", "NotSupportedError");

    engine.play();
    await settle();

    expect(reports).toEqual([[1, failed.message]]);
  });

  it("stays silent for a rejected play() when the element is not in error", async () => {
    const stub = stubTwoAudios({ pinVolume: false });
    const reports: number[] = [];
    const engine = engineWith({
      ...events,
      error: (assetId) => reports.push(assetId),
    });
    engine.load(track);
    stub.playback().playRejection = new DOMException("", "NotAllowedError");

    engine.play();
    await settle();

    expect(reports).toEqual([]);
  });
});

/**
 * The parts of `AudioContext` the engine touches. `startsRunning` is the
 * difference between a browser that lets a context start and one that holds it
 * suspended — iOS outside a user gesture — which is the case the engine has to
 * back out of without having touched the elements.
 */
function stubAudioContext({ startsRunning }: { startsRunning: boolean }) {
  const param = () => ({
    value: 0,
    setValueAtTime() {},
    cancelScheduledValues() {},
    linearRampToValueAtTime() {},
  });
  const created: FakeContext[] = [];

  class FakeContext {
    state = "suspended";
    closed = false;
    currentTime = 0;
    destination = {};
    /** No worklet, so the meters are skipped: they are not what these assert. */
    audioWorklet = undefined;
    routed: unknown[] = [];

    constructor() {
      created.push(this);
    }
    resume() {
      if (startsRunning) this.state = "running";
      return Promise.resolve();
    }
    close() {
      this.closed = true;
      this.state = "closed";
      return Promise.resolve();
    }
    createGain() {
      return { gain: param(), connect() {} };
    }
    createAnalyser() {
      return { connect() {} };
    }
    createMediaElementSource(element: unknown) {
      this.routed.push(element);
      return { connect() {} };
    }
  }

  stubGlobal("window", { AudioContext: FakeContext });
  return { created, only: () => created[0]! };
}

/** Lets `requestAnalysis`'s promise chain settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createAudioEngine analysis routing", () => {
  it("plays with no AudioContext at all without building a graph or throwing", () => {
    stubTwoAudios({ pinVolume: false });
    const engine = engineWith(events);

    expect(() => engine.play()).not.toThrow();
    expect(engine.analyser).toBeNull();
  });

  it("plays without a Web Audio context until a surface asks for one", () => {
    stubTwoAudios({ pinVolume: false });
    const context = stubAudioContext({ startsRunning: true });
    const engine = engineWith(events);

    engine.load(track);
    engine.play();

    expect(context.created).toHaveLength(0);
    expect(engine.analyser).toBeNull();
  });

  it("routes the playback element and exposes an analyser once analysis is asked for", async () => {
    const stub = stubTwoAudios({ pinVolume: false });
    const context = stubAudioContext({ startsRunning: true });
    const engine = engineWith(events);

    engine.requestAnalysis(false);
    await settle();

    expect(engine.analyser).not.toBeNull();
    expect(context.only().routed).toEqual([stub.playback()]);
  });

  it("builds the graph once however many surfaces ask", async () => {
    stubTwoAudios({ pinVolume: false });
    const context = stubAudioContext({ startsRunning: true });
    const engine = engineWith(events);

    engine.requestAnalysis(false);
    engine.requestAnalysis(false);
    await settle();
    engine.requestAnalysis(false);
    await settle();

    expect(context.created).toHaveLength(1);
  });

  it("never builds a graph on a coarse pointer", async () => {
    stubTwoAudios({ pinVolume: false });
    let created = 0;
    class CountingContext {
      constructor() {
        created++;
      }
    }
    stubGlobal("window", {
      AudioContext: CountingContext,
      matchMedia: (query: string) => ({ matches: query.includes("coarse") }),
    });
    const engine = engineWith(events);

    engine.requestAnalysis(false);
    await settle();

    expect(created).toBe(0);
    expect(engine.analyser).toBeNull();
  });

  it("builds the graph on a coarse pointer when the policy allows analysis on touch", async () => {
    const stub = stubTwoAudios({ pinVolume: false });
    const context = stubAudioContext({ startsRunning: true });
    stubGlobal("window", {
      ...(globalThis.window as object),
      matchMedia: (query: string) => ({ matches: query.includes("coarse") }),
    });
    const engine = engineWith(events);

    engine.requestAnalysis(true);
    await settle();

    expect(context.only().routed).toEqual([stub.playback()]);
  });

  it("leaves the elements unrouted when the context will not start", async () => {
    stubTwoAudios({ pinVolume: false });
    const context = stubAudioContext({ startsRunning: false });
    const engine = engineWith(events);

    engine.requestAnalysis(false);
    await settle();

    // The whole point: routing is irreversible, so a context that never runs
    // must not have been handed the elements — they are still playing on their
    // own output, with nothing to analyse.
    expect(context.only().routed).toEqual([]);
    expect(context.only().closed).toBe(true);
    expect(engine.analyser).toBeNull();
  });
});

describe("createAudioEngine plain comparison", () => {
  it("plays the second source muted, in step with the first, with no AudioContext", () => {
    const stub = stubTwoAudios({ pinVolume: false });
    const engine = engineWith(events);

    engine.load(track);
    engine.play();
    stub.playback().currentTime = 12;

    engine.compare.start({ src: "https://example.test/b.mp3", assetId: 2 });
    const b = stub.created[2]!;
    expect(b.muted).toBe(true);
    b.emit("loadedmetadata");

    expect(b.currentTime).toBe(12);
    expect(b.paused).toBe(false);
    expect(engine.analyser).toBeNull();
  });

  it("swaps which element is heard by their muted flags alone", () => {
    const stub = stubTwoAudios({ pinVolume: false });
    const engine = engineWith(events);
    engine.load(track);
    engine.compare.start({ src: "https://example.test/b.mp3", assetId: 2 });
    const b = stub.created[2]!;

    engine.compare.route("b", { a: 1, b: 1 });

    expect(stub.playback().muted).toBe(true);
    expect(b.muted).toBe(false);

    engine.compare.route("a", { a: 1, b: 1 });

    expect(stub.playback().muted).toBe(false);
    expect(b.muted).toBe(true);
  });

  it("keeps both elements muted while the listener's own mute pref is on", () => {
    const stub = stubTwoAudios({ pinVolume: false });
    const engine = engineWith(events);
    engine.load(track);
    engine.applyPrefs({
      volume: 1,
      muted: true,
      repeat: "off",
      shuffle: false,
    });

    engine.compare.start({ src: "https://example.test/b.mp3", assetId: 2 });
    const b = stub.created[2]!;
    engine.compare.route("b", { a: 1, b: 1 });

    expect(stub.playback().muted).toBe(true);
    expect(b.muted).toBe(true);

    // Unmuting brings back only the audible side of the comparison.
    engine.applyPrefs({
      volume: 1,
      muted: false,
      repeat: "off",
      shuffle: false,
    });
    expect(stub.playback().muted).toBe(true);
    expect(b.muted).toBe(false);
  });

  it("promotes the compared source onto the playing element when it is kept", () => {
    const stub = stubTwoAudios({ pinVolume: false });
    const engine = engineWith(events);
    engine.load(track);
    engine.compare.start({ src: "https://example.test/b.mp3", assetId: 2 });
    const b = stub.created[2]!;
    b.currentTime = 5;

    engine.compare.end("b");

    expect(stub.playback().src).toBe("https://example.test/b.mp3");
    expect(stub.playback().currentTime).toBe(5);
  });

  it("drops the compared source and leaves the playing element alone when it is not kept", () => {
    const stub = stubTwoAudios({ pinVolume: false });
    const engine = engineWith(events);
    engine.load(track);
    engine.compare.start({ src: "https://example.test/b.mp3", assetId: 2 });

    engine.compare.end("a");

    expect(stub.playback().src).toBe("https://example.test/a.mp3");
  });

  it("carries a seek and a rate change onto the compared source", () => {
    const stub = stubTwoAudios({ pinVolume: false });
    const engine = engineWith(events);
    engine.load(track);
    engine.compare.start({ src: "https://example.test/b.mp3", assetId: 2 });
    const b = stub.created[2]!;

    engine.seek(30);
    engine.setRate(1.5);

    expect(b.currentTime).toBe(30);
    expect(b.playbackRate).toBe(1.5);
  });

  it("rewinds the compared source alongside the playing one on restart", () => {
    const stub = stubTwoAudios({ pinVolume: false });
    const engine = engineWith(events);
    engine.load(track);
    engine.compare.start({ src: "https://example.test/b.mp3", assetId: 2 });
    const b = stub.created[2]!;
    stub.playback().currentTime = 45;
    b.currentTime = 45;

    engine.restart();

    expect(stub.playback().currentTime).toBe(0);
    expect(b.currentTime).toBe(0);
  });
});

describe("createAudioEngine crossfade", () => {
  afterEach(() => jest.useRealTimers());

  const next = { src: "https://example.test/next.mp3", assetId: 2 };
  const prefs = (volume: number) => ({
    volume,
    muted: false,
    repeat: "off" as const,
    shuffle: false,
  });

  /** Track A loaded and playing at `volume`, on elements whose volume is `pinned` or ours. */
  function playing({ pinVolume = false, volume = 0.8 } = {}) {
    const stub = stubTwoAudios({ pinVolume });
    const heard = {
      ended: mock(),
      duration: mock<(seconds: number) => void>(),
      play: mock(),
      pause: mock(),
    };
    const engine = engineWith({ ...events, ...heard });
    engine.applyPrefs(prefs(volume));
    engine.load(track);
    engine.play();
    return { stub, engine, heard, incoming: () => stub.created[2]! };
  }

  it("never makes a second element where iOS owns the volume and nothing is routed", () => {
    const { stub, engine } = playing({ pinVolume: true });

    expect(engine.crossfade(next, 3)).toBe(false);

    // The playback element and the volume probe, and nothing else: the
    // element path is exactly what it is with no crossfade set.
    expect(stub.created).toHaveLength(2);
    expect(stub.playback().src).toBe(track.src);
    expect(stub.playback().paused).toBe(false);
  });

  it("starts the next track silent on its own element and fades the two across on their volumes", () => {
    jest.useFakeTimers();
    const { stub, engine, incoming } = playing();

    expect(engine.crossfade(next, 2)).toBe(true);
    expect(incoming().src).toBe(next.src);
    expect(incoming().paused).toBe(false);
    expect(incoming().volume).toBe(0);

    jest.advanceTimersByTime(1000);
    expect(stub.playback().volume).toBeCloseTo(0.4, 1);
    expect(incoming().volume).toBeCloseTo(0.4, 1);

    jest.advanceTimersByTime(1000);
    expect(stub.playback().volume).toBe(0);
    expect(incoming().volume).toBeCloseTo(0.8, 5);

    jest.advanceTimersByTime(1000);
    expect(stub.playback().paused).toBe(true);
    expect(stub.playback().src).toBe("");
  });

  it("speaks for the incoming element alone from the crossfade on", () => {
    const { stub, engine, heard, incoming } = playing();
    engine.crossfade(next, 2);

    stub.playback().emit("ended");
    expect(heard.ended).not.toHaveBeenCalled();

    incoming().duration = 200;
    incoming().emit("durationchange");
    expect(heard.duration).toHaveBeenLastCalledWith(200);

    incoming().currentTime = 1.5;
    expect(engine.time).toBe(1.5);
  });

  it("lets the outgoing element go when it ends, and reuses it for the next crossfade", () => {
    const { stub, engine } = playing();
    engine.crossfade(next, 2);

    stub.playback().emit("ended");
    expect(stub.playback().paused).toBe(true);
    expect(stub.playback().src).toBe("");

    engine.crossfade(track, 2);
    expect(stub.created).toHaveLength(3);
    expect(stub.playback().src).toBe(track.src);
  });

  it("finishes a crossfade at once when the listener pauses, seeks or loads", () => {
    jest.useFakeTimers();
    for (const cut of [
      (engine: ReturnType<typeof engineWith>) => engine.pause(),
      (engine: ReturnType<typeof engineWith>) => engine.seek(30),
      (engine: ReturnType<typeof engineWith>) => engine.load(track),
    ]) {
      const { stub, engine, incoming } = playing();
      engine.crossfade(next, 4);
      jest.advanceTimersByTime(1000);

      cut(engine);
      jest.advanceTimersByTime(50);

      expect(stub.playback().paused).toBe(true);
      expect(stub.playback().src).toBe("");
      expect(incoming().volume).toBeCloseTo(0.8, 5);
    }
  });

  it("keeps the listener's volume changes on both elements through the fade", () => {
    jest.useFakeTimers();
    const { stub, engine, incoming } = playing({ volume: 1 });
    engine.crossfade(next, 2);
    jest.advanceTimersByTime(1000);

    engine.applyPrefs(prefs(0.5));

    expect(stub.playback().volume).toBeCloseTo(0.25, 1);
    expect(incoming().volume).toBeCloseTo(0.25, 1);
  });

  it("will not overlap a plain comparison", () => {
    const { stub, engine } = playing();
    engine.compare.start({ src: "https://example.test/b.mp3", assetId: 3 });

    expect(engine.crossfade(next, 2)).toBe(false);
    expect(stub.playback().src).toBe(track.src);
  });

  it("fades on the graph, routing the incoming element into it, once analysis has routed the playing one", async () => {
    const stub = stubTwoAudios({ pinVolume: true });
    const context = stubAudioContext({ startsRunning: true });
    const engine = engineWith(events);
    engine.load(track);
    engine.requestAnalysis(false);
    await settle();

    // iOS owns the element volume, but the graph is already engaged for
    // analysis, so the fade runs on the elements' own gains.
    expect(engine.crossfade(next, 2)).toBe(true);
    expect(context.only().routed).toEqual([stub.playback(), stub.created[2]!]);
  });
});

describe("createAudioEngine hand-over", () => {
  it("pauses at once on fade-out when nothing is routed, having no gain to ramp", () => {
    const stub = stubTwoAudios({ pinVolume: false });
    const engine = engineWith(events);
    engine.load(track);
    engine.play();

    engine.fadeOut(0.012);

    expect(stub.playback().paused).toBe(true);
    expect(engine.playing).toBe(false);
  });

  it("re-asserts its rate after a new source resets the element", () => {
    const stub = stubTwoAudios({ pinVolume: false });
    const engine = engineWith(events);
    engine.setRate(1.3);

    engine.load(track);
    stub.playback().playbackRate = 1;
    stub.playback().emit("loadedmetadata");

    expect(stub.playback().playbackRate).toBe(1.3);
  });
});
