import { describe, expect, it, mock } from "bun:test";
import type {
  AudioEngineEvents,
  CompareStatus,
  ElementEngine,
  LabStatus,
  PlaybackSource,
} from "@/components/music-player/player-engine";
import { createHybridEngine } from "./hybrid-engine";
import {
  LabUnavailable,
  type Handover,
  type LabEngine,
  type LabProgress,
} from "./lab-engine";
import { DEFAULT_LAB } from "./lab-settings";

const trackA = { src: "/media/a.wav", assetId: 1 };
const trackB = { src: "/media/b.wav", assetId: 2 };

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets pending promise callbacks run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function fakePlain() {
  const calls: string[] = [];
  /** What the element's own crossfade answers; iOS with nothing routed answers false. */
  const fades = { answer: true };
  let events!: AudioEngineEvents;
  const engine = {
    time: 0,
    // Widened: the mocks below drive it, so it cannot keep the literal `false`.
    playing: false as boolean,
    routed: false,
    analyser: null,
    volumeControllable: true,
    rate: 1,
    load: mock((source: PlaybackSource) => calls.push(`load ${source.src}`)),
    play: mock(() => {
      engine.playing = true;
      calls.push("play");
    }),
    pause: mock(() => {
      engine.playing = false;
      calls.push("pause");
    }),
    stop: mock(() => calls.push("stop")),
    seek: mock((seconds: number) => {
      engine.time = seconds;
      calls.push(`seek ${seconds}`);
    }),
    restart: mock(() => calls.push("restart")),
    applyPrefs: mock(() => {}),
    requestAnalysis: mock(() => {}),
    setRate: mock((rate: number) => {
      engine.rate = rate;
    }),
    fadeOut: mock(() => calls.push("fadeOut")),
    fadeIn: mock(() => calls.push("fadeIn")),
    compare: { start: mock(), align: mock(), route: mock(), end: mock() },
    crossfade: mock((next: PlaybackSource, seconds: number): boolean => {
      calls.push(`crossfade ${next.src} ${seconds}`);
      return fades.answer;
    }),
    prepareNext: mock(() => {}),
    destroy: mock(() => {}),
  } satisfies ElementEngine & { rate: number };
  return {
    engine,
    calls,
    fades,
    bind: (bound: AudioEngineEvents) => {
      events = bound;
      return engine;
    },
    events: () => events,
  };
}

function fakeLab() {
  let events!: AudioEngineEvents;
  let loading = deferred();
  const comparing = deferred();
  let preparing = deferred();
  /** The next source `loadNext` has finished, as the engine would hold it. */
  let held: PlaybackSource | null = null;
  const engine = {
    time: 0,
    // Widened: `start` and the play/pause mocks below drive it.
    playing: false as boolean,
    source: "original" as const,
    analyser: {} as AnalyserNode,
    started: null as Handover | null,
    load: mock(
      (
        _source: unknown,
        onProgress: (fraction: number, from: "original" | "copy") => void
      ) => {
        onProgress(0.5, "original");
        return loading.promise;
      }
    ),
    start: mock((at: Handover) => {
      engine.started = at;
      engine.time = at.position;
      engine.playing = at.playing;
    }),
    stop: mock(() => {
      engine.playing = false;
    }),
    play: mock(() => {
      engine.playing = true;
      events.play();
    }),
    pause: mock(() => {
      engine.playing = false;
      events.pause();
    }),
    seek: mock(),
    set: mock(),
    setEqCurve: mock(),
    applyPrefs: mock(),
    loadCompare: mock((_source: unknown, onProgress: LabProgress) => {
      onProgress(0.5, "original");
      return comparing.promise;
    }),
    alignCompare: mock(),
    routeCompare: mock(),
    unloadCompare: mock(),
    promoteCompare: mock(),
    loadNext: mock((source: PlaybackSource) => {
      held = null;
      return preparing.promise.then(() => {
        held = source;
      });
    }),
    unloadNext: mock(() => {
      held = null;
    }),
    crossfade: mock(() => {
      if (!held) return false;
      held = null;
      return true;
    }),
    destroy: mock(),
  } satisfies LabEngine & { started: Handover | null };
  return {
    engine,
    finishPreparing: async () => {
      preparing.resolve();
      await settle();
    },
    failPreparing: async (error: unknown) => {
      preparing.reject(error);
      await settle();
    },
    nextPrepare: () => {
      preparing = deferred();
    },
    bind: (bound: AudioEngineEvents) => {
      events = bound;
      return engine;
    },
    events: () => events,
    finishLoading: async () => {
      loading.resolve();
      await settle();
    },
    failLoading: async (error: unknown) => {
      loading.reject(error);
      await settle();
    },
    finishComparing: async () => {
      comparing.resolve();
      await settle();
    },
    failComparing: async (error: unknown) => {
      comparing.reject(error);
      await settle();
    },
    nextLoad: () => {
      loading = deferred();
    },
  };
}

function setup({ labFails }: { labFails?: boolean } = {}) {
  const plain = fakePlain();
  const lab = fakeLab();
  const statuses: LabStatus[] = [];
  const compares: CompareStatus[] = [];
  const events = {
    play: mock(),
    pause: mock(),
    ended: mock(),
    duration: mock(),
    error: mock(),
    analysis: mock(),
    labState: (status: LabStatus) => statuses.push(status),
    compareState: (status: CompareStatus) => compares.push(status),
  };
  const engine = createHybridEngine(events, {
    createPlain: plain.bind,
    createLab: async (labEvents) => {
      if (labFails) throw new LabUnavailable("This browser cannot run the Lab");
      return lab.bind(labEvents);
    },
  });
  return { engine, plain, lab, events, statuses, compares };
}

/** Loads track A, plays it on the element and engages the Lab to live. */
async function liveLab(position = 12) {
  const context = setup();
  context.engine.load(trackA);
  context.engine.play();
  context.engine.lab.engage();
  await settle();
  context.plain.engine.time = position;
  await context.lab.finishLoading();
  return context;
}

describe("createHybridEngine engagement", () => {
  it("starts the Lab from the element's position when the Lab is ready, not when engaging began", async () => {
    const { engine, plain, lab } = setup();
    engine.load(trackA);
    engine.play();
    plain.engine.time = 3;

    engine.lab.engage();
    await settle();
    plain.engine.time = 9; // the element kept playing through the download
    await lab.finishLoading();

    expect(lab.engine.started).toEqual({ position: 9, playing: true });
    expect(plain.calls.at(-1)).toBe("fadeOut");
    expect(engine.time).toBe(9);
  });

  it("carries a paused element over as a paused Lab", async () => {
    const { engine, plain, lab } = setup();
    engine.load(trackA);
    plain.engine.time = 4;

    engine.lab.engage();
    await lab.finishLoading();

    expect(lab.engine.started).toEqual({ position: 4, playing: false });
  });

  it("reports preparing progress and then live", async () => {
    const { engine, lab, statuses } = setup();
    engine.load(trackA);

    engine.lab.engage();
    await settle();
    await lab.finishLoading();

    expect(statuses).toEqual([
      { phase: "preparing", fraction: 0, source: "original" },
      { phase: "preparing", fraction: 0.5, source: "original" },
      { phase: "live", source: "original" },
    ]);
  });

  it("flips routed and the analyser when the Lab goes live", async () => {
    const { engine, lab, events } = setup();
    engine.load(trackA);
    expect(engine.routed).toBe(false);

    engine.lab.engage();
    await lab.finishLoading();

    expect(engine.routed).toBe(true);
    expect(engine.analyser).toBe(lab.engine.analyser);
    expect(events.analysis).toHaveBeenCalled();
  });

  it("drives the Lab's transport while live and the element's otherwise", async () => {
    const { engine, plain, lab } = await liveLab();
    plain.calls.length = 0;

    engine.pause();
    engine.seek(30);

    expect(lab.engine.pause).toHaveBeenCalled();
    expect(lab.engine.seek).toHaveBeenCalledWith(30);
    expect(plain.calls).toEqual([]);
  });
});

describe("createHybridEngine events", () => {
  it("drops the element's pause as it fades out under the Lab", async () => {
    const { plain, events } = await liveLab();

    plain.events().pause();
    plain.events().ended();

    expect(events.pause).not.toHaveBeenCalled();
    expect(events.ended).not.toHaveBeenCalled();
  });

  it("drops the Lab's events while it is not live", async () => {
    const { engine, lab, events } = setup();
    engine.load(trackA);
    engine.lab.engage();
    await settle();

    lab.events().play();
    lab.events().duration(200);

    expect(events.play).not.toHaveBeenCalled();
    expect(events.duration).not.toHaveBeenCalled();
  });

  it("forwards the live Lab's events", async () => {
    const { lab, events } = await liveLab();

    lab.events().ended();

    expect(events.ended).toHaveBeenCalledTimes(1);
  });

  it("forwards the element's load error while the element is live", () => {
    const { plain, events } = setup();

    plain.events().error(1, "Format error");

    expect(events.error).toHaveBeenCalledWith(1, "Format error");
  });

  it("drops the element's load error while the Lab is live", async () => {
    const { plain, events } = await liveLab();

    plain.events().error(1, "Format error");

    expect(events.error).not.toHaveBeenCalled();
  });
});

describe("createHybridEngine release", () => {
  it("seeks the element to the Lab's position and plays it when the Lab was playing", async () => {
    const { engine, plain, lab, events, statuses } = await liveLab();
    lab.engine.time = 20;
    plain.calls.length = 0;

    engine.lab.release();

    expect(plain.calls).toEqual(["seek 20", "play", "fadeIn"]);
    expect(lab.engine.stop).toHaveBeenCalled();
    expect(engine.routed).toBe(false);
    expect(engine.time).toBe(20);
    expect(statuses.at(-1)).toEqual({ phase: "off" });
    // The Lab's own pause as it stops is not the listener pausing.
    lab.events().pause();
    expect(events.pause).not.toHaveBeenCalled();
  });

  it("leaves the element paused when the Lab was paused", async () => {
    const { engine, plain, lab } = await liveLab();
    engine.pause();
    lab.engine.time = 20;
    plain.calls.length = 0;

    engine.lab.release();

    expect(plain.calls).toEqual(["seek 20", "fadeIn"]);
  });

  it("cancels a Lab still preparing without handing anything over", async () => {
    const { engine, plain, lab, statuses } = setup();
    engine.load(trackA);
    engine.lab.engage();
    await settle();

    engine.lab.release();
    await lab.finishLoading();

    expect(lab.engine.start).not.toHaveBeenCalled();
    expect(plain.calls).not.toContain("fadeOut");
    expect(statuses.at(-1)).toEqual({ phase: "off" });
  });
});

describe("createHybridEngine track changes", () => {
  it("falls back to the element for a new track and re-engages while the Lab is wanted", async () => {
    const { engine, plain, lab } = await liveLab();
    lab.nextLoad();
    plain.calls.length = 0;

    engine.load(trackB);
    await settle();

    expect(engine.routed).toBe(false);
    expect(plain.calls).toEqual(["fadeIn", "load /media/b.wav"]);
    expect(lab.engine.load).toHaveBeenLastCalledWith(
      trackB,
      expect.any(Function),
      expect.any(AbortSignal)
    );

    engine.play();
    plain.engine.time = 1;
    await lab.finishLoading();

    expect(lab.engine.started).toEqual({ position: 1, playing: true });
    expect(engine.routed).toBe(true);
  });

  it("stays on the element for a new track once released", async () => {
    const { engine, lab } = await liveLab();
    engine.lab.release();
    lab.engine.load.mockClear();

    engine.load(trackB);
    await settle();

    expect(lab.engine.load).not.toHaveBeenCalled();
  });
});

describe("createHybridEngine unavailable", () => {
  it("reports unavailable and leaves plain playback untouched when the Lab cannot load", async () => {
    const { engine, plain, lab, statuses } = setup();
    engine.load(trackA);
    engine.play();
    engine.lab.engage();
    await settle();

    await lab.failLoading(
      new LabUnavailable("This format cannot be decoded here")
    );

    expect(statuses.at(-1)).toEqual({
      phase: "unavailable",
      reason: "This format cannot be decoded here",
    });
    expect(plain.calls).toEqual(["load /media/a.wav", "play"]);
    expect(engine.routed).toBe(false);
  });

  it("does not retry the same source on the next settings change", async () => {
    const { engine, lab } = setup();
    engine.load(trackA);
    engine.lab.engage();
    await settle();
    await lab.failLoading(new LabUnavailable("nope"));

    engine.lab.engage();
    await settle();

    expect(lab.engine.load).toHaveBeenCalledTimes(1);
  });

  it("reports unavailable when the Lab cannot be created at all", async () => {
    const { engine, statuses } = setup({ labFails: true });
    engine.load(trackA);

    engine.lab.engage();
    await settle();

    expect(statuses.at(-1)).toEqual({
      phase: "unavailable",
      reason: "This browser cannot run the Lab",
    });
  });
});

describe("createHybridEngine settings", () => {
  it("gives the element the linked speed and the Lab every setting", async () => {
    const { engine, plain, lab } = await liveLab();
    const settings = { ...DEFAULT_LAB, mode: "linked" as const, speed: 1.3 };

    const loudness = { lufs: -10, targetLufs: -14 };

    engine.lab.set(settings, loudness);

    expect(plain.engine.rate).toBe(1.3);
    expect(lab.engine.set).toHaveBeenLastCalledWith(settings, loudness);
  });
});

describe("createHybridEngine comparison", () => {
  it("prepares B beside a preparing Lab, reporting the mean of both downloads, and is ready once both play on it", async () => {
    const { engine, plain, lab, compares } = setup();
    engine.load(trackA);
    engine.play();
    engine.lab.engage();
    engine.lab.compare.start(trackB);
    await settle();

    expect(lab.engine.loadCompare.mock.calls[0]![0]).toEqual(trackB);
    // The Lab's own download reported 0.5, and so did B's.
    expect(compares.at(-1)).toEqual({ phase: "preparing", fraction: 0.5 });

    await lab.finishComparing();
    expect(compares.at(-1)?.phase).toBe("preparing");

    plain.engine.time = 4;
    await lab.finishLoading();
    expect(compares.at(-1)).toEqual({ phase: "ready" });
  });

  it("hands B the offset and route it was given before it loaded", async () => {
    const { engine, lab } = await liveLab();
    engine.lab.compare.start(trackB);
    engine.lab.compare.align(1.5);
    engine.lab.compare.route("a", { a: 0.7, b: 1 });
    expect(lab.engine.alignCompare).not.toHaveBeenCalled();

    await lab.finishComparing();

    expect(lab.engine.alignCompare).toHaveBeenLastCalledWith(1.5);
    expect(lab.engine.routeCompare).toHaveBeenLastCalledWith("a", {
      a: 0.7,
      b: 1,
    });

    engine.lab.compare.route("b", { a: 0.7, b: 1 });
    expect(lab.engine.routeCompare).toHaveBeenLastCalledWith("b", {
      a: 0.7,
      b: 1,
    });
  });

  it("reports unavailable when B cannot be held", async () => {
    const { engine, lab, compares } = await liveLab();
    engine.lab.compare.start(trackB);

    await lab.failComparing(new LabUnavailable("No memory here"));

    expect(compares.at(-1)).toEqual({
      phase: "unavailable",
      reason: "No memory here",
    });
  });

  it("reports unavailable at once, without loading B, when the Lab already failed on the playing source", async () => {
    const { engine, lab, compares } = setup();
    engine.load(trackA);
    engine.lab.engage();
    await settle();
    await lab.failLoading(
      new LabUnavailable("This format cannot be decoded here")
    );

    engine.lab.engage();
    engine.lab.compare.start(trackB);
    await settle();

    expect(compares.at(-1)).toEqual({
      phase: "unavailable",
      reason: "This format cannot be decoded here",
    });
    expect(lab.engine.loadCompare).not.toHaveBeenCalled();
  });

  it("ends on A by dropping B", async () => {
    const { engine, lab } = await liveLab();
    engine.lab.compare.start(trackB);
    await lab.finishComparing();

    engine.lab.compare.end("a");

    expect(lab.engine.unloadCompare).toHaveBeenCalledTimes(1);
    expect(lab.engine.promoteCompare).not.toHaveBeenCalled();
  });

  it("ends on B by promoting it on the Lab and loading it on the element for a later release", async () => {
    const { engine, plain, lab } = await liveLab(12);
    engine.lab.compare.start(trackB);
    await lab.finishComparing();

    engine.lab.compare.end("b");

    expect(lab.engine.promoteCompare).toHaveBeenCalledTimes(1);
    expect(plain.calls.at(-1)).toBe(`load ${trackB.src}`);

    lab.engine.time = 20;
    engine.lab.release();
    expect(plain.calls.slice(-3)).toEqual(["seek 20", "play", "fadeIn"]);
  });

  it("drops the comparison when a new track loads", async () => {
    const { engine, lab } = await liveLab();
    engine.lab.compare.start(trackB);
    await lab.finishComparing();

    engine.load({ src: "/media/c.wav", assetId: 3 });

    expect(lab.engine.unloadCompare).toHaveBeenCalledTimes(1);
  });
});

describe("createHybridEngine crossfade", () => {
  const trackC = { src: "/media/c.wav", assetId: 3 };

  it("overlaps on the element while the Lab is off", () => {
    const { engine, plain } = setup();
    engine.load(trackA);
    engine.play();

    expect(engine.crossfade(trackB, 3)).toBe(true);

    expect(plain.calls.at(-1)).toBe(`crossfade ${trackB.src} 3`);
  });

  it("refuses, changing nothing, where the element cannot overlap", () => {
    const { engine, plain, lab } = setup();
    plain.fades.answer = false;
    engine.load(trackA);

    expect(engine.crossfade(trackB, 3)).toBe(false);

    engine.lab.engage();
    expect(lab.engine.load).not.toHaveBeenCalled();
    expect(plain.calls).not.toContain(`load ${trackB.src}`);
  });

  it("prepares nothing on the element, and nothing on the Lab until it plays", async () => {
    const { engine, lab } = setup();
    engine.load(trackA);
    engine.prepareNext(trackB);
    expect(lab.engine.loadNext).not.toHaveBeenCalled();

    engine.lab.engage();
    await lab.finishLoading();

    expect(lab.engine.loadNext).toHaveBeenCalledTimes(1);
    expect(lab.engine.loadNext.mock.calls[0]![0]).toEqual(trackB);
  });

  it("crossfades inside the live Lab once the next track is decoded, and primes the element for a release", async () => {
    const { engine, plain, lab } = await liveLab();
    engine.prepareNext(trackB);

    expect(engine.crossfade(trackB, 3)).toBe(false);
    expect(lab.engine.crossfade).not.toHaveBeenCalled();

    await lab.finishPreparing();
    expect(engine.crossfade(trackB, 3)).toBe(true);

    expect(lab.engine.crossfade).toHaveBeenCalledWith(3);
    expect(plain.calls.at(-1)).toBe(`load ${trackB.src}`);
    expect(plain.calls).not.toContain(`crossfade ${trackB.src} 3`);

    lab.engine.time = 5;
    engine.lab.release();
    expect(plain.calls.slice(-3)).toEqual(["seek 5", "play", "fadeIn"]);
  });

  it("refuses a Lab crossfade to anything but the track it prepared", async () => {
    const { engine, lab } = await liveLab();
    engine.prepareNext(trackB);
    await lab.finishPreparing();

    expect(engine.crossfade(trackC, 3)).toBe(false);
    expect(lab.engine.crossfade).not.toHaveBeenCalled();
  });

  it("drops the prepared track for a comparison, a release or a new next", async () => {
    const { engine, lab } = await liveLab();
    engine.prepareNext(trackB);
    await lab.finishPreparing();

    engine.lab.compare.start(trackC);
    expect(lab.engine.unloadNext).toHaveBeenCalledTimes(1);
    expect(engine.crossfade(trackB, 3)).toBe(false);

    engine.lab.compare.end("a");
    lab.nextPrepare();
    expect(lab.engine.loadNext).toHaveBeenCalledTimes(2);

    engine.prepareNext(trackC);
    expect(lab.engine.unloadNext).toHaveBeenCalledTimes(2);

    engine.lab.release();
    expect(lab.engine.unloadNext).toHaveBeenCalledTimes(3);
  });

  it("starts the Lab again on the incoming track when an element crossfade interrupts its preparation", async () => {
    const { engine, lab } = setup();
    engine.load(trackA);
    engine.play();
    engine.lab.engage();
    await settle();
    lab.nextLoad();

    expect(engine.crossfade(trackB, 3)).toBe(true);
    await settle();

    expect(lab.engine.load).toHaveBeenCalledTimes(2);
    expect(lab.engine.load.mock.calls[1]![0]).toEqual(trackB);
  });
});
