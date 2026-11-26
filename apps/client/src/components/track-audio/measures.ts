"use client";

import { useJobsFinish } from "@/components/jobs/JobsProvider";
import { ANALYSIS_KINDS } from "@/components/track-audio/analysis-kinds";
import {
  clientGetTrackAudioDiff,
  clientGetTrackAudioMeasure,
} from "@/lib/client-api";
import {
  isActionError,
  type ActionError,
} from "@workspace/api/lib/action-result";
import type { MeasureName } from "@workspace/api/lib/enums";
import type { TrackAudioDiff } from "@workspace/api/api";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

/** How long to wait before each retry of a version the server has no
 *  measurement for yet. Its 404 queues the analysis, so the value fills in on
 *  a later try without anything having to remount. */
export const MEASUREMENT_RETRY_DELAYS_MS = [3000, 6000, 12000, 24000];

/** The identity a list of versions is cached and memoised under. */
export const measurementKey = (trackAudioIds: readonly number[]) =>
  trackAudioIds.join(",");

const idsOf = (key: string) => (key === "" ? [] : key.split(",").map(Number));

const wait = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export type MeasurementStore<T> = {
  /** Fetches once for the page's life; a failure evicts so the next call tries again. */
  load: (trackAudioId: number) => Promise<T>;
  /** Asks for every id under `key` that has not landed, ignoring failures. An
   *  id already being fetched reads once more before its ladder gives up. */
  loadMissing: (key: string) => void;
  subscribe: (listener: () => void) => () => void;
  /** The values that have landed under `key`, the same map until one more does. */
  snapshot: (key: string) => ReadonlyMap<number, T>;
};

type LazyMeasurement<T> = {
  load: MeasurementStore<T>["load"];
  /** The stored value, null until it arrives or when `trackAudioId` is null. */
  use: (trackAudioId: number | null) => T | null;
  /** Every value that has landed among `trackAudioIds`, on one subscription. */
  useMany: (trackAudioIds: number[]) => ReadonlyMap<number, T>;
};

/**
 * The cache behind a lazy measurement: one entry per version for the page's
 * life, a retry ladder over the 404 the server answers with while the
 * analysis has not run, and one request per version however many readers ask.
 *
 * Snapshots are memoised per id list so a reader that re-renders for another
 * reason is handed the same map back.
 */
export function createMeasurementStore<T>(
  fetchOne: (trackAudioId: number) => Promise<T | null | ActionError>,
  missing: string
): MeasurementStore<T> {
  const loaded = new Map<number, T>();
  const inFlight = new Map<number, Promise<T>>();
  /** In-flight ids asked for again since their latest read went out: that
   *  read may predate the value, so a 404 from it is not the last word. */
  const askedAgain = new Set<number>();
  const listeners = new Set<() => void>();
  const snapshots = new Map<
    string,
    { version: number; map: ReadonlyMap<number, T> }
  >();
  /** Bumped on every arrival, so a memoised snapshot knows it is stale. */
  let version = 0;

  async function fetchWithRetries(trackAudioId: number): Promise<T> {
    const delays = [...MEASUREMENT_RETRY_DELAYS_MS];
    for (;;) {
      askedAgain.delete(trackAudioId);
      const result = await fetchOne(trackAudioId);
      if (result !== null) {
        if (isActionError(result)) throw new Error(result.error);
        return result;
      }
      if (askedAgain.has(trackAudioId)) continue;
      const delay = delays.shift();
      if (delay === undefined) throw new Error(missing);
      await wait(delay);
    }
  }

  function load(trackAudioId: number): Promise<T> {
    const done = loaded.get(trackAudioId);
    if (done !== undefined) return Promise.resolve(done);

    const pending = inFlight.get(trackAudioId);
    if (pending) return pending;

    const promise = fetchWithRetries(trackAudioId)
      .then((value) => {
        loaded.set(trackAudioId, value);
        version++;
        for (const listener of listeners) listener();
        return value;
      })
      .finally(() => {
        inFlight.delete(trackAudioId);
        askedAgain.delete(trackAudioId);
      });
    inFlight.set(trackAudioId, promise);
    return promise;
  }

  return {
    load,

    loadMissing: (key) => {
      for (const id of idsOf(key)) {
        if (loaded.has(id)) continue;
        if (inFlight.has(id)) askedAgain.add(id);
        else void load(id).catch(() => {});
      }
    },

    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    snapshot: (key) => {
      const memo = snapshots.get(key);
      if (memo && memo.version === version) return memo.map;

      const map = new Map<number, T>();
      for (const id of idsOf(key)) {
        const value = loaded.get(id);
        if (value !== undefined) map.set(id, value);
      }
      snapshots.set(key, { version, map });
      return map;
    },
  };
}

/** What a server render sees: nothing has been fetched there. */
const NONE: ReadonlyMap<number, never> = new Map<number, never>();

/**
 * A per-version measurement the server serves lazily and answers 404 for
 * until its analysis has run: peaks, a spectrum, or any other entry in the
 * server's measure registry. One cache per measurement serves every reader on
 * the page, so a remount draws at once and two blocks watching the same
 * version share one request.
 *
 * Besides the retry ladder, a missing value is asked for again whenever one
 * of the project's analysis jobs finishes, so a version whose analysis outlasts
 * the ladder fills in without a remount, even while other analysis is still
 * running.
 */
function createTrackAudioMeasurement<T>(
  fetchOne: (trackAudioId: number) => Promise<T | null | ActionError>,
  missing: string
): LazyMeasurement<T> {
  const store = createMeasurementStore(fetchOne, missing);

  function useMany(trackAudioIds: number[]): ReadonlyMap<number, T> {
    const key = measurementKey(trackAudioIds);

    const values = useSyncExternalStore(
      store.subscribe,
      useCallback(() => store.snapshot(key), [key]),
      () => NONE as ReadonlyMap<number, T>
    );

    useEffect(() => store.loadMissing(key), [key]);
    useJobsFinish(
      ANALYSIS_KINDS,
      useCallback(() => store.loadMissing(key), [key])
    );

    return values;
  }

  function useOne(trackAudioId: number | null): T | null {
    const values = useMany(trackAudioId === null ? [] : [trackAudioId]);
    return trackAudioId === null ? null : (values.get(trackAudioId) ?? null);
  }

  return { load: store.load, use: useOne, useMany };
}

/**
 * One lazy measurement per measure name, built the first time it is asked
 * for, so a page that never reads `spectrum` never allocates its cache. Every
 * caller of one measure shares the same store, the same way the old
 * per-measure hooks did.
 */
const measurementsByName = new Map<MeasureName, LazyMeasurement<unknown>>();

function measurementFor<T>(measure: MeasureName): LazyMeasurement<T> {
  let instance = measurementsByName.get(measure);
  if (!instance) {
    instance = createTrackAudioMeasurement(
      (trackAudioId) =>
        clientGetTrackAudioMeasure<unknown>(trackAudioId, measure),
      `${measure} is not available yet`
    );
    measurementsByName.set(measure, instance);
  }
  return instance as LazyMeasurement<T>;
}

/**
 * Fetches one version's value for a measure once for the page's life; a
 * failure evicts the entry, so the next caller tries again instead of
 * replaying the failure.
 */
export function loadTrackAudioMeasure<T>(
  trackAudioId: number,
  measure: MeasureName
): Promise<T> {
  return measurementFor<T>(measure).load(trackAudioId);
}

/**
 * A version's stored value for one of the server's measures, null until it
 * arrives or when `trackAudioId` is null. `T` is the caller's own knowledge
 * of the measure's shape (`number[]` for `peaks`, `Spectrum` for `spectrum`,
 * …) — the registry itself lives on the server.
 */
export function useTrackAudioMeasure<T>(
  trackAudioId: number | null,
  measure: MeasureName
): T | null {
  return measurementFor<T>(measure).use(trackAudioId);
}

/** Every stored value for one measure among `trackAudioIds` that has landed,
 *  on one subscription, for a block that draws a whole version list at once. */
export function useTrackAudioMeasures<T>(
  trackAudioIds: number[],
  measure: MeasureName
): ReadonlyMap<number, T> {
  return measurementFor<T>(measure).useMany(trackAudioIds);
}

/** The pair a diff read is keyed on, or null when either side is missing one. */
const diffPairKey = (trackAudioId: number | null, otherId: number | null) =>
  trackAudioId === null || otherId === null
    ? null
    : `${trackAudioId}:${otherId}`;

/**
 * The stored comparison between two versions of the same track, null until it
 * loads, resolves to nothing, or either id is null. Unlike a measure, a
 * missing diff is the server's real answer rather than a queued job, so this
 * is a plain fetch with no retry ladder.
 */
export function useTrackAudioDiff(
  trackAudioId: number | null,
  otherId: number | null
): TrackAudioDiff | null {
  const pair = diffPairKey(trackAudioId, otherId);
  const [state, setState] = useState<{
    pair: string | null;
    diff: TrackAudioDiff | null;
  }>({ pair: null, diff: null });

  // A new pair's diff has not loaded yet; setting this during render (rather
  // than in the effect below) avoids the extra committed frame a `null` reset
  // in the effect would otherwise force.
  if (state.pair !== pair) setState({ pair, diff: null });

  useEffect(() => {
    if (pair === null || trackAudioId === null || otherId === null) return;

    let cancelled = false;
    void clientGetTrackAudioDiff(trackAudioId, otherId).then((result) => {
      if (cancelled || result === null || isActionError(result)) return;
      setState((prev) => (prev.pair === pair ? { pair, diff: result } : prev));
    });
    return () => {
      cancelled = true;
    };
  }, [pair, trackAudioId, otherId]);

  return state.diff;
}
