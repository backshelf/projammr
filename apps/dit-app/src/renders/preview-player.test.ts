/**
 * Ported from the retired scanner's render preview tests, with the source of a path asynchronous (the asset protocol
 * needs the file allowed first) and the cases that follow from that added.
 */
import { describe, expect, it } from "bun:test";

import {
  AUDITION_SEEK_SECONDS,
  AUDITION_START,
  type PreviewAudio,
  RenderPreviewPlayer,
} from "./preview-player";

class FakeAudio implements PreviewAudio {
  src = "";
  currentTime = 0;
  duration = 0;
  paused = true;
  loads = 0;
  removedAttributes: string[] = [];
  private listeners = new Map<string, Set<() => void>>();

  async play(): Promise<void> {
    this.paused = false;
  }

  pause(): void {
    this.paused = true;
  }

  load(): void {
    this.loads += 1;
  }

  removeAttribute(name: string): void {
    this.removedAttributes.push(name);
  }

  addEventListener(type: string, listener: () => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener();
  }

  listenerCount(): number {
    return [...this.listeners.values()].reduce(
      (total, set) => total + set.size,
      0
    );
  }
}

const urlOf = (path: string): string => `asset://localhost/${path}`;

/** A player over one fake element, kept subscribed the way a mounted card is. */
function playerWithAudio(): {
  player: RenderPreviewPlayer;
  audio: FakeAudio;
  unsubscribe: () => void;
  allowed: string[];
} {
  const audio = new FakeAudio();
  const allowed: string[] = [];
  const player = new RenderPreviewPlayer(
    async (path) => {
      allowed.push(path);
      return urlOf(path);
    },
    () => audio
  );
  const unsubscribe = player.subscribe(() => {});
  return { player, audio, unsubscribe, allowed };
}

describe("RenderPreviewPlayer", () => {
  it("allows the file, loads it from the url it was given and reports it playing", async () => {
    const { player, audio, allowed } = playerWithAudio();

    await player.play("/music/canopy/bounce.wav");

    expect(allowed).toEqual(["/music/canopy/bounce.wav"]);
    expect(audio.src).toBe(urlOf("/music/canopy/bounce.wav"));
    expect(audio.paused).toBe(false);
    expect(player.getSnapshot()).toMatchObject({
      filePath: "/music/canopy/bounce.wav",
      playing: true,
    });
  });

  it("reports the file playing at once, before its source has answered", () => {
    const { player, audio } = playerWithAudio();

    void player.play("/music/first.wav");

    expect(player.getSnapshot().playing).toBe(true);
    expect(audio.src).toBe("");
  });

  it("stops the first preview when a second one starts", async () => {
    const { player, audio } = playerWithAudio();

    await player.play("/music/first.wav");
    audio.duration = 90;
    audio.emit("durationchange");
    audio.currentTime = 12;
    audio.emit("timeupdate");

    await player.play("/music/second.wav");

    expect(audio.src).toBe(urlOf("/music/second.wav"));
    expect(player.getSnapshot()).toEqual({
      filePath: "/music/second.wav",
      playing: true,
      currentTime: 0,
      duration: 0,
    });
  });

  it("drops a source that a newer play outran", async () => {
    const audio = new FakeAudio();
    const resolvers = new Map<string, (url: string) => void>();
    const player = new RenderPreviewPlayer(
      (path) =>
        new Promise<string>((resolve) => {
          resolvers.set(path, resolve);
        }),
      () => audio
    );

    const first = player.play("/music/first.wav");
    const second = player.play("/music/second.wav");
    resolvers.get("/music/second.wav")?.(urlOf("/music/second.wav"));
    await second;
    resolvers.get("/music/first.wav")?.(urlOf("/music/first.wav"));
    await first;

    expect(audio.src).toBe(urlOf("/music/second.wav"));
    expect(player.getSnapshot().filePath).toBe("/music/second.wav");
  });

  it("loads a file paused while its source was resolving, and does not play it", async () => {
    const audio = new FakeAudio();
    let resolve: (url: string) => void = () => {};
    const player = new RenderPreviewPlayer(
      () =>
        new Promise<string>((done) => {
          resolve = done;
        }),
      () => audio
    );

    const started = player.play("/music/first.wav");
    player.pause();
    resolve(urlOf("/music/first.wav"));
    await started;

    expect(audio.src).toBe(urlOf("/music/first.wav"));
    expect(audio.paused).toBe(true);
    expect(player.getSnapshot().playing).toBe(false);
  });

  it("gives up playing a file the app would not allow", async () => {
    const audio = new FakeAudio();
    const player = new RenderPreviewPlayer(
      async () => {
        throw "That file is outside the folders dit reads.";
      },
      () => audio
    );

    await player.play("/etc/passwd");

    expect(audio.src).toBe("");
    expect(player.getSnapshot()).toMatchObject({
      filePath: "/etc/passwd",
      playing: false,
    });
  });

  it("toggles the file it is already playing to paused and back", async () => {
    const { player, audio } = playerWithAudio();

    await player.toggle("/music/first.wav");
    expect(player.getSnapshot().playing).toBe(true);

    await player.toggle("/music/first.wav");
    expect(player.getSnapshot().playing).toBe(false);
    expect(audio.paused).toBe(true);

    await player.toggle("/music/first.wav");
    expect(player.getSnapshot().playing).toBe(true);
  });

  it("tracks position and duration from the element", async () => {
    const { player, audio } = playerWithAudio();

    await player.play("/music/first.wav");
    audio.duration = 214.5;
    audio.emit("durationchange");
    audio.currentTime = 7.25;
    audio.emit("timeupdate");

    expect(player.getSnapshot()).toMatchObject({
      currentTime: 7.25,
      duration: 214.5,
    });
  });

  it("ignores a duration the element reports as infinite", async () => {
    const { player, audio } = playerWithAudio();

    await player.play("/music/first.wav");
    audio.duration = Number.POSITIVE_INFINITY;
    audio.emit("durationchange");

    expect(player.getSnapshot().duration).toBe(0);
  });

  it("seeks the element and reports the new position at once", async () => {
    const { player, audio } = playerWithAudio();

    await player.play("/music/first.wav");
    player.seek(42);

    expect(audio.currentTime).toBe(42);
    expect(player.getSnapshot().currentTime).toBe(42);
  });

  it("seeks by a step from where it is and never past either end", async () => {
    const { player, audio } = playerWithAudio();

    await player.play("/music/first.wav");
    audio.duration = 100;
    audio.emit("durationchange");
    player.seek(50);

    player.seekBy(AUDITION_SEEK_SECONDS);
    expect(audio.currentTime).toBe(60);
    player.seekBy(-AUDITION_SEEK_SECONDS * 20);
    expect(audio.currentTime).toBe(0);
    player.seekBy(AUDITION_SEEK_SECONDS * 20);
    expect(audio.currentTime).toBe(100);
  });

  it("starts a fresh file a third of the way in, once its length is known", async () => {
    const { player, audio } = playerWithAudio();

    await player.playFrom("/music/first.wav", AUDITION_START);
    expect(audio.currentTime).toBe(0);

    audio.duration = 210;
    audio.emit("durationchange");

    expect(audio.currentTime).toBeCloseTo(70, 5);
    expect(player.getSnapshot().currentTime).toBeCloseTo(70, 5);
  });

  it("jumps at once when the file it plays from is already loaded", async () => {
    const { player, audio } = playerWithAudio();

    await player.play("/music/first.wav");
    audio.duration = 90;
    audio.emit("durationchange");
    await player.playFrom("/music/first.wav", 0.5);

    expect(audio.currentTime).toBe(45);
  });

  it("forgets a pending jump when another file takes the element", async () => {
    const { player, audio } = playerWithAudio();

    await player.playFrom("/music/first.wav", AUDITION_START);
    await player.play("/music/second.wav");
    audio.duration = 90;
    audio.emit("durationchange");

    expect(audio.currentTime).toBe(0);
  });

  it("rewinds to the start and stops when the file ends", async () => {
    const { player, audio } = playerWithAudio();

    await player.play("/music/first.wav");
    audio.currentTime = 30;
    audio.emit("timeupdate");
    audio.emit("ended");

    expect(player.getSnapshot()).toMatchObject({
      playing: false,
      currentTime: 0,
    });
  });

  it("stops and lets go of the element when released", async () => {
    const { player, audio } = playerWithAudio();

    await player.play("/music/first.wav");
    player.release();

    expect(audio.paused).toBe(true);
    expect(audio.removedAttributes).toContain("src");
    expect(audio.listenerCount()).toBe(0);
    expect(player.getSnapshot()).toEqual({
      filePath: null,
      playing: false,
      currentTime: 0,
      duration: 0,
    });
  });

  it("does not load a file whose source answers after the player was released", async () => {
    const audio = new FakeAudio();
    let resolve: (url: string) => void = () => {};
    const player = new RenderPreviewPlayer(
      () =>
        new Promise<string>((done) => {
          resolve = done;
        }),
      () => audio
    );

    const started = player.play("/music/first.wav");
    player.release();
    resolve(urlOf("/music/first.wav"));
    await started;

    expect(audio.src).toBe("");
    expect(player.getSnapshot().filePath).toBeNull();
  });

  it("keeps playing while any card is still subscribed", async () => {
    const { player, audio, unsubscribe } = playerWithAudio();
    const second = player.subscribe(() => {});

    await player.play("/music/first.wav");
    unsubscribe();

    expect(audio.paused).toBe(false);
    expect(player.getSnapshot().filePath).toBe("/music/first.wav");
    second();
  });

  // The cards come and go as renders settle; neither is the person asking for the playback to stop.
  it("keeps playing when the last card unsubscribes and another takes over", async () => {
    const { player, audio, unsubscribe } = playerWithAudio();

    await player.play("/music/first.wav");
    audio.emit("durationchange");
    audio.currentTime = 12;
    audio.emit("timeupdate");
    unsubscribe();

    expect(audio.paused).toBe(false);
    expect(audio.removedAttributes).not.toContain("src");
    expect(player.getSnapshot()).toMatchObject({
      filePath: "/music/first.wav",
      playing: true,
      currentTime: 12,
    });

    const resubscribed = player.subscribe(() => {});
    expect(player.getSnapshot()).toMatchObject({
      filePath: "/music/first.wav",
      playing: true,
      currentTime: 12,
    });
    resubscribed();
  });

  it("notifies subscribers on every transport change", async () => {
    const { player } = playerWithAudio();
    let notifications = 0;
    const unsubscribe = player.subscribe(() => {
      notifications += 1;
    });

    await player.play("/music/first.wav");
    player.pause();

    expect(notifications).toBe(2);
    unsubscribe();
  });
});

describe("the audition", () => {
  it("starts a third of the way in and steps ten seconds", () => {
    expect(AUDITION_START).toBeCloseTo(1 / 3, 10);
    expect(AUDITION_SEEK_SECONDS).toBe(10);
  });
});
