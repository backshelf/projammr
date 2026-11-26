"use client";

import { browserApi } from "@/lib/browser-api";
import type {
  RhymeResult,
  SynonymResult,
  WordAnalysis,
} from "@workspace/api/api";
import type {
  LyricsDictionary,
  RhymeEntry,
  SynonymSense,
} from "@workspace/ui/components/block-editor/lyrics/context";

const analysed = new Map<string, WordAnalysis>();
const inFlight = new Map<string, Promise<WordAnalysis>>();

const key = (word: string) => word.toLowerCase();

/**
 * Caches one GET endpoint's result per lowercased word behind a
 * `Map<string, Promise<T>>`. Two overlapping calls for the same word share
 * the one request in flight; a rejected call evicts its entry so the next
 * call retries instead of replaying the failure forever.
 */
function memoisedGet<T>(
  fetchOne: (word: string, signal?: AbortSignal) => Promise<T>
): (word: string, signal?: AbortSignal) => Promise<T> {
  const cache = new Map<string, Promise<T>>();

  return (word, signal) => {
    const k = key(word);
    const cached = cache.get(k);
    if (cached) return cached;

    const promise = fetchOne(k, signal);
    cache.set(k, promise);
    promise.catch(() => cache.delete(k));
    return promise;
  };
}

/**
 * The lyrics dictionary as `apps/client` implements it: batched syllable and
 * rhyme-key analysis, plus per-word rhyme and synonym lookups, all against
 * `/api/lyrics/*` through the browser API client. `packages/ui` only knows
 * the {@link LyricsDictionary} interface — this is the concrete
 * implementation a `LyricsProvider` hands it.
 */
export const browserLyricsDictionary: LyricsDictionary = {
  async analyze(words) {
    const missing = [...new Set(words.map(key))].filter(
      (w) => !analysed.has(w) && !inFlight.has(w)
    );

    if (missing.length) {
      const batch = browserApi
        .POST("/api/lyrics/analyze", { body: { words: missing } })
        .then(({ data }) => {
          for (const entry of data?.words ?? [])
            analysed.set(key(entry.word), entry);
        })
        .finally(() => missing.forEach((w) => inFlight.delete(w)));

      for (const w of missing) {
        inFlight.set(
          w,
          batch.then(() => analysed.get(w)!)
        );
      }
    }

    await Promise.all(
      words.map((w) => inFlight.get(key(w)) ?? Promise.resolve())
    );

    return words
      .map((w) => analysed.get(key(w)))
      .filter((e): e is WordAnalysis => !!e);
  },

  rhymes: memoisedGet<{ perfect: RhymeEntry[]; near: RhymeEntry[] }>(
    async (word, signal) => {
      const { data } = await browserApi.GET("/api/lyrics/rhymes", {
        params: { query: { word } },
        signal,
      });
      if (!data) throw new Error("Failed to fetch rhymes");
      const result: RhymeResult = data;
      return { perfect: result.perfect, near: result.near };
    }
  ),

  synonyms: memoisedGet<SynonymSense[]>(async (word, signal) => {
    const { data } = await browserApi.GET("/api/lyrics/synonyms", {
      params: { query: { word } },
      signal,
    });
    if (!data) throw new Error("Failed to fetch synonyms");
    const result: SynonymResult = data;
    return result.senses;
  }),
};
