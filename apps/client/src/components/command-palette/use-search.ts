"use client";
import { browserApi } from "@/lib/browser-api";
import {
  isActionError,
  toActionResult,
} from "@workspace/api/lib/action-result";
import type { ActionError, Artwork } from "@workspace/api/api";
import { useEffect, useState } from "react";

type SearchResultType = "track" | "collection" | "session" | "asset";

export type SearchResult = {
  type: SearchResultType;
  id: number;
  title: string;
  subtitle: string;
  projectId: number;
  matchedField: string;
  snippet?: string;
  isComment?: boolean;
  image: Artwork | null;
  /** An archived track, or a session or comment of one; ranked last. */
  archived: boolean;
  score: number;
};

export const DEBOUNCE_MS = 150;

export type SearchOptions = {
  types?: SearchResultType[];
  limit?: number;
};

/**
 * Aborting an in-flight request rejects the underlying fetch, so the rejection
 * is caught here and reported as an error the caller discards once it sees the
 * signal is aborted.
 */
export async function clientSearchProject(
  projectId: number,
  q: string,
  signal: AbortSignal,
  options: SearchOptions = {}
): Promise<SearchResult[] | ActionError> {
  try {
    const res = await browserApi.GET("/api/projects/{id}/search", {
      params: {
        path: { id: String(projectId) },
        query: {
          q,
          ...(options.types ? { types: options.types.join(",") } : {}),
          ...(options.limit ? { limit: options.limit } : {}),
        },
      },
      signal,
    });

    return toActionResult(res, "Failed to search");
  } catch {
    return { error: "Failed to search" };
  }
}

/**
 * Debounced, keystroke-rate search against one project. Each new query aborts
 * the previous request — without that, a slow response for an earlier
 * keystroke can arrive after a faster one for a later keystroke and overwrite
 * fresher results with stale ones.
 *
 * `enabled: false` stops the search without moving the hook out of the
 * component, and aborts anything already in flight.
 *
 * While a new query is in flight the previous results stay on screen. The
 * settled results remember the request they answered, so loading is derived
 * as "the current request has no answer yet".
 */
export function useSearch(
  projectId: number | undefined,
  query: string,
  options: SearchOptions & { enabled?: boolean } = {}
) {
  const { enabled = true, limit } = options;
  const typesKey = options.types?.join(",");
  const trimmed = query.trim();
  const active = Boolean(projectId) && trimmed.length > 0 && enabled;
  const requestKey = active
    ? JSON.stringify([projectId, trimmed, typesKey, limit])
    : null;

  const [settled, setSettled] = useState<{
    requestKey: string;
    results: SearchResult[];
  } | null>(null);

  // The previous query's results are stale the moment the query is emptied or
  // the search disabled, so they are dropped during that render rather than
  // resurfacing under the next query.
  if (!active && settled) setSettled(null);

  useEffect(() => {
    if (!projectId || trimmed.length === 0 || !enabled) return;

    const controller = new AbortController();
    const key = JSON.stringify([projectId, trimmed, typesKey, limit]);

    const timeout = setTimeout(async () => {
      const data = await clientSearchProject(
        projectId,
        trimmed,
        controller.signal,
        {
          types: typesKey
            ? (typesKey.split(",") as SearchResultType[])
            : undefined,
          limit,
        }
      );
      if (controller.signal.aborted) return;

      setSettled({
        requestKey: key,
        results: isActionError(data) ? [] : data,
      });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [projectId, trimmed, enabled, typesKey, limit]);

  return {
    results: active ? (settled?.results ?? []) : [],
    isLoading: requestKey !== null && settled?.requestKey !== requestKey,
  };
}
