import { describe, expect, it } from "bun:test";
import { DEFAULT_LAB } from "@/lib/dsp/lab-settings";
import { DEFAULT_PLAYER_INITIAL } from "./player-initial";
import * as Q from "./player-queue";
import {
  keptPosition,
  queueToStored,
  readStoredQueue,
  readStoredSettings,
  type PlayerSettings,
  type StoredQueueEntry,
} from "./player-storage";
import type { MusicPlayerTrack } from "./types";

const defaultPrefs = DEFAULT_PLAYER_INITIAL.prefs;

/** The stored settings over `initial`, safe auditions remembered unless said otherwise. */
const read = (
  storage: ReturnType<typeof memoryStorage>,
  initial: PlayerSettings = DEFAULT_PLAYER_INITIAL,
  rememberAuditions = true
) => readStoredSettings(storage, initial, { rememberAuditions });

function memoryStorage(entries: Record<string, unknown> = {}) {
  const data = new Map(
    Object.entries(entries).map(([key, value]) => [key, JSON.stringify(value)])
  );
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    read: (key: string) => {
      const raw = data.get(key);
      return raw === undefined ? undefined : JSON.parse(raw);
    },
  };
}

describe("readStoredSettings", () => {
  it("reads defaults from empty storage and writes nothing", () => {
    const storage = memoryStorage();

    expect(read(storage)).toEqual({
      prefs: defaultPrefs,
      lab: DEFAULT_LAB,
    });
    expect(storage.read("music_player_lab")).toBeUndefined();
  });

  it("starts a browser with nothing stored from `initial`", () => {
    const initial: PlayerSettings = {
      prefs: { volume: 0.5, muted: true, repeat: "all", shuffle: true },
      lab: { ...DEFAULT_LAB, mode: "linked" },
    };

    expect(read(memoryStorage(), initial)).toEqual(initial);
  });

  it("lets every stored field win over `initial` and fills the rest from it", () => {
    const initial: PlayerSettings = {
      prefs: { volume: 0.5, muted: true, repeat: "all", shuffle: true },
      lab: {
        ...DEFAULT_LAB,
        mode: "linked",
        rack: {
          ...DEFAULT_LAB.rack,
          comp: { ...DEFAULT_LAB.rack.comp, ratio: 8 },
        },
      },
    };
    const storage = memoryStorage({
      music_player_prefs: { volume: 0.8, muted: false },
      music_player_lab: { speed: 1.2, rack: { comp: { on: true } } },
    });

    const { prefs, lab } = read(storage, initial);

    expect(prefs).toEqual({
      volume: 0.8,
      muted: false,
      repeat: "all",
      shuffle: true,
    });
    expect(lab.mode).toBe("linked");
    expect(lab.speed).toBe(1.2);
    expect(lab.rack.comp).toEqual({
      ...DEFAULT_LAB.rack.comp,
      ratio: 8,
      on: true,
    });
  });

  it("forgets every audition when the policy remembers none", () => {
    const storage = memoryStorage({
      music_player_lab: {
        ...DEFAULT_LAB,
        speed: 0.9,
        auditions: { ...DEFAULT_LAB.auditions, crossfeed: true, width: 0.5 },
      },
    });

    const { lab } = read(storage, DEFAULT_PLAYER_INITIAL, false);

    expect(lab.speed).toBe(0.9);
    expect(lab.auditions).toEqual(DEFAULT_LAB.auditions);
  });

  it("keeps a listener's saved rate as linked speed and rewrites both blobs once", () => {
    const storage = memoryStorage({
      music_player_prefs: { volume: 0.4, rate: 1.25, repeat: "all" },
    });

    const { prefs, lab } = read(storage);

    expect(prefs).toEqual({ ...defaultPrefs, volume: 0.4, repeat: "all" });
    expect(lab.mode).toBe("linked");
    expect(lab.speed).toBe(1.25);
    expect(storage.read("music_player_prefs")).not.toHaveProperty("rate");
    expect(storage.read("music_player_lab")).toMatchObject({
      mode: "linked",
      speed: 1.25,
    });
  });

  it("clamps a saved rate below the speed range", () => {
    const storage = memoryStorage({ music_player_prefs: { rate: 0.25 } });

    expect(read(storage).lab.speed).toBe(0.5);
  });

  it("resets the dangerous auditions on load and keeps the others", () => {
    const storage = memoryStorage({
      music_player_lab: {
        ...DEFAULT_LAB,
        speed: 0.9,
        auditions: {
          ...DEFAULT_LAB.auditions,
          stereo: "mono",
          dim: true,
          device: "car",
          bands: ["low"],
          crossfeed: true,
        },
      },
    });

    const { lab } = read(storage);

    expect(lab.speed).toBe(0.9);
    expect(lab.auditions).toEqual({
      ...DEFAULT_LAB.auditions,
      crossfeed: true,
    });
  });

  it("fills settings a stored blob lacks from the defaults", () => {
    const storage = memoryStorage({
      music_player_lab: { mode: "pitch", rack: { comp: { on: true } } },
    });

    const { lab } = read(storage);

    expect(lab.mode).toBe("pitch");
    expect(lab.rack.comp).toEqual({ ...DEFAULT_LAB.rack.comp, on: true });
    expect(lab.rack.eq).toEqual(DEFAULT_LAB.rack.eq);
  });
});

describe("queueToStored", () => {
  const version = (id: number): MusicPlayerTrack => ({
    ownerType: "track",
    ownerId: 100 + id,
    asset: { id, name: `${id}.wav`, assetPath: `./${id}.wav` },
    trackAudio: { id: 200 + id, version: 1, isPrimary: true },
  });
  const file: MusicPlayerTrack = {
    ownerType: "project",
    ownerId: 5,
    projectId: 5,
    asset: { id: 9, name: "memo.m4a", assetPath: "./memo.m4a" },
  };

  it("keeps each entry in play order by what fetches it afresh, and the position", () => {
    const queue = Q.replace([version(1), file, version(2)], 1, false);

    expect(queueToStored(queue)).toEqual({
      entries: [
        { kind: "version", trackId: 101, trackAudioId: 201 },
        { kind: "asset", ownerType: "project", ownerId: 5, assetId: 9 },
        { kind: "version", trackId: 102, trackAudioId: 202 },
      ],
      pos: 1,
    });
  });

  it("keeps a shuffled queue in the order it plays", () => {
    const queue = { ...Q.replace([version(1), version(2)], 0, false) };
    const shuffled = { ...queue, order: [1, 0] };

    expect(
      queueToStored(shuffled)?.entries.map((entry) =>
        entry.kind === "version" ? entry.trackId : null
      )
    ).toEqual([102, 101]);
  });

  it("keeps nothing for an empty queue", () => {
    expect(queueToStored(Q.empty)).toBeNull();
  });
});

describe("readStoredQueue", () => {
  const entries: StoredQueueEntry[] = [
    { kind: "version", trackId: 1, trackAudioId: 11 },
    { kind: "asset", ownerType: "session", ownerId: 3, assetId: 30 },
  ];

  it("reads back what was kept", () => {
    const storage = memoryStorage({
      music_player_queue: { entries, pos: 1 },
    });

    expect(readStoredQueue(storage)).toEqual({ entries, pos: 1 });
  });

  it("drops an entry that does not name what it plays, and holds the position on its entry", () => {
    const storage = memoryStorage({
      music_player_queue: {
        entries: [
          { kind: "version", trackId: "1" },
          ...entries,
          { kind: "asset", ownerType: "planet", ownerId: 1, assetId: 2 },
        ],
        pos: 2,
      },
    });

    expect(readStoredQueue(storage)).toEqual({ entries, pos: 1 });
  });

  it("reads nothing from an empty, missing or corrupt value", () => {
    expect(readStoredQueue(memoryStorage())).toBeNull();
    expect(
      readStoredQueue(memoryStorage({ music_player_queue: { entries: [] } }))
    ).toBeNull();
    expect(
      readStoredQueue(memoryStorage({ music_player_queue: [1, 2] }))
    ).toBeNull();
  });
});

describe("keptPosition", () => {
  it("stays on its entry when the entry is kept", () => {
    expect(keptPosition(["a", null, "c"], 2)).toBe(1);
  });

  it("moves on to the next kept entry when its own was dropped", () => {
    expect(keptPosition(["a", null, "c"], 1)).toBe(1);
  });

  it("clamps to the last kept entry when nothing after it is kept", () => {
    expect(keptPosition(["a", "b", null], 2)).toBe(1);
  });
});
