"use client";

import type { TableSearchParams } from "@/lib/table-params";
import { useCallback, useEffect, useMemo, useState } from "react";

import { SEARCH_DEBOUNCE_MS, useTableViewState } from "./use-table-url-state";

/**
 * Table view state kept entirely in React, in the same shape
 * `useTableUrlState` returns, for a table that must leave the URL alone. An
 * embedded table shares the address bar with the page's own table, so its view
 * state cannot live there without the two overwriting each other.
 *
 * The URL source debounces the search box before it writes the URL, which is
 * what actually triggers a server-owned table's refetch; this source has no
 * URL to debounce, so a keystroke would otherwise reach `serverPage.load`
 * (and the window's view key) immediately. `viewParams` debounces the search
 * term it reports on the same delay instead — the input itself still reads
 * the live value, so typing stays responsive.
 */
export function useTableLocalState() {
  const { view } = useTableViewState();
  const { globalFilter } = view.state;
  const [debouncedFilter, setDebouncedFilter] = useState(globalFilter);

  useEffect(() => {
    const timer = setTimeout(
      () => setDebouncedFilter(globalFilter),
      SEARCH_DEBOUNCE_MS
    );
    return () => clearTimeout(timer);
  }, [globalFilter]);

  const viewParams = useCallback((): TableSearchParams => {
    const params = view.viewParams();
    if (debouncedFilter) params.q = debouncedFilter;
    else delete params.q;
    return params;
  }, [view, debouncedFilter]);

  // The root's memos key on the source, so it keeps its identity for as long
  // as the view and the debounced search do.
  return useMemo(() => ({ ...view, viewParams }), [view, viewParams]);
}
