import { describe, expect, it } from "bun:test";
import { SettingsWriteQueue } from "@/lib/settings/write-queue";
import { HubRowsStore, type ReadHub } from "./hub-rows";
import type { HubRow, HubRows } from "./types";

/** A hub read that counts its calls and answers with `rows`. */
function countingRead(rows: HubRows = {}) {
  const read = Object.assign(
    async () => {
      read.calls += 1;
      return rows;
    },
    { calls: 0 }
  );
  return read satisfies ReadHub;
}

/** Lets a read the store started answer and apply. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const KEY = "editor.rhymePrefix";
const row = (effective: boolean): HubRow => ({
  effective,
  source: "instance",
  writable: { instance: true },
  lockable: { instance: true },
  values: { instance: effective },
});

const USER = { scope: "user", id: "someone" } as const;

describe("HubRowsStore.landed", () => {
  it("reads the page once for every change a batch's one answer settles", async () => {
    const read = countingRead();
    // Inside a project, a user write's answer was resolved without it.
    const store = new HubRowsStore({}, 5, read);
    const answer: HubRows = {};

    await Promise.all([
      store.landed(USER, answer),
      store.landed(USER, answer),
      store.landed(USER, answer),
    ]);
    expect(read.calls).toBe(1);

    await store.landed(USER, {});
    expect(read.calls).toBe(2);
  });

  it("takes an answer resolved for the page's own context without reading", async () => {
    const read = countingRead();
    const store = new HubRowsStore({}, null, read);

    await store.landed(USER, {});
    expect(read.calls).toBe(0);
  });
});

describe("HubRowsStore.attach", () => {
  it("re-reads and repaints when its seed is older than a settled write", async () => {
    const queue = new SettingsWriteQueue(async () => ({}));
    const read = countingRead({ [KEY]: row(true) });
    // The page mounts with its server read, and the caller leaves it.
    const seed: HubRows = { [KEY]: row(false) };
    new HubRowsStore(seed, null, read).attach(queue);

    // A change lands elsewhere, then Back restores the page's payload from
    // the router cache, old read and all.
    await queue.write("user", "someone", { "editor.rhymePrefix": "!" });
    const restored = new HubRowsStore(seed, null, read);
    restored.attach(queue);
    await settle();

    expect(read.calls).toBe(1);
    expect(restored.row(KEY)).toEqual(row(true));
  });

  it("re-reads again on a second restore of the same outdated seed", async () => {
    const queue = new SettingsWriteQueue(async () => ({}));
    const read = countingRead({ [KEY]: row(true) });
    const seed: HubRows = { [KEY]: row(false) };
    new HubRowsStore(seed, null, read).attach(queue);
    await queue.write("user", "someone", { "editor.rhymePrefix": "!" });

    // Back, away, and Back again: the router cache hands back the same stale
    // seed both times, so both mounts must re-read rather than show it.
    new HubRowsStore(seed, null, read).attach(queue);
    await settle();
    const again = new HubRowsStore(seed, null, read);
    again.attach(queue);
    await settle();

    expect(read.calls).toBe(2);
    expect(again.row(KEY)).toEqual(row(true));
  });

  it("re-reads a restored refresh that a write has since outdated", async () => {
    const queue = new SettingsWriteQueue(async () => ({}));
    const read = countingRead({ [KEY]: row(true) });
    const store = new HubRowsStore({ [KEY]: row(false) }, null, read);
    store.attach(queue);

    // A route refresh hands the mounted page a new read, then a write lands
    // and Back restores that later read from the router cache.
    const refreshed: HubRows = { [KEY]: row(false) };
    store.adopt(refreshed);
    await queue.write("user", "someone", { "editor.rhymePrefix": "!" });
    const restored = new HubRowsStore(refreshed, null, read);
    restored.attach(queue);
    await settle();

    expect(restored.row(KEY)).toEqual(row(true));
  });

  it("makes no extra hub read mounting from a payload no write has outdated", async () => {
    const queue = new SettingsWriteQueue(async () => ({}));
    const read = countingRead({ [KEY]: row(true) });
    const seed: HubRows = { [KEY]: row(false) };

    // Back and forth with no write between: the cached read still stands.
    new HubRowsStore(seed, null, read).attach(queue);
    new HubRowsStore(seed, null, read).attach(queue);
    await settle();

    expect(read.calls).toBe(0);
  });

  it("is a no-op without a queue, such as in a test with no SettingsProvider", () => {
    const read = countingRead();
    const store = new HubRowsStore({}, null, read);
    expect(() => store.attach(null)).not.toThrow();
  });
});

describe("HubRowsStore observing the queue", () => {
  it("re-reads once for a user-scope write landing while the page shows a project", async () => {
    const read = countingRead({ [KEY]: row(true) });
    const queue = new SettingsWriteQueue(async () => ({}));
    // A project page: a personal write's answer cannot stand in for it.
    const store = new HubRowsStore({ [KEY]: row(false) }, 5, read);
    store.attach(queue);

    await queue.write("user", "someone", { "editor.rhymePrefix": "!" });
    await settle();

    expect(read.calls).toBe(1);
    expect(store.row(KEY)).toEqual(row(true));
  });

  it("processes a hub write once whether the queue observer or the write's own caller lands it first", async () => {
    const read = countingRead({ [KEY]: row(true) });
    const queue = new SettingsWriteQueue(async () => ({}));
    // A user-scope write landing while the page shows a project: unanswered,
    // so both the observer and row-state's own `landed` call trigger a read.
    const store = new HubRowsStore({ [KEY]: row(false) }, 5, read);
    store.attach(queue);

    const sent = queue.write("user", "someone", { "editor.rhymePrefix": "!" });
    const rows = await sent;
    // The same call row-state.ts's `follow` makes once its own write settles.
    await store.landed(USER, rows);

    expect(read.calls).toBe(1);
    expect(store.row(KEY)).toEqual(row(true));
  });

  it("stops observing the queue once attach's cleanup runs", async () => {
    const read = countingRead();
    const queue = new SettingsWriteQueue(async () => ({}));
    // A page with no project: a personal write answers it directly.
    const store = new HubRowsStore({ [KEY]: row(false) }, null, read);
    const unobserve = store.attach(queue);
    unobserve();

    await queue.write("user", "someone", { "editor.rhymePrefix": "!" });
    await settle();

    expect(store.row(KEY)).toEqual(row(false));
    expect(read.calls).toBe(0);
  });
});
