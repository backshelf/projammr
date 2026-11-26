import { describe, expect, it } from "bun:test";

import type { MusicPlayerTrack } from "@/components/music-player/types";

import * as Q from "./player-queue";

const track = (id: number) =>
  ({ asset: { id }, title: `t${id}` }) as unknown as MusicPlayerTrack;

const keysOf = (q: Q.Queue) => Q.upcoming(q).map((e) => e.key);
const idsOf = (q: Q.Queue) => Q.upcoming(q).map((e) => e.track.asset.id);

describe("queue entry keys", () => {
  it("survive removing an earlier entry, unlike qIndex", () => {
    const q = Q.replace([track(1), track(2), track(3), track(4)], 0, false);
    expect(keysOf(q)).toEqual([1, 2, 3]);

    const removed = Q.removeAt(q, 2);
    expect(idsOf(removed)).toEqual([2, 4]);
    expect(keysOf(removed)).toEqual([1, 3]);
    // The renumbered index is what the key exists to outlive.
    expect(Q.upcoming(removed).map((e) => e.qIndex)).toEqual([1, 2]);
  });

  it("follow their entry through a reorder", () => {
    const q = Q.replace([track(1), track(2), track(3)], 0, false);
    const moved = Q.moveItem(q, 1, 2);
    expect(idsOf(moved)).toEqual([3, 2]);
    expect(keysOf(moved)).toEqual([2, 1]);
  });

  it("are fresh for every appended entry, even a repeated track", () => {
    const q = Q.append(Q.replace([track(1)], 0, false), [track(1), track(1)]);
    expect(keysOf(q)).toEqual([1, 2]);
    expect(Q.insertNext(q, [track(9)]).keys).toEqual([0, 1, 2, 3]);
  });

  it("are not reused after the queue empties", () => {
    const q = Q.removeAt(Q.replace([track(1)], 0, false), 0);
    expect(q.tracks).toEqual([]);
    expect(keysOf(Q.append(q, [track(2)]))).toEqual([]);
    expect(Q.append(q, [track(2)]).keys).toEqual([1]);
  });
});

describe("withCurrent", () => {
  it("replaces the playing track in place, keeping its key and what follows", () => {
    const queue = Q.replace([track(1), track(2), track(3)], 1, false);

    const next = Q.withCurrent(queue, track(9));

    expect(Q.current(next)?.asset.id).toBe(9);
    expect(next.keys).toEqual(queue.keys);
    expect(Q.upcoming(next).map((entry) => entry.track.asset.id)).toEqual([3]);
  });

  it("leaves an empty queue alone", () => {
    expect(Q.withCurrent(Q.empty, track(9))).toBe(Q.empty);
  });
});
