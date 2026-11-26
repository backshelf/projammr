import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
  mock,
} from "bun:test";
import { stubGlobal, unstubAllGlobals } from "@workspace/test/globals";
import { waitFor } from "@workspace/test/wait-for";
import { DEFAULT_LAB } from "@/lib/dsp/lab-settings";
import { DEFAULT_LAB_POLICY } from "@/lib/policies/lab";
import { DEFAULT_PLAYBACK } from "@/lib/policies/playback";
import { mediaProxyUrl } from "@/lib/utils";
import { DEFAULT_PLAYER_INITIAL, playerInitial } from "./player-initial";
import type { StoredQueueEntry } from "./player-storage";
import type { PlayerStoreOptions } from "./player-store";
import type { PlaybackPolicy } from "@/lib/policies/playback";
import type { AudioEngine, AudioEngineEvents } from "./player-engine";
import type { BounceDeps } from "@/lib/dsp/bounce";
import type { MusicPlayerTrack } from "./types";
import type { TrackAudioDiff } from "@workspace/api/api";

// A complete stand-in, not just `getMusicPlayerMetadata`: `bun test --parallel`
// shares one module registry across files, and `action-context.test.ts` mocks
// this same module with its own shape. Whichever mock wins the race, every
// export the real module has needs to exist here too, or the loser's import
// of a name this file left out throws.
mock.module("@/actions/tracks", () => ({
  getTracksForCollection: mock(),
  getTracksPageForProject: mock(),
  getTrack: mock(),
  createTrack: mock(),
  updateTrackNumber: mock(),
  getTrackSummaries: mock(),
  getTrackLabels: mock(),
}));

mock.module("@/actions/player-metadata", () => ({
  getMusicPlayerMetadata: mock(),
}));

const { createPlayerStore, matchGains } = await import("./player-store");

const RELEASE_DELAY_MS = DEFAULT_LAB_POLICY.releaseDelayMs;

/** What `normalise` reads for a version of `lufs`, at the default target. */
const loudness = (lufs: number | null) => ({
  lufs,
  targetLufs: DEFAULT_LAB_POLICY.normaliseTargetLufs,
});
const { silentEngine } = await import("./player-engine");

type Handler = () => void;

/** The parts of `HTMLAudioElement` the engine drives, with its events exposed. */
class FakeAudio {
  private handlers = new Map<string, Set<Handler>>();
  bound = false;
  volume = 1;
  muted = false;
  playbackRate = 1;
  preservesPitch = false;
  currentTime = 0;
  duration = 0;
  paused = true;
  src = "";

  addEventListener(type: string, handler: Handler) {
    this.bound = true;
    const forType = this.handlers.get(type) ?? new Set<Handler>();
    forType.add(handler);
    this.handlers.set(type, forType);
  }
  removeEventListener(type: string, handler: Handler) {
    this.handlers.get(type)?.delete(handler);
  }
  removeAttribute() {
    this.src = "";
  }
  load() {}
  pause() {}
  play() {
    return Promise.resolve();
  }

  emit(type: string) {
    this.handlers.get(type)?.forEach((handler) => handler());
  }
}

const created: FakeAudio[] = [];

class AudioStub extends FakeAudio {
  constructor() {
    super();
    created.push(this);
  }
}

/**
 * The engine's playback element. It is the only one the engine listens to —
 * it also builds a throwaway element to probe whether volume is controllable.
 */
const audio = () => created.find((element) => element.bound)!;

const setPositionState = mock();

/** A match-EQ reference to a version of `track`, as the Lab stores one. */
const reference = (audioId: number) => ({
  audioId,
  ownerType: "track" as const,
  ownerId: 1,
});

const track: MusicPlayerTrack = {
  ownerType: "track",
  ownerId: 1,
  metadataResolved: true,
  asset: {
    id: 7,
    name: "take.wav",
    assetPath: "./static/assets/take.wav",
  },
};

const trackB: MusicPlayerTrack = {
  ...track,
  asset: { ...track.asset, id: 8, name: "take-b.wav" },
};

const trackNext: MusicPlayerTrack = {
  ...track,
  asset: { ...track.asset, id: 9, name: "next.wav" },
};

/** Loads the track and reports its duration, as an element would. */
function playing(duration: number) {
  const store = createPlayerStore();
  store.actions.playNow([track]);
  audio().duration = duration;
  audio().emit("durationchange");
  setPositionState.mockClear();
  return store;
}

beforeEach(() => {
  created.length = 0;
  stubGlobal("window", globalThis);
  stubGlobal("Audio", AudioStub);
  stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => {},
  });
  stubGlobal("MediaMetadata", class {});
  stubGlobal("navigator", {
    mediaSession: {
      setPositionState,
      setActionHandler: mock(),
      metadata: null,
      playbackState: "none",
    },
  });
});

afterEach(() => {
  unstubAllGlobals();
  setPositionState.mockClear();
});

describe("media session position state", () => {
  it("reports the seeked position against the duration and rate", () => {
    const store = playing(180);

    store.actions.seek(30);

    expect(setPositionState).toHaveBeenCalledWith({
      duration: 180,
      playbackRate: 1,
      position: 30,
    });
  });

  it("follows the playback speed", () => {
    const store = playing(180);

    store.actions.setSpeed(1.5);

    expect(setPositionState).toHaveBeenLastCalledWith({
      duration: 180,
      playbackRate: 1.5,
      position: 0,
    });
  });

  it("clears the position state when the queue empties", () => {
    const store = playing(180);

    store.actions.clear();

    expect(setPositionState).toHaveBeenLastCalledWith();
  });
});

describe("playAt", () => {
  /** A track whose source differs from `track`'s, so playing it reloads. */
  const other: MusicPlayerTrack = {
    ...track,
    asset: { ...track.asset, id: 21, assetPath: "./static/assets/other.wav" },
  };

  /** One of a queue of distinct tracks, each with a source of its own. */
  const numbered = (id: number): MusicPlayerTrack => ({
    ...track,
    asset: { ...track.asset, id, assetPath: `./static/assets/take-${id}.wav` },
  });

  it("seeks at once when the item is already loaded", () => {
    const store = playing(120);
    const elements = created.length;

    store.actions.playAt(track, 30);

    expect(audio().currentTime).toBe(30);
    expect(created.length).toBe(elements);
    // A reload would have zeroed the duration on its way through the load.
    expect(store.getSnapshot().duration).toBe(120);
  });

  it("plays a loaded item that is paused, from the position", () => {
    const store = playing(120);
    const play = mock(() => Promise.resolve());
    audio().play = play;

    store.actions.playAt(track, 30);

    expect(audio().currentTime).toBe(30);
    expect(play).toHaveBeenCalled();
  });

  it("carries the position through a load that is still in flight", () => {
    const store = createPlayerStore();
    store.actions.playNow([track]);

    store.actions.playAt(track, 30);
    audio().duration = 120;
    audio().emit("durationchange");

    expect(audio().currentTime).toBe(30);
  });

  it("seeks to the start when the position is past the end", () => {
    const store = playing(120);
    store.actions.seek(30);

    store.actions.playAt(track, 300);

    expect(audio().currentTime).toBe(0);
  });

  it("keeps the queue when the item is the current one", () => {
    const items = [1, 2, 3, 4, 5].map(numbered);
    const store = createPlayerStore();
    store.actions.playNow(items);
    audio().duration = 120;
    audio().emit("durationchange");

    store.actions.playAt(items[0]!, 30);

    expect(store.getSnapshot().upcoming).toHaveLength(4);
    expect(audio().currentTime).toBe(30);
  });

  it("replaces the queue for another item and seeks once its duration arrives", () => {
    const store = playing(120);
    store.actions.enqueue([numbered(31)]);

    store.actions.playAt(other, 45);
    expect(store.getSnapshot().current?.asset.id).toBe(other.asset.id);
    expect(store.getSnapshot().upcoming).toHaveLength(0);
    expect(audio().currentTime).toBe(0);

    audio().duration = 200;
    audio().emit("durationchange");
    expect(audio().currentTime).toBe(45);
  });

  it("keeps a position waiting on a load in flight when the queue changes", () => {
    const store = createPlayerStore();
    store.actions.playAt(track, 30);

    store.actions.enqueue([other]);
    audio().duration = 120;
    audio().emit("durationchange");

    expect(audio().currentTime).toBe(30);
  });

  it("does not seek the next track with a position left by a load that never finished", () => {
    const store = createPlayerStore();
    store.actions.playAt(track, 30);

    store.actions.playNow([other]);
    audio().duration = 200;
    audio().emit("durationchange");

    expect(audio().currentTime).toBe(0);
    expect(store.getSnapshot().current?.asset.id).toBe(other.asset.id);
  });
});

/** A stand-in engine whose Lab controls record what the store asks of them. */
function fakeEngine({
  fetchDiff = async () => null,
  ...options
}: {
  fetchDiff?: (id: number, otherId: number) => Promise<TrackAudioDiff | null>;
} & Pick<
  PlayerStoreOptions,
  "initial" | "persist" | "resolveQueue" | "resolveProjectTarget"
> = {}) {
  let events!: AudioEngineEvents;
  const lab = {
    engage: mock(),
    release: mock(),
    set: mock(),
    setEqCurve: mock(),
    curve: null,
    compare: { start: mock(), align: mock(), route: mock(), end: mock() },
  };
  /** The elements' own comparison, no Web Audio: a coarse pointer's path. */
  const compare = { start: mock(), align: mock(), route: mock(), end: mock() };
  const engine = {
    ...silentEngine,
    lab,
    compare,
    load: mock<AudioEngine["load"]>(() => {}),
    play: mock(() => {}),
    pause: mock(() => {}),
    restart: mock(() => {}),
    seek: mock<(seconds: number) => void>(() => {}),
    requestAnalysis: mock<AudioEngine["requestAnalysis"]>(() => {}),
    crossfade: mock<AudioEngine["crossfade"]>(() => true),
    prepareNext: mock<AudioEngine["prepareNext"]>(() => {}),
    time: 0,
  } satisfies AudioEngine;
  const store = createPlayerStore({
    createEngine: (bound) => {
      events = bound;
      return engine;
    },
    fetchDiff,
    ...options,
  });
  return { store, lab, compare, engine, events: () => events };
}

/** Stored blobs, as `localStorage` would hand them back. */
function storedSettings(entries: Record<string, unknown>) {
  stubGlobal("localStorage", {
    getItem: (key: string) =>
      key in entries ? JSON.stringify(entries[key]) : null,
    setItem: () => {},
  });
}

describe("Lab engagement", () => {
  afterEach(() => jest.useRealTimers());

  it("engages for an audition and releases two seconds after it clears", () => {
    jest.useFakeTimers();
    const { store, lab } = fakeEngine();

    store.actions.setAudition({ stereo: "mono" });
    expect(lab.engage).toHaveBeenCalledTimes(1);

    store.actions.setAudition({ stereo: "stereo" });
    jest.advanceTimersByTime(RELEASE_DELAY_MS - 1);
    expect(lab.release).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(lab.release).toHaveBeenCalledTimes(1);
  });

  it("stays engaged when a setting comes back on within the release delay", () => {
    jest.useFakeTimers();
    const { store, lab } = fakeEngine();

    store.actions.setAudition({ dim: true });
    store.actions.setAudition({ dim: false });
    jest.advanceTimersByTime(RELEASE_DELAY_MS / 2);
    store.actions.setAudition({ dim: true });
    jest.advanceTimersByTime(RELEASE_DELAY_MS * 2);

    expect(lab.release).not.toHaveBeenCalled();
  });

  it("engages while pinned with every setting at its default", () => {
    const { store, lab } = fakeEngine();

    store.actions.pinLab(true);

    expect(lab.engage).toHaveBeenCalled();
    expect(store.getSnapshot().lab.pinned).toBe(true);
  });

  it("engages for speed with pitch held and for a pitch shift", () => {
    const { store, lab } = fakeEngine();

    store.actions.setSpeed(0.8);
    expect(lab.engage).toHaveBeenCalledTimes(1);

    store.actions.setSpeed(1);
    store.actions.setLabMode("pitch");
    lab.engage.mockClear();
    store.actions.setPitch(2);
    expect(lab.engage).toHaveBeenCalledTimes(1);
  });

  it("keeps linked speed on the element without engaging", () => {
    const { store, lab } = fakeEngine();

    store.actions.setLabMode("linked");
    store.actions.setSpeed(1.4);

    expect(lab.engage).not.toHaveBeenCalled();
    expect(lab.set).toHaveBeenLastCalledWith(
      { ...DEFAULT_LAB, mode: "linked", speed: 1.4 },
      loudness(null)
    );
  });

  it("engages for a comparison and releases two seconds after it ends", () => {
    jest.useFakeTimers();
    const { store, lab } = fakeEngine();
    store.actions.playNow([track]);

    store.actions.startCompare(trackB);
    expect(lab.engage).toHaveBeenCalledTimes(1);

    store.actions.endCompare();
    jest.advanceTimersByTime(RELEASE_DELAY_MS - 1);
    expect(lab.release).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(lab.release).toHaveBeenCalledTimes(1);
  });

  it("carries the engine's lab status into the snapshot", () => {
    const { store, events } = fakeEngine();

    events().labState?.({
      phase: "preparing",
      fraction: 0.421,
      source: "copy",
    });
    expect(store.getSnapshot().lab).toMatchObject({
      phase: "preparing",
      fraction: 0.42,
      source: "copy",
    });

    events().labState?.({ phase: "unavailable", reason: "Too large" });
    expect(store.getSnapshot().lab).toMatchObject({
      phase: "unavailable",
      reason: "Too large",
    });
  });

  it("passes the version's stored loudness to the Lab", () => {
    const { store, lab } = fakeEngine();

    store.actions.playNow([
      {
        ...track,
        trackAudio: { id: 1, version: 1, isPrimary: true, lufs: -9 },
      },
    ]);

    expect(lab.set).toHaveBeenLastCalledWith(DEFAULT_LAB, loudness(-9));
  });

  it("starts with no bounce in progress and does not engage the Lab without a track", () => {
    const { store, lab } = fakeEngine();

    expect(store.getSnapshot().bounce).toBeNull();

    store.actions.bounce();

    expect(store.getSnapshot().bounce).toBeNull();
    expect(lab.engage).not.toHaveBeenCalled();
  });
});

describe("match-EQ staleness", () => {
  it("clears a persisted reference once the queue moves to a different track", () => {
    const { store, lab } = fakeEngine();
    store.actions.playNow([track]);
    store.actions.setAudition({ matchEq: reference(42) });
    lab.setEqCurve.mockClear();

    store.actions.playNow([
      {
        ...track,
        ownerId: 2,
        asset: {
          ...track.asset,
          id: 20,
          assetPath: "./static/assets/other.wav",
        },
      },
    ]);

    expect(store.getSnapshot().lab.settings.auditions.matchEq).toBeNull();
    expect(lab.setEqCurve).toHaveBeenCalledWith(null);
  });

  it("clears a persisted reference once its own version starts playing", () => {
    const { store, lab } = fakeEngine();
    const v1: MusicPlayerTrack = {
      ...track,
      trackAudio: { id: 10, version: 1, isPrimary: true },
    };
    const v2: MusicPlayerTrack = {
      ...track,
      asset: { ...track.asset, id: 30, assetPath: "./static/assets/v2.wav" },
      trackAudio: { id: 11, version: 2, isPrimary: false },
    };
    store.actions.playNow([v1]);
    store.actions.setAudition({ matchEq: reference(11) });
    lab.setEqCurve.mockClear();

    store.actions.playNow([v2]);

    expect(store.getSnapshot().lab.settings.auditions.matchEq).toBeNull();
    expect(lab.setEqCurve).toHaveBeenCalledWith(null);
  });

  it("survives a version switch that does not touch the reference", () => {
    const { store, lab } = fakeEngine();
    const v1: MusicPlayerTrack = {
      ...track,
      trackAudio: { id: 10, version: 1, isPrimary: true },
    };
    const v2: MusicPlayerTrack = {
      ...track,
      asset: { ...track.asset, id: 30, assetPath: "./static/assets/v2.wav" },
      trackAudio: { id: 12, version: 2, isPrimary: false },
    };
    store.actions.playNow([v1]);
    store.actions.setAudition({ matchEq: reference(99) });
    lab.setEqCurve.mockClear();

    store.actions.playNow([v2]);

    expect(store.getSnapshot().lab.settings.auditions.matchEq).toEqual(
      reference(99)
    );
    expect(lab.setEqCurve).not.toHaveBeenCalled();
  });

  it("clears a reference when a different track plays after the queue was cleared", () => {
    const { store, lab } = fakeEngine();
    store.actions.playNow([track]);
    store.actions.setAudition({ matchEq: reference(42) });
    store.actions.clear();
    lab.setEqCurve.mockClear();

    store.actions.playNow([
      {
        ...track,
        ownerId: 2,
        asset: {
          ...track.asset,
          id: 20,
          assetPath: "./static/assets/other.wav",
        },
      },
    ]);

    expect(store.getSnapshot().lab.settings.auditions.matchEq).toBeNull();
    expect(lab.setEqCurve).toHaveBeenCalledWith(null);
  });

  it("clears a restored reference when the first track after a reload is a different one", () => {
    storedSettings({
      music_player_lab: {
        auditions: { matchEq: { audioId: 42, ownerType: "track", ownerId: 1 } },
      },
    });
    const { store } = fakeEngine();

    store.actions.playNow([{ ...track, ownerId: 2 }]);

    expect(store.getSnapshot().lab.settings.auditions.matchEq).toBeNull();
  });
});

describe("stored Lab settings", () => {
  it("drops a stored match-EQ reference that does not name its track", () => {
    storedSettings({ music_player_lab: { auditions: { matchEq: 42 } } });

    const store = createPlayerStore();

    expect(store.getSnapshot().lab.settings.auditions.matchEq).toBeNull();
  });

  it("reads a saved rate as linked speed, played by the element", () => {
    storedSettings({ music_player_prefs: { rate: 1.25 } });

    const store = createPlayerStore();
    store.actions.playNow([track]);
    audio().emit("loadedmetadata");

    expect(store.getSnapshot().lab.settings).toMatchObject({
      mode: "linked",
      speed: 1.25,
    });
    expect(audio().playbackRate).toBe(1.25);
  });

  it("starts with the dangerous auditions reset", () => {
    storedSettings({
      music_player_lab: {
        ...DEFAULT_LAB,
        auditions: { ...DEFAULT_LAB.auditions, stereo: "side", dim: true },
      },
    });

    const store = createPlayerStore();

    expect(store.getSnapshot().lab.settings.auditions).toEqual(
      DEFAULT_LAB.auditions
    );
  });
});

describe("initial", () => {
  /** A shell whose policies differ from the defaults everywhere the store starts. */
  const seeded = playerInitial({
    playback: {
      ...DEFAULT_PLAYBACK,
      defaultVolume: 0.5,
      startMuted: true,
      repeat: "all",
    },
    lab: {
      ...DEFAULT_LAB_POLICY,
      timePitchMode: "linked",
      compressor: { ...DEFAULT_LAB.rack.comp, ratio: 8 },
    },
  });

  it("hydrates a browser with nothing stored into the snapshot it settles on", () => {
    for (const initial of [DEFAULT_PLAYER_INITIAL, seeded]) {
      const store = createPlayerStore({ initial });

      expect(store.getServerSnapshot()).toEqual(store.getSnapshot());
    }
  });

  it("builds each store's server snapshot from its own initial", () => {
    const store = createPlayerStore({ initial: seeded });
    const plain = createPlayerStore();

    expect(store.getServerSnapshot().prefs).toEqual(seeded.prefs);
    expect(store.getServerSnapshot().lab.settings).toEqual(seeded.lab);
    expect(plain.getServerSnapshot().prefs).toEqual(
      DEFAULT_PLAYER_INITIAL.prefs
    );
  });

  it("starts a browser with nothing stored from initial's prefs and Lab settings", () => {
    const store = createPlayerStore({ initial: seeded });

    expect(store.getSnapshot().prefs).toEqual({
      volume: 0.5,
      muted: true,
      repeat: "all",
      shuffle: false,
    });
    expect(store.getSnapshot().lab.settings.mode).toBe("linked");
    expect(store.getSnapshot().lab.settings.rack.comp.ratio).toBe(8);
    expect(audio().volume).toBe(0.5);
    expect(audio().muted).toBe(true);
  });

  it("lets a nudged browser's volume, mute and Lab state win over initial", () => {
    storedSettings({
      music_player_prefs: { volume: 0.3, muted: false },
      music_player_lab: { mode: "speed", speed: 1.2 },
    });

    const store = createPlayerStore({ initial: seeded });

    expect(store.getSnapshot().prefs).toEqual({
      volume: 0.3,
      muted: false,
      repeat: "all",
      shuffle: false,
    });
    expect(store.getSnapshot().lab.settings).toMatchObject({
      mode: "speed",
      speed: 1.2,
    });
    // Never stored, so initial's.
    expect(store.getSnapshot().lab.settings.rack.comp.ratio).toBe(8);
  });

  it("reads and writes the storage it is handed, and nothing without one", () => {
    jest.useFakeTimers();
    try {
      const data = new Map<string, string>([
        ["music_player_prefs", JSON.stringify({ volume: 0.25 })],
      ]);
      const persist = {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => void data.set(key, value),
        removeItem: (key: string) => void data.delete(key),
      };

      const store = createPlayerStore({ persist });
      expect(store.getSnapshot().prefs.volume).toBe(0.25);
      store.actions.setVolume(0.75);
      jest.advanceTimersByTime(1000);
      expect(JSON.parse(data.get("music_player_prefs")!)).toMatchObject({
        volume: 0.75,
      });

      const unkept = createPlayerStore({ initial: seeded, persist: null });
      expect(unkept.getSnapshot().prefs).toEqual(seeded.prefs);
    } finally {
      jest.useRealTimers();
    }
  });

  it("resets the Lab to the policy's starting settings", () => {
    const store = createPlayerStore({ initial: seeded });
    store.actions.setSpeed(1.3);

    store.actions.resetLab();

    expect(store.getSnapshot().lab.settings).toEqual(seeded.lab);
  });
});

/** The default initial with `patch` over the playback policy. */
const withPlayback = (patch: Partial<PlaybackPolicy>) =>
  playerInitial({
    playback: { ...DEFAULT_PLAYBACK, ...patch },
    lab: DEFAULT_LAB_POLICY,
  });

/** One of a queue of distinct tracks, each with a source of its own. */
const numbered = (id: number): MusicPlayerTrack => ({
  ...track,
  asset: { ...track.asset, id, assetPath: `./static/assets/take-${id}.wav` },
});

describe("playback policy", () => {
  const [first, second] = [numbered(1), numbered(2)];
  const srcOf = (item: MusicPlayerTrack) => mediaProxyUrl(item.asset.assetPath);

  it("restarts the track past the policy's window and goes back inside it", () => {
    const { store, engine } = fakeEngine();
    store.actions.playNow([first, second], 1);

    engine.time = 3.5;
    store.actions.prev();
    expect(engine.restart).toHaveBeenCalledTimes(1);

    engine.time = 2;
    store.actions.prev();
    expect(store.getSnapshot().current).toBe(first);
  });

  it("follows a changed restart window without a reload", () => {
    const { store, engine } = fakeEngine();
    store.actions.playNow([first, second], 1);
    store.setPolicy({
      playback: { ...DEFAULT_PLAYBACK, previousRestartsAfterSeconds: 10 },
      lab: DEFAULT_LAB_POLICY,
    });

    engine.time = 6;
    store.actions.prev();

    expect(engine.restart).not.toHaveBeenCalled();
    expect(store.getSnapshot().current).toBe(first);
  });

  it("stops on the last track when the queue ends, by default", () => {
    const { store, engine, events } = fakeEngine();
    store.actions.playNow([first, second], 1);

    events().ended();

    expect(engine.pause).toHaveBeenCalled();
    expect(store.getSnapshot().current).toBe(second);
  });

  it("rewinds to the first track, stopped, when the policy says so", () => {
    const { store, engine, events } = fakeEngine({
      initial: withPlayback({ queueEnd: "rewind" }),
    });
    store.actions.playNow([first, second], 1);
    engine.play.mockClear();

    events().ended();

    expect(store.getSnapshot().current).toBe(first);
    expect(engine.load).toHaveBeenLastCalledWith({
      src: srcOf(first),
      assetId: first.asset.id,
    });
    expect(engine.play).not.toHaveBeenCalled();
  });

  it("empties the queue when the policy says so", () => {
    const { store, events } = fakeEngine({
      initial: withPlayback({ queueEnd: "clear" }),
    });
    store.actions.playNow([first, second], 1);

    events().ended();

    expect(store.getSnapshot().current).toBeNull();
    expect(store.getSnapshot().upcoming).toEqual([]);
  });

  it("starts what is queued into an idle player unless the policy says not to", () => {
    const starts = fakeEngine();
    starts.store.actions.enqueue([first]);
    expect(starts.engine.play).toHaveBeenCalled();

    const waits = fakeEngine({
      initial: withPlayback({ queueingStarts: false }),
    });
    waits.store.actions.playNext([first]);
    expect(waits.store.getSnapshot().current).toBe(first);
    expect(waits.engine.load).toHaveBeenCalled();
    expect(waits.engine.play).not.toHaveBeenCalled();
  });

  it("hands the engine the policy's analysis-on-touch answer", () => {
    const off = fakeEngine();
    off.store.actions.requestAnalysis();
    expect(off.engine.requestAnalysis).toHaveBeenCalledWith(false);

    const on = fakeEngine({ initial: withPlayback({ analysisOnTouch: true }) });
    on.store.actions.requestAnalysis();
    expect(on.engine.requestAnalysis).toHaveBeenCalledWith(true);
  });
});

/** A `localStorage` stand-in holding `entries`, read back as JSON. */
function memoryPersist(entries: Record<string, unknown> = {}) {
  const data = new Map(
    Object.entries(entries).map(([key, value]) => [key, JSON.stringify(value)])
  );
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    read: (key: string): unknown => {
      const raw = data.get(key);
      return raw === undefined ? undefined : JSON.parse(raw);
    },
  };
}

describe("keeping the queue", () => {
  afterEach(() => jest.useRealTimers());

  const keeping = withPlayback({ persistQueue: true });
  const QUEUE_KEY = "music_player_queue";

  /** A version of its own track, which the queue keeps by its ids. */
  const versioned = (id: number): MusicPlayerTrack => ({
    ...numbered(id),
    ownerId: 100 + id,
    trackAudio: { id: 200 + id, version: 1, isPrimary: true },
  });
  const [a, b, c] = [versioned(1), versioned(2), versioned(3)];
  const kept = (track: MusicPlayerTrack): StoredQueueEntry => ({
    kind: "version",
    trackId: track.ownerId,
    trackAudioId: track.trackAudio!.id,
  });

  /** Resolves each kept entry back to the track it was kept from. */
  const resolveFrom =
    (tracks: MusicPlayerTrack[]) => (entries: StoredQueueEntry[]) =>
      Promise.resolve(
        entries.map(
          (entry) =>
            tracks.find(
              (track) =>
                entry.kind === "version" &&
                track.trackAudio?.id === entry.trackAudioId
            ) ?? null
        )
      );

  it("keeps nothing where the policy does not keep the queue", () => {
    jest.useFakeTimers();
    const persist = memoryPersist();
    const { store } = fakeEngine({ persist });
    store.restoreQueue();

    store.actions.playNow([a, b]);
    jest.advanceTimersByTime(1000);

    expect(persist.read(QUEUE_KEY)).toBeUndefined();
  });

  it("keeps the queue's entries and position as they change", () => {
    jest.useFakeTimers();
    const persist = memoryPersist();
    const { store } = fakeEngine({ initial: keeping, persist });
    store.restoreQueue();

    store.actions.playNow([a, b, c], 1);
    jest.advanceTimersByTime(1000);
    expect(persist.read(QUEUE_KEY)).toEqual({
      entries: [kept(a), kept(b), kept(c)],
      pos: 1,
    });

    store.actions.next();
    jest.advanceTimersByTime(1000);
    expect(persist.read(QUEUE_KEY)).toMatchObject({ pos: 2 });
  });

  it("never overwrites a kept queue before it has read it", () => {
    jest.useFakeTimers();
    const persist = memoryPersist({
      [QUEUE_KEY]: { entries: [kept(a)], pos: 0 },
    });
    fakeEngine({ initial: keeping, persist });

    jest.advanceTimersByTime(1000);

    expect(persist.read(QUEUE_KEY)).toEqual({ entries: [kept(a)], pos: 0 });
  });

  it("round-trips the queue and its position through a reload, stopped", async () => {
    const persist = memoryPersist();
    const first = fakeEngine({ initial: keeping, persist });
    first.store.restoreQueue();
    first.store.actions.playNow([a, b, c], 1);
    await waitFor(() => expect(persist.read(QUEUE_KEY)).toBeDefined());

    const reloaded = fakeEngine({
      initial: keeping,
      persist,
      resolveQueue: resolveFrom([a, b, c]),
    });
    reloaded.store.restoreQueue();

    await waitFor(() => expect(reloaded.store.getSnapshot().current).toBe(b));
    expect(
      reloaded.store.getSnapshot().upcoming.map((entry) => entry.track)
    ).toEqual([c]);
    expect(reloaded.engine.load).toHaveBeenLastCalledWith({
      src: mediaProxyUrl(b.asset.assetPath),
      assetId: b.asset.id,
    });
    expect(reloaded.engine.play).not.toHaveBeenCalled();
  });

  it("drops an entry that no longer resolves and holds the position on what is left", async () => {
    const persist = memoryPersist({
      [QUEUE_KEY]: { entries: [kept(a), kept(b), kept(c)], pos: 1 },
    });
    const { store } = fakeEngine({
      initial: keeping,
      persist,
      resolveQueue: resolveFrom([a, c]),
    });

    store.restoreQueue();

    await waitFor(() => expect(store.getSnapshot().current).toBe(c));
    expect(store.getSnapshot().upcoming).toEqual([]);
    await waitFor(() =>
      expect(persist.read(QUEUE_KEY)).toEqual({
        entries: [kept(a), kept(c)],
        pos: 1,
      })
    );
  });

  it("leaves alone a queue the listener started while the kept one resolved", async () => {
    let resolve!: (tracks: (MusicPlayerTrack | null)[]) => void;
    const persist = memoryPersist({
      [QUEUE_KEY]: { entries: [kept(a)], pos: 0 },
    });
    const { store } = fakeEngine({
      initial: keeping,
      persist,
      resolveQueue: () => new Promise((settle) => (resolve = settle)),
    });
    store.restoreQueue();

    store.actions.playNow([c]);
    resolve([a]);
    await Promise.resolve();
    await Promise.resolve();

    expect(store.getSnapshot().current).toBe(c);
  });

  it("forgets the kept queue when the policy stops keeping it", () => {
    jest.useFakeTimers();
    const persist = memoryPersist({
      [QUEUE_KEY]: { entries: [kept(a)], pos: 0 },
    });
    const { store } = fakeEngine({
      initial: keeping,
      persist,
      resolveQueue: () => new Promise(() => {}),
    });
    store.restoreQueue();

    store.setPolicy({ playback: DEFAULT_PLAYBACK, lab: DEFAULT_LAB_POLICY });
    jest.advanceTimersByTime(1000);

    expect(persist.read(QUEUE_KEY)).toBeUndefined();
  });
});

describe("crossfade", () => {
  afterEach(() => jest.useRealTimers());

  const [first, second, third] = [numbered(1), numbered(2), numbered(3)];
  const sourceOf = (item: MusicPlayerTrack) => ({
    src: mediaProxyUrl(item.asset.assetPath),
    assetId: item.asset.id,
  });

  /**
   * `tracks` loaded and playing the first of them, `duration` seconds long,
   * under a crossfade of `seconds`.
   */
  function playingUnder(
    seconds: number,
    { tracks = [first, second], duration = 180, ...playback } = {} as {
      tracks?: MusicPlayerTrack[];
      duration?: number;
    } & Partial<PlaybackPolicy>
  ) {
    jest.useFakeTimers();
    const context = fakeEngine({
      initial: withPlayback({ crossfadeSeconds: seconds, ...playback }),
    });
    context.store.actions.playNow(tracks);
    context.events().play();
    context.events().duration(duration);
    return context;
  }

  it("leaves playback exactly as it was with no crossfade set", () => {
    const { store, engine, events } = playingUnder(0);
    engine.time = 179.9;

    jest.advanceTimersByTime(200_000);
    expect(engine.crossfade).not.toHaveBeenCalled();
    expect(engine.prepareNext).not.toHaveBeenCalled();

    events().ended();
    expect(engine.load).toHaveBeenLastCalledWith(sourceOf(second));
    expect(store.getSnapshot().current).toBe(second);
  });

  it("tells the engine what comes next while a crossfade is set", () => {
    const { engine } = playingUnder(3);

    expect(engine.prepareNext).toHaveBeenLastCalledWith(sourceOf(second));
  });

  it("starts the next track under the ending one the crossfade's length before its end", () => {
    const { store, engine } = playingUnder(3);

    engine.time = 176.9;
    jest.advanceTimersByTime(176_999);
    expect(engine.crossfade).not.toHaveBeenCalled();

    engine.time = 177;
    jest.advanceTimersByTime(1);
    expect(engine.crossfade).toHaveBeenCalledWith(sourceOf(second), 3);
    expect(store.getSnapshot()).toMatchObject({
      current: second,
      duration: 0,
      isPlaying: true,
    });
    expect(store.getProgress()).toBe(0);
    expect(engine.load).not.toHaveBeenLastCalledWith(sourceOf(second));
  });

  it("waits again when the playhead has fallen behind the clock", () => {
    const { engine } = playingUnder(3);

    engine.time = 170;
    jest.advanceTimersByTime(177_000);
    expect(engine.crossfade).not.toHaveBeenCalled();

    engine.time = 177;
    jest.advanceTimersByTime(7_000);
    expect(engine.crossfade).toHaveBeenCalledWith(sourceOf(second), 3);
  });

  it("overlaps only what is left when the crossfade is longer than the rest of the track", () => {
    const { store, engine } = playingUnder(5);

    engine.time = 178;
    store.actions.seek(178);
    jest.advanceTimersByTime(1);

    expect(engine.crossfade).toHaveBeenCalledWith(sourceOf(second), 2);
  });

  it("starts no earlier than halfway through a track shorter than two crossfades", () => {
    const { engine } = playingUnder(10, { duration: 8 });

    engine.time = 4;
    jest.advanceTimersByTime(4_000);

    expect(engine.crossfade).toHaveBeenCalledWith(sourceOf(second), 4);
  });

  it("counts the crossfade in heard seconds at the playing speed", () => {
    const { store, engine } = playingUnder(3);
    store.actions.setLabMode("linked");
    store.actions.setSpeed(2);

    // Six seconds of the track go by in the last three heard.
    engine.time = 174;
    jest.advanceTimersByTime(87_000);

    expect(engine.crossfade).toHaveBeenCalledWith(sourceOf(second), 3);
  });

  it("holds the crossfade while paused and arms it again on play", () => {
    const { engine, events } = playingUnder(3);
    events().pause();

    engine.time = 177;
    jest.advanceTimersByTime(200_000);
    expect(engine.crossfade).not.toHaveBeenCalled();

    events().play();
    jest.advanceTimersByTime(1);
    expect(engine.crossfade).toHaveBeenCalled();
  });

  it("lets the track end and cut when the engine cannot overlap here", () => {
    const { store, engine, events } = playingUnder(3);
    engine.crossfade.mockReturnValue(false);

    engine.time = 177;
    jest.advanceTimersByTime(177_000);
    expect(store.getSnapshot().current).toBe(first);

    jest.advanceTimersByTime(10_000);
    expect(engine.crossfade).toHaveBeenCalledTimes(1);
    events().ended();
    expect(engine.load).toHaveBeenLastCalledWith(sourceOf(second));
  });

  it("tries a crossfade again when a source the engine refused plays again", () => {
    const { engine, events } = playingUnder(3, {
      tracks: [first, second, first, third],
    });
    engine.crossfade.mockReturnValue(false);

    engine.time = 177;
    jest.advanceTimersByTime(177_000);
    expect(engine.crossfade).toHaveBeenCalledTimes(1);

    events().ended();
    events().play();
    events().duration(180);
    events().ended();
    events().play();
    events().duration(180);
    engine.time = 177;
    jest.advanceTimersByTime(177_000);

    expect(engine.crossfade).toHaveBeenCalledTimes(2);
    expect(engine.crossfade).toHaveBeenLastCalledWith(sourceOf(third), 3);
  });

  it("never crossfades out of the last track, on repeat-one, or into the same file", () => {
    const last = playingUnder(3, { tracks: [first] });
    const one = playingUnder(3, { repeat: "one" });
    const again = playingUnder(3, { tracks: [first], repeat: "all" });

    for (const { engine } of [last, one, again]) {
      engine.time = 179;
      jest.advanceTimersByTime(200_000);
      expect(engine.crossfade).not.toHaveBeenCalled();
    }
  });

  it("never crossfades out of a comparison", () => {
    const { store, engine } = playingUnder(3);
    store.actions.startCompare(third);

    engine.time = 179;
    jest.advanceTimersByTime(200_000);

    expect(engine.crossfade).not.toHaveBeenCalled();
    expect(engine.prepareNext).toHaveBeenLastCalledWith(null);
  });

  it("follows a crossfade set after the track started", () => {
    const { store, engine } = playingUnder(0);

    store.setPolicy({
      playback: { ...DEFAULT_PLAYBACK, crossfadeSeconds: 4 },
      lab: DEFAULT_LAB_POLICY,
    });
    engine.time = 176;
    jest.advanceTimersByTime(176_000);

    expect(engine.crossfade).toHaveBeenCalledWith(sourceOf(second), 4);
  });

  it("arms the next crossfade once the incoming track reports its duration", () => {
    const { engine, events } = playingUnder(3, {
      tracks: [first, second, third],
    });
    engine.time = 177;
    jest.advanceTimersByTime(177_000);
    expect(engine.prepareNext).toHaveBeenLastCalledWith(sourceOf(third));

    engine.time = 0;
    events().duration(60);
    engine.time = 57;
    jest.advanceTimersByTime(57_000);

    expect(engine.crossfade).toHaveBeenLastCalledWith(sourceOf(third), 3);
  });
});

/** The default initial with `patch` over the Lab policy. */
const withLab = (patch: Partial<typeof DEFAULT_LAB_POLICY>) =>
  playerInitial({
    playback: DEFAULT_PLAYBACK,
    lab: { ...DEFAULT_LAB_POLICY, ...patch },
  });

describe("Lab policy", () => {
  afterEach(() => jest.useRealTimers());

  it("releases after the policy's delay", () => {
    jest.useFakeTimers();
    const { store, lab } = fakeEngine({
      initial: withLab({ releaseDelayMs: 500 }),
    });

    store.actions.setAudition({ dim: true });
    store.actions.setAudition({ dim: false });
    jest.advanceTimersByTime(499);
    expect(lab.release).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(lab.release).toHaveBeenCalledTimes(1);
  });

  it("stays engaged once engaged where the policy keeps it", () => {
    jest.useFakeTimers();
    const { store, lab } = fakeEngine({
      initial: withLab({ keepEngaged: true }),
    });

    store.actions.setAudition({ dim: true });
    store.actions.setAudition({ dim: false });
    jest.advanceTimersByTime(DEFAULT_LAB_POLICY.releaseDelayMs * 10);

    expect(lab.engage).toHaveBeenCalled();
    expect(lab.release).not.toHaveBeenCalled();
  });

  it("holds speed and pitch inside the policy's ranges", () => {
    const { store } = fakeEngine({
      initial: withLab({
        speedRange: { min: 0.75, max: 1.25 },
        pitchRange: { min: -3, max: 3 },
      }),
    });

    store.actions.setSpeed(2);
    store.actions.setPitch(-12);

    expect(store.getSnapshot().lab.settings).toMatchObject({
      speed: 1.25,
      pitch: -3,
    });
  });

  it("normalises to the policy's target, and to a changed one at once", () => {
    const { store, lab } = fakeEngine({
      initial: withLab({ normaliseTargetLufs: -16 }),
    });
    const version = {
      ...track,
      trackAudio: { id: 1, version: 1, isPrimary: true, lufs: -9 },
    };

    store.actions.playNow([version]);
    expect(lab.set).toHaveBeenLastCalledWith(DEFAULT_LAB, {
      lufs: -9,
      targetLufs: -16,
    });

    store.setPolicy({
      playback: DEFAULT_PLAYBACK,
      lab: { ...DEFAULT_LAB_POLICY, normaliseTargetLufs: -23 },
    });
    expect(lab.set).toHaveBeenLastCalledWith(DEFAULT_LAB, {
      lufs: -9,
      targetLufs: -23,
    });
  });

  describe("per-project target", () => {
    const shellTarget = -16;
    const inProject = (
      projectId: number,
      asset: MusicPlayerTrack["asset"]
    ) => ({
      ...track,
      asset: { ...asset, assetPath: `./static/assets/${asset.name}` },
      projectId,
      trackAudio: { id: asset.id, version: 1, isPrimary: true, lufs: -9 },
    });
    const first = inProject(1, track.asset);
    const second = inProject(2, trackB.asset);
    const targets: Record<number, number | null> = { 1: -20, 2: -12 };
    const resolver = () =>
      mock(async (projectId: number) => targets[projectId] ?? null);
    const start = (
      resolveProjectTarget: ReturnType<typeof resolver> | undefined
    ) =>
      fakeEngine({
        initial: withLab({ normaliseTargetLufs: shellTarget }),
        resolveProjectTarget,
      });

    it("plays a project's track at that project's target, outside the project", async () => {
      const { store, lab } = start(resolver());

      store.actions.playNow([first]);
      expect(lab.set).toHaveBeenLastCalledWith(DEFAULT_LAB, {
        lufs: -9,
        targetLufs: shellTarget,
      });

      await waitFor(() =>
        expect(lab.set).toHaveBeenLastCalledWith(DEFAULT_LAB, {
          lufs: -9,
          targetLufs: -20,
        })
      );
    });

    it("keeps the shell's target when the project's cannot be read", async () => {
      const read = mock(async () => null);
      const { store, lab } = start(read);

      store.actions.playNow([first]);
      await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
      await Promise.resolve();

      expect(lab.set).toHaveBeenLastCalledWith(DEFAULT_LAB, {
        lufs: -9,
        targetLufs: shellTarget,
      });
    });

    it("plays a track with no project at the shell's target without reading any", () => {
      const read = resolver();
      const { store, lab } = start(read);

      store.actions.playNow([{ ...first, projectId: undefined }]);

      expect(read).not.toHaveBeenCalled();
      expect(lab.set).toHaveBeenLastCalledWith(DEFAULT_LAB, {
        lufs: -9,
        targetLufs: shellTarget,
      });
    });

    it("plays without reading when no resolver is given", () => {
      const { store, lab } = start(undefined);

      store.actions.playNow([first]);

      expect(lab.set).toHaveBeenLastCalledWith(DEFAULT_LAB, {
        lufs: -9,
        targetLufs: shellTarget,
      });
    });

    it("switches targets as the playing track changes projects", async () => {
      const read = resolver();
      const { store, lab } = start(read);

      store.actions.playNow([first, second]);
      await waitFor(() =>
        expect(lab.set).toHaveBeenLastCalledWith(DEFAULT_LAB, {
          lufs: -9,
          targetLufs: -20,
        })
      );

      store.actions.next();
      await waitFor(() =>
        expect(lab.set).toHaveBeenLastCalledWith(DEFAULT_LAB, {
          lufs: -9,
          targetLufs: -12,
        })
      );

      store.actions.prev();
      expect(lab.set).toHaveBeenLastCalledWith(DEFAULT_LAB, {
        lufs: -9,
        targetLufs: -20,
      });
      expect(read).toHaveBeenCalledTimes(2);
    });

    it("drops an answer for a track that is no longer playing", async () => {
      const answers = new Map<number, (target: number) => void>();
      const read = mock(
        (projectId: number) =>
          new Promise<number | null>((resolve) =>
            answers.set(projectId, resolve)
          )
      );
      const { store, lab } = start(read);

      store.actions.playNow([first, second]);
      store.actions.next();
      answers.get(1)?.(-20);
      await Promise.resolve();
      await Promise.resolve();

      expect(lab.set).toHaveBeenLastCalledWith(DEFAULT_LAB, {
        lufs: -9,
        targetLufs: shellTarget,
      });
    });

    it("learns a track's project from its metadata", async () => {
      const { getMusicPlayerMetadata } =
        await import("@/actions/player-metadata");
      (getMusicPlayerMetadata as ReturnType<typeof mock>).mockResolvedValue({
        projectId: 1,
      });
      const { store, lab } = start(resolver());

      store.actions.playNow([
        { ...first, projectId: undefined, metadataResolved: false },
      ]);

      await waitFor(() =>
        expect(lab.set).toHaveBeenLastCalledWith(DEFAULT_LAB, {
          lufs: -9,
          targetLufs: -20,
        })
      );
    });

    it("keeps a project's target when the shell's changes", async () => {
      const { store, lab } = start(resolver());
      store.actions.playNow([first]);
      await waitFor(() =>
        expect(lab.set).toHaveBeenLastCalledWith(DEFAULT_LAB, {
          lufs: -9,
          targetLufs: -20,
        })
      );

      store.setPolicy({
        playback: DEFAULT_PLAYBACK,
        lab: { ...DEFAULT_LAB_POLICY, normaliseTargetLufs: -23 },
      });

      expect(lab.set).toHaveBeenLastCalledWith(DEFAULT_LAB, {
        lufs: -9,
        targetLufs: -20,
      });
    });

    it("publishes the target the audio plays at in the snapshot", async () => {
      const { store } = start(resolver());
      expect(store.getSnapshot().lab.targetLufs).toBe(shellTarget);

      store.actions.playNow([first]);
      expect(store.getSnapshot().lab.targetLufs).toBe(shellTarget);
      await waitFor(() => expect(store.getSnapshot().lab.targetLufs).toBe(-20));

      store.setPolicy({
        playback: DEFAULT_PLAYBACK,
        lab: { ...DEFAULT_LAB_POLICY, normaliseTargetLufs: -23 },
      });
      expect(store.getSnapshot().lab.targetLufs).toBe(-20);

      store.actions.playNow([{ ...first, projectId: undefined }]);
      expect(store.getSnapshot().lab.targetLufs).toBe(-23);

      store.setPolicy({
        playback: DEFAULT_PLAYBACK,
        lab: { ...DEFAULT_LAB_POLICY, normaliseTargetLufs: -18 },
      });
      expect(store.getSnapshot().lab.targetLufs).toBe(-18);
    });

    it("names a bounce with the project's target rather than the shell's", async () => {
      const runBounce = mock(() => new Promise(() => {}));
      const store = createPlayerStore({
        createEngine: () => ({ ...silentEngine, lab: fakeEngine().lab }),
        runBounce:
          runBounce as unknown as typeof import("@/lib/dsp/bounce").bounce,
        bounceDeps: () => ({}) as unknown as BounceDeps,
        initial: withLab({ normaliseTargetLufs: shellTarget }),
        resolveProjectTarget: resolver(),
      });
      store.actions.playNow([first]);
      await waitFor(() => expect(store.getSnapshot().lab.targetLufs).toBe(-20));
      store.actions.setAudition({ normalise: true });

      store.actions.bounce();

      const [input] = runBounce.mock.calls[0] as unknown as [
        { name: string; loudness: { targetLufs: number } },
      ];
      expect(input.loudness.targetLufs).toBe(-20);
      expect(input.name).toContain("−20 LUFS");
      expect(input.name).not.toContain("−16 LUFS");
    });
  });
});

describe("compare mode", () => {
  const versionA: MusicPlayerTrack = {
    ...track,
    trackAudio: { id: 11, version: 3, isPrimary: true, lufs: -9 },
  };
  const versionB: MusicPlayerTrack = {
    ...trackB,
    trackAudio: { id: 12, version: 4, isPrimary: false, lufs: -15 },
  };
  const diff: TrackAudioDiff = {
    fromId: 11,
    toId: 12,
    aligned: true,
    offsetMs: 1500,
    change: [0, 0.5],
    loudnessDelta: [],
    summary: { changedSeconds: 1, changedShare: 0.5, loudestChange: null },
    analysisVersion: 2,
  };

  afterEach(() => jest.useRealTimers());

  /** A comparison of v3 against v4 over a fake Lab, its diff read held until `answer`. */
  function comparing() {
    let answer!: (diff: TrackAudioDiff | null) => void;
    const fetchDiff = mock<
      (id: number, otherId: number) => Promise<TrackAudioDiff | null>
    >(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        })
    );
    const context = fakeEngine({ fetchDiff });
    context.store.actions.playNow([versionA]);
    context.store.actions.startCompare(versionB);
    return {
      ...context,
      fetchDiff,
      answer: async (value: TrackAudioDiff | null) => {
        answer(value);
        await new Promise((resolve) => setTimeout(resolve, 0));
      },
      engineReady: () => context.events().compareState?.({ phase: "ready" }),
    };
  }

  it("engages the Lab and prepares B beside A, leaving current untouched", () => {
    const { store, lab } = comparing();

    expect(lab.engage).toHaveBeenCalled();
    expect(lab.compare.start).toHaveBeenCalledWith({
      src: mediaProxyUrl(versionB.asset.assetPath),
      assetId: versionB.asset.id,
    });
    expect(store.getSnapshot().current?.asset.id).toBe(versionA.asset.id);
    expect(store.getSnapshot().compare).toMatchObject({
      active: "a",
      phase: "preparing",
      diff: null,
    });
  });

  it("carries preparing progress in its own snapshot field, leaving the comparison's identity alone", () => {
    const { store, events } = comparing();
    const before = store.getSnapshot().compare;

    events().compareState?.({ phase: "preparing", fraction: 0.624 });

    expect(store.getSnapshot().compareProgress).toBe(0.62);
    expect(store.getSnapshot().compare).toBe(before);
  });

  it("reads the pair's diff once and starts B at its offset", async () => {
    const { store, lab, fetchDiff, answer } = comparing();

    await answer(diff);

    expect(fetchDiff).toHaveBeenCalledTimes(1);
    expect(fetchDiff).toHaveBeenCalledWith(11, 12);
    expect(lab.compare.align).toHaveBeenCalledWith(1.5);
    expect(store.getSnapshot().compare?.diff).toEqual(diff);
  });

  it("starts B at offset 0 when the two did not align, or there is no diff", async () => {
    const unaligned = comparing();
    await unaligned.answer({ ...diff, aligned: false, offsetMs: null });
    expect(unaligned.lab.compare.align).toHaveBeenCalledWith(0);

    const missing = comparing();
    await missing.answer(null);
    expect(missing.lab.compare.align).toHaveBeenCalledWith(0);
    expect(missing.store.getSnapshot().compare?.diff).toBeNull();
  });

  it("is ready only once the Lab holds both sources and the offset has settled", async () => {
    const { store, answer, engineReady } = comparing();

    engineReady();
    expect(store.getSnapshot().compare?.phase).toBe("preparing");

    await answer(diff);
    expect(store.getSnapshot().compare?.phase).toBe("ready");
  });

  it("swaps only once ready, routing the audible side", async () => {
    const { store, lab, answer, engineReady } = comparing();

    store.actions.swapCompare();
    expect(store.getSnapshot().compare?.active).toBe("a");

    engineReady();
    await answer(diff);
    store.actions.swapCompare();

    expect(store.getSnapshot().compare?.active).toBe("b");
    expect(lab.compare.route.mock.calls.at(-1)?.[0]).toBe("b");
    expect(store.getSnapshot().current?.asset.id).toBe(versionA.asset.id);
  });

  it("sets each chain's final gain from the matched loudness, and unity when unmatched", () => {
    const { store, lab } = comparing();
    const [gainA, gainB] = matchGains(-9, -15);

    expect(lab.compare.route).toHaveBeenLastCalledWith("a", {
      a: gainA,
      b: gainB,
    });

    store.actions.setCompareMatched(false);
    expect(lab.compare.route).toHaveBeenLastCalledWith("a", { a: 1, b: 1 });
  });

  it("ends on A by dropping B, keeping the track", async () => {
    const { store, lab, answer, engineReady } = comparing();
    engineReady();
    await answer(diff);

    store.actions.endCompare();

    expect(lab.compare.end).toHaveBeenCalledWith("a");
    expect(store.getSnapshot().compare).toBeNull();
    expect(store.getSnapshot().current?.asset.id).toBe(versionA.asset.id);
  });

  it("ends on B by making it the current track where it plays, without reloading", async () => {
    const { store, lab, engine, answer, engineReady } = comparing();
    engineReady();
    await answer(diff);
    store.actions.swapCompare();
    const load = mock();
    engine.load = load;
    engine.time = 41.5;

    store.actions.endCompare();

    expect(lab.compare.end).toHaveBeenCalledWith("b");
    expect(store.getSnapshot().current?.asset.id).toBe(versionB.asset.id);
    expect(store.getProgress()).toBe(41.5);
    expect(load).not.toHaveBeenCalled();
    expect(lab.set).toHaveBeenLastCalledWith(DEFAULT_LAB, loudness(-15));

    // B is now the loaded source, so a queue change that keeps it loads nothing.
    store.actions.enqueue([trackNext]);
    expect(load).not.toHaveBeenCalled();
  });

  it("drops a diff that lands after the comparison ended", async () => {
    const { store, lab, answer } = comparing();
    store.actions.endCompare();

    await answer(diff);

    expect(lab.compare.align).not.toHaveBeenCalled();
    expect(store.getSnapshot().compare).toBeNull();
  });

  it("gives the Lab up and shows why when B cannot be prepared", () => {
    jest.useFakeTimers();
    const { store, lab, events } = comparing();

    events().compareState?.({ phase: "unavailable", reason: "No memory" });
    jest.advanceTimersByTime(RELEASE_DELAY_MS);

    expect(store.getSnapshot().compare).toMatchObject({
      phase: "unavailable",
      reason: "No memory",
    });
    expect(lab.release).toHaveBeenCalledTimes(1);
  });

  it("ends the comparison when the queue advances", () => {
    const { store, lab } = fakeEngine();
    store.actions.playNow([versionA, trackNext]);
    store.actions.startCompare(versionB);

    store.actions.next();

    expect(store.getSnapshot().compare).toBeNull();
    expect(lab.compare.end).toHaveBeenCalledWith("a");
  });

  it("survives a seek in place while A is the side being heard", () => {
    const { store, lab, engine, events } = comparing();
    events().duration(120);

    store.actions.playAt(versionA, 30);

    expect(engine.seek).toHaveBeenCalledWith(30);
    expect(store.getSnapshot().compare).toMatchObject({ active: "a" });
    expect(lab.compare.end).not.toHaveBeenCalled();
  });

  it("ends on a seek in place while B is the side being heard, seeking A", async () => {
    const { store, lab, engine, events, answer, engineReady } = comparing();
    engineReady();
    await answer(diff);
    store.actions.swapCompare();
    events().duration(120);

    store.actions.playAt(versionA, 30);

    expect(store.getSnapshot().compare).toBeNull();
    expect(lab.compare.end).toHaveBeenCalledWith("a");
    expect(engine.seek).toHaveBeenCalledWith(30);
  });
});

describe("compare mode on a coarse pointer", () => {
  const versionA: MusicPlayerTrack = {
    ...track,
    trackAudio: { id: 11, version: 3, isPrimary: true, lufs: -9 },
  };
  const versionB: MusicPlayerTrack = {
    ...trackB,
    trackAudio: { id: 12, version: 4, isPrimary: false, lufs: -15 },
  };

  /** A coarse pointer, read fresh by `isCoarsePointer()` at `startCompare` time. */
  function coarse() {
    stubGlobal("window", {
      ...globalThis,
      matchMedia: (query: string) => ({ matches: query.includes("coarse") }),
    });
  }

  it("plays on the elements, never the Lab, ready at once with no diff fetch", () => {
    coarse();
    const fetchDiff = mock<
      (id: number, otherId: number) => Promise<TrackAudioDiff | null>
    >(async () => null);
    const { store, lab, compare } = fakeEngine({ fetchDiff });
    store.actions.playNow([versionA]);

    store.actions.startCompare(versionB);

    expect(lab.engage).not.toHaveBeenCalled();
    expect(lab.compare.start).not.toHaveBeenCalled();
    expect(compare.start).toHaveBeenCalledWith({
      src: mediaProxyUrl(versionB.asset.assetPath),
      assetId: versionB.asset.id,
    });
    expect(fetchDiff).not.toHaveBeenCalled();
    expect(store.getSnapshot().compare).toMatchObject({
      unmatched: true,
      matched: false,
      phase: "ready",
      diff: null,
    });
  });

  it("releases an already-engaged Lab at once, and will not re-engage it while comparing", () => {
    coarse();
    const { store, lab } = fakeEngine();
    store.actions.playNow([versionA]);
    store.actions.pinLab(true);
    expect(lab.engage).toHaveBeenCalledTimes(1);

    store.actions.startCompare(versionB);

    expect(lab.release).toHaveBeenCalledTimes(1);
    expect(lab.engage).toHaveBeenCalledTimes(1);

    // Still pinned, and any other syncLab trigger would read the same way:
    // an unmatched comparison overrides the engagement rule outright.
    store.actions.pinLab(true);
    expect(lab.engage).toHaveBeenCalledTimes(1);
    expect(lab.release).toHaveBeenCalledTimes(1);
  });

  it("swaps and ends through the elements' own compare, never the Lab's", () => {
    coarse();
    const { store, lab, compare } = fakeEngine();
    store.actions.playNow([versionA]);
    store.actions.startCompare(versionB);

    store.actions.swapCompare();
    expect(compare.route).toHaveBeenLastCalledWith("b", { a: 1, b: 1 });
    expect(lab.compare.route).not.toHaveBeenCalled();

    store.actions.endCompare();
    expect(compare.end).toHaveBeenCalledWith("b");
    expect(lab.compare.end).not.toHaveBeenCalled();
  });

  it("never engages the Lab for the release delay either", () => {
    jest.useFakeTimers();
    coarse();
    const { store, lab } = fakeEngine();
    store.actions.playNow([versionA]);

    store.actions.startCompare(versionB);
    store.actions.endCompare();
    jest.advanceTimersByTime(RELEASE_DELAY_MS);

    expect(lab.engage).not.toHaveBeenCalled();
    expect(lab.release).not.toHaveBeenCalled();
    jest.useRealTimers();
  });
});

describe("spectrum subscription", () => {
  /** The parts of `AudioContext` the engine's `requestAnalysis` path touches. */
  function stubAudioContext() {
    const param = () => ({
      value: 0,
      setValueAtTime() {},
      cancelScheduledValues() {},
      linearRampToValueAtTime() {},
    });
    class FakeContext {
      state = "running";
      currentTime = 0;
      destination = {};
      audioWorklet = { addModule: () => Promise.resolve() };
      resume() {
        return Promise.resolve();
      }
      close() {
        return Promise.resolve();
      }
      createGain() {
        return { gain: param(), connect() {} };
      }
      createAnalyser() {
        return { connect() {} };
      }
      createMediaElementSource() {
        return { connect() {} };
      }
    }
    stubGlobal("window", { AudioContext: FakeContext });
  }

  /** Captures the worklet nodes `attachMeters` creates, so a test can post to them. */
  function stubWorkletNodes() {
    const nodes: {
      port: { onmessage: ((event: MessageEvent) => void) | null };
    }[] = [];
    stubGlobal(
      "AudioWorkletNode",
      class {
        port: { onmessage: ((event: MessageEvent) => void) | null } = {
          onmessage: null,
        };
        constructor() {
          nodes.push(this);
        }
      }
    );
    return nodes;
  }

  it("fans a spectrum frame to two listeners and stops after unsubscribe", async () => {
    stubAudioContext();
    const nodes = stubWorkletNodes();
    const store = createPlayerStore();

    store.actions.requestAnalysis();
    // `attachMeters` compiles the real `dsp.wasm` (`compileDsp`) before it
    // creates a node, which is genuine I/O rather than a microtask — a fixed
    // number of ticks is not a reliable wait for it.
    await waitFor(() => expect(nodes.length).toBeGreaterThan(0));

    const heard: [string, Float32Array][] = [];
    const other: [string, Float32Array][] = [];
    const unsubscribe = store.subscribeSpectrum((side, db) =>
      heard.push([side, db])
    );
    store.subscribeSpectrum((side, db) => other.push([side, db]));

    const db = new Float32Array([1, 2, 3]);
    nodes[0]!.port.onmessage!({
      data: { type: "spectrum", db },
    } as MessageEvent);

    expect(heard).toEqual([["a", db]]);
    expect(other).toEqual([["a", db]]);

    unsubscribe();
    nodes[0]!.port.onmessage!({
      data: { type: "spectrum", db },
    } as MessageEvent);

    expect(heard).toHaveLength(1);
    expect(other).toHaveLength(2);
  });
});

describe("matchGains", () => {
  it("returns unity gains for equally loud sources", () => {
    expect(matchGains(-14, -14)).toEqual([1, 1]);
  });

  it("attenuates A when A is louder", () => {
    const [gainA, gainB] = matchGains(-8, -14);
    expect(gainB).toBe(1);
    expect(gainA).toBeCloseTo(Math.pow(10, -6 / 20));
  });

  it("attenuates B when B is louder", () => {
    const [gainA, gainB] = matchGains(-14, -8);
    expect(gainA).toBe(1);
    expect(gainB).toBeCloseTo(Math.pow(10, -6 / 20));
  });

  it("returns unity gains when either loudness is unknown", () => {
    expect(matchGains(null, -14)).toEqual([1, 1]);
    expect(matchGains(-14, undefined)).toEqual([1, 1]);
    expect(matchGains(null, null)).toEqual([1, 1]);
  });
});

describe("bounce action", () => {
  const trackWithProject: MusicPlayerTrack = {
    ...track,
    projectId: 5,
    trackAudio: { id: 11, version: 2, isPrimary: true, lufs: -12 },
  };

  /** An engine and store whose render pipeline is a mock the test drives by hand. */
  function setup() {
    const lab = {
      engage: mock(),
      release: mock(),
      set: mock(),
      setEqCurve: mock(),
      curve: [1, 2, 3] as number[] | null,
      compare: { start: mock(), align: mock(), route: mock(), end: mock() },
    };
    const engine: AudioEngine = { ...silentEngine, lab };
    const runBounce = mock();
    const store = createPlayerStore({
      createEngine: () => engine,
      runBounce:
        runBounce as unknown as typeof import("@/lib/dsp/bounce").bounce,
      bounceDeps: () => ({}) as unknown as BounceDeps,
    });
    return { store, lab, runBounce };
  }

  it("renders the current source at its settings and curve, named from the version", () => {
    const { store, runBounce } = setup();
    store.actions.playNow([trackWithProject]);
    runBounce.mockReturnValue(new Promise(() => {}));

    store.actions.bounce();

    expect(runBounce).toHaveBeenCalledTimes(1);
    const [input] = runBounce.mock.calls[0]!;
    expect(input.source).toEqual({
      src: mediaProxyUrl(trackWithProject.asset.assetPath),
      assetId: trackWithProject.asset.id,
    });
    expect(input.settings).toEqual(DEFAULT_LAB);
    expect(input.loudness).toEqual(loudness(-12));
    expect(input.curve).toEqual([1, 2, 3]);
    expect(input.projectId).toBe(5);
    expect(input.trackId).toBe(trackWithProject.ownerId);
    expect(input.name).toBe("take.wav — Lab bounce (v2).flac");
  });

  it("reports checkpoints without disturbing the Lab's own settings snapshot", () => {
    const { store, runBounce } = setup();
    store.actions.playNow([trackWithProject]);
    const labBefore = store.getSnapshot().lab;
    let reportProgress!: (status: { phase: string; fraction?: number }) => void;
    runBounce.mockImplementation(
      (_input, _deps, onProgress) =>
        new Promise(() => {
          reportProgress = onProgress;
        })
    );

    store.actions.bounce();
    expect(store.getSnapshot().bounce).toEqual({
      phase: "rendering",
      fraction: 0,
    });

    reportProgress({ phase: "rendering", fraction: 0.5 });
    expect(store.getSnapshot().bounce).toEqual({
      phase: "rendering",
      fraction: 0.5,
    });
    // A bounce checkpoint never touches `lab`: the same settings/phase object
    // survives, so a `useLab()` reader bails out of re-rendering over it.
    expect(store.getSnapshot().lab).toBe(labBefore);
  });

  it("ignores a bounce's progress once the track has changed mid-render", () => {
    const { store, runBounce } = setup();
    const other: MusicPlayerTrack = {
      ...trackWithProject,
      asset: {
        ...trackWithProject.asset,
        id: 21,
        assetPath: "./static/assets/other.wav",
      },
    };
    store.actions.playNow([trackWithProject, other]);
    let reportProgress!: (status: { phase: string; fraction?: number }) => void;
    runBounce.mockImplementation(
      (_input, _deps, onProgress) =>
        new Promise(() => {
          reportProgress = onProgress;
        })
    );

    store.actions.bounce();
    store.actions.next();
    expect(store.getSnapshot().bounce).toBeNull();

    // The render still in flight for the old track reports on; the store
    // must not resurrect a `bounce` snapshot for a track nobody is bouncing
    // anymore.
    reportProgress({ phase: "uploading", fraction: 1 });
    expect(store.getSnapshot().bounce).toBeNull();
  });

  it("resolves to done with the attached asset", async () => {
    const { store, runBounce } = setup();
    store.actions.playNow([trackWithProject]);
    runBounce.mockResolvedValue({ id: 99, name: "attached.wav" });

    store.actions.bounce();
    await waitFor(() => {
      if (store.getSnapshot().bounce?.phase !== "done")
        throw new Error("waiting");
    });

    expect(store.getSnapshot().bounce).toEqual({
      phase: "done",
      assetId: 99,
      name: "attached.wav",
    });
  });

  it("resolves to failed with the upload or attach error", async () => {
    const { store, runBounce } = setup();
    store.actions.playNow([trackWithProject]);
    runBounce.mockResolvedValue({ error: "Too large" });

    store.actions.bounce();
    await waitFor(() => {
      if (store.getSnapshot().bounce?.phase !== "failed")
        throw new Error("waiting");
    });

    expect(store.getSnapshot().bounce).toEqual({
      phase: "failed",
      reason: "Too large",
    });
  });

  it("fails without a track loaded, and never calls the render pipeline", () => {
    const { store, runBounce } = setup();

    store.actions.bounce();

    expect(runBounce).not.toHaveBeenCalled();
    expect(store.getSnapshot().bounce).toBeNull();
  });
});

describe("load failure", () => {
  const source = { src: mediaProxyUrl(track.asset.assetPath), assetId: 7 };

  /** Another asset with a source of its own, so playing it is a new load. */
  const other: MusicPlayerTrack = {
    ...trackB,
    asset: { ...trackB.asset, assetPath: "./static/assets/take-b.wav" },
  };

  function failing() {
    const context = fakeEngine();
    context.store.actions.playNow([track, other]);
    context.engine.load.mockClear();
    context.engine.play.mockClear();
    return context;
  }

  it("records the error for the current asset", () => {
    const { store, events } = failing();

    events().error(7, "MEDIA_ELEMENT_ERROR: Format error");

    expect(store.getSnapshot().loadError).toEqual({
      assetId: 7,
      message: "MEDIA_ELEMENT_ERROR: Format error",
    });
  });

  it("stops playing when the source fails after play started", () => {
    const { store, events } = failing();
    events().play();
    expect(store.getSnapshot().isPlaying).toBe(true);

    events().error(7, "boom");

    expect(store.getSnapshot().isPlaying).toBe(false);
    expect(store.getSnapshot().loadError).toEqual({
      assetId: 7,
      message: "boom",
    });
  });

  it("stores a fixed message when the browser gave none", () => {
    const { store, events } = failing();

    events().error(7, "");

    expect(store.getSnapshot().loadError?.message).toBe(
      "The audio failed to load"
    );
  });

  it("ignores an error for an asset that is no longer current", () => {
    const { store, events } = failing();

    events().error(8, "late");
    events().error(99, "unknown");

    expect(store.getSnapshot().loadError).toBeNull();
  });

  it("clears the error once the source's metadata arrives", () => {
    const { store, events } = failing();
    events().error(7, "boom");

    events().duration(180);

    expect(store.getSnapshot().loadError).toBeNull();
  });

  it("keeps the error through a duration report of zero", () => {
    const { store, events } = failing();
    events().error(7, "boom");

    events().duration(0);

    expect(store.getSnapshot().loadError).not.toBeNull();
  });

  it("clears the error when another asset loads", () => {
    const { store, events } = failing();
    events().error(7, "boom");

    store.actions.next();

    expect(store.getSnapshot().loadError).toBeNull();
  });

  it("retry reloads the same source, clears the error and plays", () => {
    const { store, engine, events } = failing();
    events().error(7, "boom");

    store.actions.retry();

    expect(engine.load).toHaveBeenCalledTimes(1);
    expect(engine.load).toHaveBeenCalledWith(source);
    expect(engine.play).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().loadError).toBeNull();
  });

  it("retry starts the reload from the start, not the failed position", () => {
    const { store, engine, events } = failing();
    events().duration(180);
    store.actions.seek(60);
    events().error(7, "boom");
    engine.seek.mockClear();

    store.actions.retry();
    events().duration(180);

    expect(engine.seek).not.toHaveBeenCalled();
  });

  it("a second retry before the reload settles does nothing", () => {
    const { store, engine, events } = failing();
    events().error(7, "boom");

    store.actions.retry();
    store.actions.retry();

    expect(engine.load).toHaveBeenCalledTimes(1);
    expect(engine.play).toHaveBeenCalledTimes(1);
  });

  it("retry is a no-op while there is no error", () => {
    const { store, engine } = failing();

    store.actions.retry();

    expect(engine.load).not.toHaveBeenCalled();
    expect(engine.play).not.toHaveBeenCalled();
  });

  it("records a failure of the reload", () => {
    const { store, events } = failing();
    events().error(7, "first");
    store.actions.retry();

    events().error(7, "second");

    expect(store.getSnapshot().loadError?.message).toBe("second");
  });
});
