"use client";

import { readPeekFromUrl, writePeekToUrl } from "@/lib/peek-param";
import { useHydrated } from "@workspace/ui/hooks/use-hydrated";
import { useCallback, useEffect, useState } from "react";

/**
 * The row open in the peek panel.
 *
 * Kept out of `useTableUrlState` on purpose: that hook mediates between React
 * state, Next's router and the params the server reads, and `peek` needs none
 * of that — no server render depends on it, so it is owned here with plain
 * history APIs and never triggers a refetch.
 *
 * `persist` mirrors the open row into the `peek` query param, making a peeked
 * row linkable and closable with the back button. A table that shares a page
 * with another one passes `false` so the two cannot fight over the param.
 */
export function usePeekRow(persist: boolean) {
  // Always starts closed so the first client render matches the server's.
  const [peekId, setPeekId] = useState<number | null>(null);

  // The URL's own value is adopted during the first render after hydration,
  // not in the initial state: reading the URL any earlier would make the first
  // client render disagree with the server's, and the row attributes this
  // drives (`data-peeked`, `aria-expanded`) would then fail hydration.
  const hydrated = useHydrated();
  const adopt = persist && hydrated;
  const [adopted, setAdopted] = useState(false);
  if (adopted !== adopt) {
    setAdopted(adopt);
    if (adopt) setPeekId(readPeekFromUrl());
  }

  useEffect(() => {
    if (!persist) return;
    const onPopState = () => setPeekId(readPeekFromUrl());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [persist]);

  const setPeek = useCallback(
    (rowId: number | null) => {
      setPeekId(rowId);
      if (persist) writePeekToUrl(rowId);
    },
    [persist]
  );

  return [peekId, setPeek] as const;
}
