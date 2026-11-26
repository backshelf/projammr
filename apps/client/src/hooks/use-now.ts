"use client";

import { useEffect, useState } from "react";

/**
 * The current time in milliseconds, refreshed every `intervalMs`. Local to
 * whatever calls it — a row ticking its own elapsed time — rather than a
 * shared provider, so the tick re-renders that row alone and nothing above it.
 */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}
