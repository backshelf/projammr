import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
  mock,
} from "bun:test";
import { createFinishWatch } from "@/components/jobs/jobs-poll";
import { ANALYSIS_KINDS } from "@/components/track-audio/analysis-kinds";
import type { Job, JobKind, JobStatus } from "@workspace/api/api";
import { advanceTimersByTimeAsync } from "@workspace/test/timers";

// The module is the hooks' home as well as the cache's; the hooks' provider
// has no place in a test that only drives the cache.
mock.module("@/components/jobs/JobsProvider", () => ({
  useJobsFinish: () => {},
}));

const getMeasure = mock();
mock.module("@/lib/client-api", () => ({
  clientGetTrackAudioMeasure: getMeasure,
  clientGetTrackAudioDiff: mock(),
}));

const {
  createMeasurementStore,
  loadTrackAudioMeasure,
  measurementKey,
  MEASUREMENT_RETRY_DELAYS_MS,
} = await import("./measures");

const fetchOne = mock();
const job = (id: number, kind: JobKind, status: JobStatus) =>
  ({ id, kind, status }) as Job;
const newStore = () => createMeasurementStore(fetchOne, "Not measured yet");

describe("createMeasurementStore", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    fetchOne.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("retries a 404 at 3, 6, 12 and 24 seconds until the value arrives", async () => {
    fetchOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce([0.1, 0.2]);

    const value = newStore().load(1);
    await advanceTimersByTimeAsync(0);
    expect(fetchOne).toHaveBeenCalledTimes(1);

    for (const [index, delay] of MEASUREMENT_RETRY_DELAYS_MS.entries()) {
      await advanceTimersByTimeAsync(delay - 1);
      expect(fetchOne).toHaveBeenCalledTimes(index + 1);
      await advanceTimersByTimeAsync(1);
      expect(fetchOne).toHaveBeenCalledTimes(index + 2);
    }

    await expect(value).resolves.toEqual([0.1, 0.2]);
    expect(MEASUREMENT_RETRY_DELAYS_MS).toEqual([3000, 6000, 12000, 24000]);
  });

  it("gives up after four retries and lets the next call start over", async () => {
    fetchOne.mockResolvedValue(null);
    const store = newStore();

    const value = store.load(2);
    // Handled now so the rejection is not reported as unhandled while the
    // timers run; bun's `rejects` blocks until the promise settles, so it can
    // only be asserted once they have.
    value.catch(() => {});
    await advanceTimersByTimeAsync(3000 + 6000 + 12000 + 24000);
    await expect(value).rejects.toThrow("Not measured yet");
    expect(fetchOne).toHaveBeenCalledTimes(5);

    fetchOne.mockResolvedValueOnce([0.5]);
    await expect(store.load(2)).resolves.toEqual([0.5]);
  });

  it("does not retry any other error", async () => {
    fetchOne.mockResolvedValue({ error: "Forbidden" });

    await expect(newStore().load(3)).rejects.toThrow("Forbidden");
    expect(fetchOne).toHaveBeenCalledTimes(1);
  });

  it("shares one request between callers and serves later ones from cache", async () => {
    fetchOne.mockResolvedValue([0.3]);
    const store = newStore();

    const [first, second] = await Promise.all([store.load(4), store.load(4)]);
    await store.load(4);

    expect(first).toEqual([0.3]);
    expect(second).toBe(first);
    expect(fetchOne).toHaveBeenCalledTimes(1);
  });

  it("grows the snapshot as values land and hands the same map back until one does", async () => {
    fetchOne.mockResolvedValueOnce([0.1]).mockResolvedValueOnce([0.2]);
    const store = newStore();
    const key = measurementKey([5, 6]);

    const empty = store.snapshot(key);
    expect(empty.size).toBe(0);
    expect(store.snapshot(key)).toBe(empty);

    await store.load(5);
    expect(store.snapshot(key).size).toBe(1);
    await store.load(6);
    expect([...store.snapshot(key)]).toEqual([
      [5, [0.1]],
      [6, [0.2]],
    ]);
  });

  it("asks once per missing id and leaves the loaded ones alone", async () => {
    fetchOne.mockResolvedValue([0.4]);
    const store = newStore();
    await store.load(7);

    store.loadMissing(measurementKey([7, 8, 9]));
    await advanceTimersByTimeAsync(0);

    expect(fetchOne).toHaveBeenCalledTimes(3);
    expect(fetchOne.mock.calls.map(([id]) => id)).toEqual([7, 8, 9]);
  });

  it("asks again when asked after the ladder has given up", async () => {
    fetchOne.mockResolvedValue(null);
    const store = newStore();
    const key = measurementKey([10]);

    store.loadMissing(key);
    await advanceTimersByTimeAsync(3000 + 6000 + 12000 + 24000);
    expect(fetchOne).toHaveBeenCalledTimes(5);

    fetchOne.mockResolvedValue([0.6]);
    // What a finished analysis job does once the ladder has given up.
    store.loadMissing(key);
    await advanceTimersByTimeAsync(0);

    expect(fetchOne).toHaveBeenCalledTimes(6);
    expect(store.snapshot(key).get(10)).toEqual([0.6]);
  });

  it("fills in a value that lands after the ladder ran out once its version's job finishes, while other analysis still runs", async () => {
    fetchOne.mockResolvedValue(null);
    const store = newStore();
    const key = measurementKey([13]);
    const observe = createFinishWatch(ANALYSIS_KINDS, () =>
      store.loadMissing(key)
    );
    const backfill = job(1, "audio_backfill", "running");

    store.loadMissing(key);
    observe([job(2, "audio_analysis", "running"), backfill]);
    await advanceTimersByTimeAsync(3000 + 6000 + 12000 + 24000);
    expect(fetchOne).toHaveBeenCalledTimes(5);
    expect(store.snapshot(key).size).toBe(0);

    fetchOne.mockResolvedValue([0.8]);
    // Version 13's own job is done; the project's backfill is still going.
    observe([backfill]);
    await advanceTimersByTimeAsync(0);

    expect(store.snapshot(key).get(13)).toEqual([0.8]);
  });

  it("reads once more when a job finishes while the ladder's last read is out", async () => {
    let answer: (value: null) => void = () => {};
    fetchOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockImplementationOnce(
        () => new Promise<null>((resolve) => (answer = resolve))
      )
      .mockResolvedValue([0.9]);
    const store = newStore();
    const key = measurementKey([14]);

    store.loadMissing(key);
    await advanceTimersByTimeAsync(3000 + 6000 + 12000 + 24000);
    expect(fetchOne).toHaveBeenCalledTimes(5);

    // The read was answered from the database before the job stored its
    // result, and its 404 reaches the page only after the job has finished.
    store.loadMissing(key);
    answer(null);
    await advanceTimersByTimeAsync(0);

    expect(fetchOne).toHaveBeenCalledTimes(6);
    expect(store.snapshot(key).get(14)).toEqual([0.9]);
  });

  it("notifies its subscribers when a value lands, and stops after unsubscribe", async () => {
    fetchOne.mockResolvedValue([0.7]);
    const store = newStore();
    const listener = mock();

    const unsubscribe = store.subscribe(listener);
    await store.load(11);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    await store.load(12);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("loadTrackAudioMeasure", () => {
  beforeEach(() => {
    getMeasure.mockReset();
  });

  it("fetches a version's value through the measure endpoint, by name", async () => {
    getMeasure.mockResolvedValue([0.1, 0.2]);

    await expect(loadTrackAudioMeasure(20, "peaks")).resolves.toEqual([
      0.1, 0.2,
    ]);
    expect(getMeasure).toHaveBeenCalledWith(20, "peaks");
  });

  it("keeps one measure's cache apart from another's for the same version", async () => {
    const curve = { hz: [20, 200, 2000], db: [-40, -40, -40] };
    getMeasure.mockImplementation((_id: number, measure: string) =>
      Promise.resolve(measure === "peaks" ? [0.3] : curve)
    );

    const [peaks, spectrum] = await Promise.all([
      loadTrackAudioMeasure(21, "peaks"),
      loadTrackAudioMeasure(21, "spectrum"),
    ]);

    expect(peaks).toEqual([0.3]);
    expect(spectrum).toEqual(curve);
    expect(getMeasure).toHaveBeenCalledTimes(2);
  });
});
