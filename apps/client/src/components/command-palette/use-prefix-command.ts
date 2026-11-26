"use client";
import {
  matchPrefixCommandCandidates,
  PREFIX_COMMANDS,
  type PrefixCommand,
  type PrefixRow,
} from "@/components/command-palette/action-context";
import type { ActionContext } from "@/components/commands/types";
import { DEBOUNCE_MS } from "@/components/command-palette/use-search";
import { useLatestRef } from "@workspace/ui/hooks/use-latest-ref";
import { useEffect, useMemo, useState } from "react";

/**
 * What a typed line means to the prefix engine, given the prefix command it
 * matched: that match if the command is available here, else the available
 * commands whose prefix the line is still spelling. Availability is decided
 * here once, for the palette and the bar.
 */
export function prefixCandidates(
  match: { command: PrefixCommand; remainder: string } | null,
  query: string,
  ctx: ActionContext
) {
  const available = PREFIX_COMMANDS.filter(
    (command) => command.isAvailable?.(ctx) ?? true
  );
  const activeMatch =
    match && available.some((c) => c.id === match.command.id) ? match : null;
  const candidates = activeMatch
    ? []
    : matchPrefixCommandCandidates(available, query);
  return { activeMatch, candidates };
}

/**
 * Resolves a prefix command's argument. `mode: "async"` commands are
 * debounced and aborted on every keystroke so a slow response for an earlier
 * remainder can never overwrite — or be acted on in place of — a fresher
 * one. `mode: "sync"` commands (a parsed value, a local confirmation) have no
 * round trip to debounce and are recomputed on every keystroke directly.
 *
 * `ctx` is rebuilt on every render, so for the async path it is held in a ref
 * rather than being a dependency — the remainder is what should drive a new
 * round trip. The ref is only read once the debounce has elapsed, by which
 * point the commit that produced the current `ctx` has already updated it.
 *
 * A settled round trip is stored with the command and remainder it answered,
 * so rows for any other query are never shown and loading is simply "the
 * current query has no answer yet".
 */
export function usePrefixCommandResults(
  command: PrefixCommand | null,
  remainder: string,
  ctx: ActionContext
) {
  const [settled, setSettled] = useState<{
    command: PrefixCommand;
    remainder: string;
    rows: PrefixRow[];
  } | null>(null);
  const ctxRef = useLatestRef(ctx);

  const isAsync = command?.mode === "async";
  const asyncActive = isAsync && remainder.length > 0;

  useEffect(() => {
    if (!isAsync || !command || remainder.length === 0) return;

    const controller = new AbortController();

    const timeout = setTimeout(async () => {
      let resolved: PrefixRow[];
      try {
        resolved = await command.resolve(
          remainder,
          ctxRef.current,
          controller.signal
        );
      } catch {
        resolved = [];
      }
      if (controller.signal.aborted) return;
      setSettled({ command, remainder, rows: resolved });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [isAsync, command, remainder, ctxRef]);

  const syncResults = useMemo(() => {
    if (!command || command.mode !== "sync" || remainder.length === 0) {
      return [];
    }
    return command.resolve(remainder, ctx);
  }, [command, remainder, ctx]);

  if (!command) return { results: [], isLoading: false };
  if (command.mode === "sync")
    return { results: syncResults, isLoading: false };
  const answered =
    settled?.command === command && settled.remainder === remainder;
  return {
    results: asyncActive && answered ? settled.rows : [],
    isLoading: asyncActive && !answered,
  };
}
