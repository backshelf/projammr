import { describe, expect, it, mock } from "bun:test";
import type { Job } from "@workspace/api/api";

import {
  createJobsStream,
  type EventSourceLike,
  type TimerHandle,
} from "./jobs-stream";

const job = (id: number, overrides: Partial<Job> = {}) =>
  ({
    id,
    kind: "convert",
    status: "running",
    percent: 0,
    queuePosition: null,
    startedAt: "2026-09-13T10:00:00.000Z",
    finishedAt: null,
    ...overrides,
  }) as Job;

/** A deterministic clock the test drives by hand: `setTimeout`/`clearTimeout`
 *  scheduled against a virtual `now`, advanced one due timer at a time so a
 *  timer a callback schedules mid-advance still fires inside the window. */
function createFakeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { time: number; run: () => void }>();

  const flushMicrotasks = async () => {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));
  };

  return {
    now: () => now,
    setTimeout: (run: () => void, ms: number): TimerHandle => {
      const id = nextId++;
      timers.set(id, { time: now + ms, run });
      return id as unknown as TimerHandle;
    },
    clearTimeout: (handle: TimerHandle) => {
      timers.delete(handle as unknown as number);
    },
    async advance(ms: number) {
      const target = now + ms;
      for (;;) {
        let due: [number, { time: number; run: () => void }] | null = null;
        for (const entry of timers) {
          if (
            entry[1].time <= target &&
            (!due || entry[1].time < due[1].time)
          ) {
            due = entry;
          }
        }
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].time;
        due[1].run();
        await flushMicrotasks();
      }
      now = target;
    },
  };
}

/** A stand-in for the browser's `EventSource`: no network, driven by hand. */
class FakeEventSource implements EventSourceLike {
  closed = false;
  private listeners = new Map<
    string,
    Set<(event: { data?: unknown }) => void>
  >();

  addEventListener(
    type: string,
    listener: (event: { data?: unknown }) => void
  ) {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  close() {
    this.closed = true;
  }

  emit(type: "snapshot" | "job", data: unknown) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data: JSON.stringify(data) });
    }
  }

  error() {
    for (const listener of this.listeners.get("error") ?? []) listener({});
  }
}

function setup(fetchJobs = mock(async (): Promise<Job[]> => [])) {
  const clock = createFakeClock();
  const sources: FakeEventSource[] = [];
  const updates: Map<number, Job>[] = [];

  const stream = createJobsStream({
    createEventSource: () => {
      const source = new FakeEventSource();
      sources.push(source);
      return source;
    },
    fetchJobs,
    onUpdate: (jobs) => updates.push(new Map(jobs)),
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    now: clock.now,
  });

  return {
    clock,
    sources,
    updates,
    stream,
    fetchJobs,
    latest: () => sources.at(-1)!,
  };
}

describe("createJobsStream", () => {
  it("fills the map from a snapshot and updates it from a job event with no fetch", () => {
    const fetchJobs = mock(async (): Promise<Job[]> => []);
    const { stream, latest, updates } = setup(fetchJobs);

    stream.start();
    latest().emit("snapshot", [job(1, { status: "queued" })]);
    expect(updates.at(-1)?.get(1)?.status).toBe("queued");

    latest().emit("job", job(1, { status: "running", percent: 40 }));
    expect(updates.at(-1)?.get(1)?.percent).toBe(40);
    expect(fetchJobs).not.toHaveBeenCalled();
  });

  it("fetches the collapsed read within 2 s of a stream error", async () => {
    const fetchJobs = mock(async (): Promise<Job[]> => [job(1)]);
    const { stream, latest, clock } = setup(fetchJobs);

    stream.start();
    latest().emit("snapshot", [job(1)]);
    latest().error();

    await clock.advance(2000);
    expect(fetchJobs).toHaveBeenCalledTimes(1);
  });

  it("leaves a done row 4 s after it finishes", async () => {
    const { stream, latest, clock, updates } = setup();

    stream.start();
    latest().emit("snapshot", [job(1)]);
    latest().emit(
      "job",
      job(1, {
        status: "done",
        finishedAt: new Date(clock.now()).toISOString(),
      })
    );
    expect(updates.at(-1)?.has(1)).toBe(true);

    await clock.advance(3999);
    expect(updates.at(-1)?.has(1)).toBe(true);

    await clock.advance(1);
    expect(updates.at(-1)?.has(1)).toBe(false);
  });

  it("closes the stream on hide and reopens it on show", () => {
    const { stream, sources, latest } = setup();

    stream.start();
    expect(sources).toHaveLength(1);

    stream.setVisible(false);
    expect(latest().closed).toBe(true);

    stream.setVisible(true);
    expect(sources).toHaveLength(2);
    expect(latest().closed).toBe(false);
  });

  it("drops a fallback read that resolves after the stream has reconnected", async () => {
    // Definite-assignment rather than `| null`: the executor below runs
    // synchronously, but the checker cannot see that and would narrow a
    // nullable binding to `null` at every later read.
    let resolveFetch!: (jobs: Job[]) => void;
    const fetchJobs = mock(
      () =>
        new Promise<Job[]>((resolve) => {
          resolveFetch = resolve;
        })
    );
    const { stream, latest, clock, updates } = setup(fetchJobs);

    stream.start();
    latest().emit("snapshot", [job(1, { status: "running" })]);
    latest().error();

    // The fallback fires at 2 s and its read is still in flight when the
    // stream reconnects (a hide/show cycle opens a fresh source).
    await clock.advance(2000);
    expect(fetchJobs).toHaveBeenCalledTimes(1);
    stream.setVisible(false);
    stream.setVisible(true);

    latest().emit("snapshot", [
      job(1, {
        status: "done",
        finishedAt: new Date(clock.now()).toISOString(),
      }),
    ]);
    expect(updates.at(-1)?.get(1)?.status).toBe("done");

    resolveFetch([job(1, { status: "running" })]);
    await Promise.resolve();
    await Promise.resolve();

    // The stale fetch must not resurrect the finished job, and it must not
    // schedule another read next to the now-healthy stream.
    expect(updates.at(-1)?.get(1)?.status).toBe("done");
    await clock.advance(2000);
    expect(fetchJobs).toHaveBeenCalledTimes(1);
  });

  it("stops the fallback poll once the 30 s retry opens a new stream", async () => {
    const pending: ((jobs: Job[]) => void)[] = [];
    const fetchJobs = mock(
      () => new Promise<Job[]>((resolve) => pending.push(resolve))
    );
    const { stream, latest, clock, updates, sources } = setup(fetchJobs);

    stream.start();
    latest().emit("snapshot", [job(1, { status: "running" })]);
    latest().error();

    // Each fallback read resolves as soon as it is made, until the retry.
    for (let elapsed = 0; elapsed < 30_000 - 2000; elapsed += 2000) {
      await clock.advance(2000);
      pending.shift()?.([job(1, { status: "running" })]);
    }
    const readsBeforeRetry = fetchJobs.mock.calls.length;

    await clock.advance(2000);
    expect(sources).toHaveLength(2);

    latest().emit("snapshot", [
      job(1, {
        status: "done",
        finishedAt: new Date(clock.now()).toISOString(),
      }),
    ]);
    for (const resolve of pending.splice(0)) {
      resolve([job(1, { status: "running" })]);
    }
    await Promise.resolve();
    await Promise.resolve();

    expect(updates.at(-1)?.get(1)?.status).toBe("done");
    await clock.advance(4000);
    expect(fetchJobs.mock.calls.length).toBe(readsBeforeRetry);
  });

  it("reports unloaded until the first read lands, then stays loaded", () => {
    const { stream, latest } = setup();

    expect(stream.hasLoaded()).toBe(false);
    stream.start();
    expect(stream.hasLoaded()).toBe(false);

    latest().emit("snapshot", [job(1)]);
    expect(stream.hasLoaded()).toBe(true);
  });
});
