"use client";

import {
  TABLE_PARAM,
  filterViewQuery,
  filtersFromState,
  isFilterParam,
  type TableSearchParams,
} from "@/lib/table-params";
import { usePathname, useRouter } from "next/navigation";
import { useHydrated } from "@workspace/ui/hooks/use-hydrated";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * How long a debounced search write waits before it takes effect in
 * server-owned mode, where it fires a real navigation (and so a real
 * `serverPage.load`). `use-table-local-state.ts` mirrors this for the same
 * search box on a table with no URL to debounce.
 */
export const SEARCH_DEBOUNCE_MS = 300;

type SortingState = Array<{ id: string; desc: boolean }>;
type ColumnVisibilityState = Record<string, boolean>;
type ColumnOrderState = string[];
type ColumnSizingState = Record<string, number>;
/** Grouping: the ordered column ids the table is grouped by (usually 0 or 1). */
type GroupingState = string[];
/** Server-side column filters by param, each value as the URL spells it: a
 * declared filter (`status`, `daw`, `explicit`, …) or a custom field's
 * (`cf_<id>`). An absent key means that filter is off. */
export type ColumnFilterState = Record<string, string>;

function parseSorting(raw: string | null): SortingState {
  if (!raw) return [];
  return raw
    .split(",")
    .map((part) => {
      const [id, dir] = part.split(".");
      if (!id) return null;
      return { id, desc: dir === "desc" };
    })
    .filter((s): s is { id: string; desc: boolean } => s !== null);
}

function serializeSorting(sorting: SortingState): string {
  return sorting.map((s) => `${s.id}.${s.desc ? "desc" : "asc"}`).join(",");
}

/** `cols=-isrc,-iswc` — a leading `-` marks a hidden column; everything else is
 * visible by default, so only the exceptions travel in the URL. */
function parseVisibility(raw: string | null): ColumnVisibilityState {
  if (!raw) return {};
  const out: ColumnVisibilityState = {};
  for (const part of raw.split(",")) {
    if (part.startsWith("-")) out[part.slice(1)] = false;
    else if (part) out[part] = true;
  }
  return out;
}

function serializeVisibility(state: ColumnVisibilityState): string {
  return Object.entries(state)
    .map(([id, visible]) => (visible ? id : `-${id}`))
    .join(",");
}

function parseOrder(raw: string | null): ColumnOrderState {
  return raw ? raw.split(",").filter(Boolean) : [];
}

function parseGrouping(raw: string | null): GroupingState {
  return raw ? raw.split(",").filter(Boolean) : [];
}

/** `w=title:240,bpm:80` — only resized columns are listed. */
function parseSizing(raw: string | null): ColumnSizingState {
  if (!raw) return {};
  const out: ColumnSizingState = {};
  for (const part of raw.split(",")) {
    const [id, px] = part.split(":");
    const n = Number(px);
    if (id && Number.isFinite(n)) out[id] = n;
  }
  return out;
}

function serializeSizing(state: ColumnSizingState): string {
  return Object.entries(state)
    .map(([id, px]) => `${id}:${Math.round(px)}`)
    .join(",");
}

function readParams(): URLSearchParams {
  if (typeof window === "undefined") return new URLSearchParams();
  return new URLSearchParams(window.location.search);
}

type State = {
  globalFilter: string;
  sorting: SortingState;
  columnVisibility: ColumnVisibilityState;
  columnOrder: ColumnOrderState;
  columnSizing: ColumnSizingState;
  columnFilters: ColumnFilterState;
  grouping: GroupingState;
};

function stateFromParams(params: URLSearchParams): State {
  const columnFilters: ColumnFilterState = {};
  for (const [key, value] of params) {
    if (value && isFilterParam(key)) columnFilters[key] = value;
  }
  return {
    globalFilter: params.get(TABLE_PARAM.search) ?? "",
    sorting: parseSorting(params.get(TABLE_PARAM.sort)),
    columnVisibility: parseVisibility(params.get(TABLE_PARAM.visibility)),
    columnOrder: parseOrder(params.get(TABLE_PARAM.order)),
    columnSizing: parseSizing(params.get(TABLE_PARAM.sizing)),
    columnFilters,
    grouping: parseGrouping(params.get(TABLE_PARAM.grouping)),
  };
}

/** The view part of `state` (search, sort, filters, grouping) as `serverPage.load` takes it. */
function viewParamsOf(state: State): TableSearchParams {
  const out: TableSearchParams = filtersFromState(state.columnFilters);
  if (state.globalFilter) out.q = state.globalFilter;
  const sort = serializeSorting(state.sorting);
  if (sort) out.sort = sort;
  const grouping = state.grouping.join(",");
  if (grouping) out.group = grouping;
  return out;
}

/**
 * The view the location's query names, in the same shape as a table's
 * `viewParams()`: what the server rendered a URL table's rows for.
 */
export function locationViewParams(): TableSearchParams {
  return viewParamsOf(stateFromParams(readParams()));
}

/**
 * A table's view state held in React: search, sort, per-column server
 * filters, grouping and the column layout (visibility, order, sizing), with
 * the setters a table wires to it and the query-string form a saved view
 * stores. It never reads or writes the URL. Each setter records how its change
 * would reach the URL, for `useTableUrlState` to read when it mirrors the state
 * there.
 */
export function useTableViewState() {
  // Start from feature defaults so server and first client render match; a
  // URL-backed table adopts the URL's state after hydration.
  const [state, setState] = useState<State>(() => ({
    globalFilter: "",
    sorting: [],
    columnVisibility: {},
    columnOrder: [],
    columnSizing: {},
    columnFilters: {},
    grouping: [],
  }));

  // Whether the next URL write should replace rather than push. The search box
  // sets this so debounced typing doesn't spam history; every other change
  // leaves it "push" so back returns to the prior view.
  const replaceNextRef = useRef(false);

  // Whether the next write is a column-layout-only change: the server does not
  // read those params, so a full navigation (RSC refetch) would be wasted work.
  const layoutOnlyRef = useRef(false);

  const setGlobalFilter = useCallback((next: unknown) => {
    replaceNextRef.current = true;
    layoutOnlyRef.current = false;
    setState((prev) => {
      const value =
        typeof next === "function"
          ? (next as (v: string) => unknown)(prev.globalFilter)
          : next;
      return {
        ...prev,
        globalFilter: value == null ? "" : String(value),
      };
    });
  }, []);

  const setSorting = useCallback((next: unknown) => {
    replaceNextRef.current = false;
    layoutOnlyRef.current = false;
    setState((prev) => ({
      ...prev,
      sorting:
        typeof next === "function"
          ? (next as (v: SortingState) => SortingState)(prev.sorting)
          : (next as SortingState),
    }));
  }, []);

  const setColumnFilter = useCallback((id: string, value: string | null) => {
    replaceNextRef.current = false;
    layoutOnlyRef.current = false;
    setState((prev) => {
      const columnFilters = { ...prev.columnFilters };
      if (value == null || value === "") delete columnFilters[id];
      else columnFilters[id] = value;
      return {
        ...prev,
        columnFilters,
      };
    });
  }, []);

  // "Show all of this group": clears grouping and pins the group's own filter,
  // landing on the ordinary paginated list scoped to that one group.
  const drillIntoGroup = useCallback((filterParam: string, value: string) => {
    replaceNextRef.current = false;
    layoutOnlyRef.current = false;
    setState((prev) => ({
      ...prev,
      grouping: [],
      columnFilters: { ...prev.columnFilters, [filterParam]: value },
    }));
  }, []);

  const setColumnVisibility = useCallback((next: unknown) => {
    replaceNextRef.current = false;
    layoutOnlyRef.current = true;
    setState((prev) => ({
      ...prev,
      columnVisibility:
        typeof next === "function"
          ? (next as (v: ColumnVisibilityState) => ColumnVisibilityState)(
              prev.columnVisibility
            )
          : (next as ColumnVisibilityState),
    }));
  }, []);

  const setColumnOrder = useCallback((next: unknown) => {
    replaceNextRef.current = false;
    layoutOnlyRef.current = true;
    setState((prev) => ({
      ...prev,
      columnOrder:
        typeof next === "function"
          ? (next as (v: ColumnOrderState) => ColumnOrderState)(
              prev.columnOrder
            )
          : (next as ColumnOrderState),
    }));
  }, []);

  // The server orders and counts rows by the grouping key, so a change must
  // navigate (RSC refetch) and return to the first page.
  const setGrouping = useCallback((next: unknown) => {
    replaceNextRef.current = false;
    layoutOnlyRef.current = false;
    setState((prev) => ({
      ...prev,
      grouping:
        typeof next === "function"
          ? (next as (v: GroupingState) => GroupingState)(prev.grouping)
          : (next as GroupingState),
    }));
  }, []);

  const setColumnSizing = useCallback((next: unknown) => {
    // Resizing fires this on every pointer move; replace so a drag produces one
    // history entry, not hundreds.
    replaceNextRef.current = true;
    layoutOnlyRef.current = true;
    setState((prev) => ({
      ...prev,
      columnSizing:
        typeof next === "function"
          ? (next as (v: ColumnSizingState) => ColumnSizingState)(
              prev.columnSizing
            )
          : (next as ColumnSizingState),
    }));
  }, []);

  /**
   * Replaces the whole view — every filter/sort/layout/grouping param — with
   * the ones encoded in a saved view's query string. Params the saved view
   * does not mention are cleared; `filterViewQuery` keeps only view params, so
   * a stored `page` is dropped. In server mode this
   * refetches (filters and sort are server-read).
   */
  const applyViewQuery = useCallback((query: string) => {
    replaceNextRef.current = false;
    layoutOnlyRef.current = false;
    const params = new URLSearchParams(filterViewQuery(query));
    setState(stateFromParams(params));
  }, []);

  // The current view as a query string — filter/sort/layout/grouping only,
  // transient state excluded. This is what "save view" persists.
  const viewQuery = useCallback(() => {
    const params = new URLSearchParams();
    if (state.globalFilter) params.set(TABLE_PARAM.search, state.globalFilter);
    const sort = serializeSorting(state.sorting);
    if (sort) params.set(TABLE_PARAM.sort, sort);
    for (const [key, value] of Object.entries(state.columnFilters)) {
      if (value) params.set(key, value);
    }
    const visibility = serializeVisibility(state.columnVisibility);
    if (visibility) params.set(TABLE_PARAM.visibility, visibility);
    const order = state.columnOrder.join(",");
    if (order) params.set(TABLE_PARAM.order, order);
    const sizing = serializeSizing(state.columnSizing);
    if (sizing) params.set(TABLE_PARAM.sizing, sizing);
    const grouping = state.grouping.join(",");
    if (grouping) params.set(TABLE_PARAM.grouping, grouping);
    return filterViewQuery(params.toString());
  }, [state]);

  // The typed twin of `viewQuery`: search, sort, filters and grouping, for
  // the root to pass as `serverPage.load`'s `view`. Layout (visibility, order,
  // sizing) and the page position are excluded, same as `viewQuery`.
  const viewParams = useCallback(
    (): TableSearchParams => viewParamsOf(state),
    [state]
  );

  // One object per state: the data table holds it in a memoised context value.
  const view = useMemo(
    () => ({
      state,
      setGlobalFilter,
      setSorting,
      setColumnFilter,
      drillIntoGroup,
      setColumnVisibility,
      setColumnOrder,
      setColumnSizing,
      setGrouping,
      applyViewQuery,
      viewQuery,
      viewParams,
    }),
    [
      state,
      setGlobalFilter,
      setSorting,
      setColumnFilter,
      drillIntoGroup,
      setColumnVisibility,
      setColumnOrder,
      setColumnSizing,
      setGrouping,
      applyViewQuery,
      viewQuery,
      viewParams,
    ]
  );

  return { view, setState, replaceNextRef, layoutOnlyRef };
}

/**
 * Table view state mirrored into the URL query string so it survives
 * navigation and browser back/forward. The state and its setters are
 * `useTableViewState`'s; this hook adopts the URL into them and projects them
 * back onto it.
 *
 * Two modes, selected by `navigate`:
 *
 * - **Client-owned (default).** React state is the source of truth; the table
 *   reads and writes it with no router round-trip, and the URL is a one-way
 *   projection written with `history.pushState` (sort/filter/layout — a
 *   back-navigable entry) or `history.replaceState` (debounced search — no
 *   history spam). Browser back/forward writes back into state via `popstate`.
 *
 * - **Server-owned (`navigate: true`).** The server reads these params and
 *   returns the page, so a change must actually navigate: sort/filter call
 *   `router.push` (new entry, RSC refetch), the debounced search calls
 *   `router.replace`. Column-layout changes only rewrite the URL — the server
 *   ignores them — so they always go through `history` even in this mode.
 *   State is derived from the URL; Next's router owns back/forward.
 *
 * A table that shares the address bar with the page's own table keeps its
 * state with `useTableLocalState` instead, so the two cannot overwrite each
 * other.
 */
export function useTableUrlState({
  navigate = false,
  emptyQuery,
}: {
  navigate?: boolean;
  /** The query a bare URL canonicalises to on first render, in place of a
   *  pathname with no query string at all — a rewrite only, never a
   *  navigation or a refetch. Only `PageEntityTable` passes this. */
  emptyQuery?: string;
} = {}) {
  const { view, setState, replaceNextRef, layoutOnlyRef } = useTableViewState();
  const { state } = view;
  const pathname = usePathname();
  const router = useRouter();

  // Adopt the URL's state once, during the first render after hydration.
  // Reading it any earlier would make the first client render disagree with
  // the server's.
  const hydrated = useHydrated();
  const [adopted, setAdopted] = useState(false);
  if (hydrated && !adopted) {
    setAdopted(true);
    setState(stateFromParams(readParams()));
  }

  // In client-owned mode, re-adopt on browser back/forward; in server-owned
  // mode Next's router re-renders the tree on back/forward, so `popstate`
  // handling would double-apply.
  useEffect(() => {
    if (navigate) return;
    const onPopState = () => {
      setState(stateFromParams(readParams()));
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [navigate, setState]);

  // Project state onto the URL. Sort/filter changes take effect immediately;
  // the search box and column resizing debounce so a burst produces one
  // write.
  const isFirstRunRef = useRef(true);
  useEffect(() => {
    const params = readParams();
    if (state.globalFilter) params.set(TABLE_PARAM.search, state.globalFilter);
    else params.delete(TABLE_PARAM.search);

    const sort = serializeSorting(state.sorting);
    if (sort) params.set(TABLE_PARAM.sort, sort);
    else params.delete(TABLE_PARAM.sort);

    // `page` is not a table param: a `?page=n` from an old link is dropped
    // whenever the URL is projected.
    params.delete("page");

    // A filter the state no longer holds leaves the URL whatever its key, a
    // custom field's having no fixed name to clear it by; one it still holds
    // keeps its place.
    for (const key of [...params.keys()]) {
      if (isFilterParam(key) && !state.columnFilters[key]) params.delete(key);
    }
    for (const [key, value] of Object.entries(state.columnFilters)) {
      if (value) params.set(key, value);
    }

    const visibility = serializeVisibility(state.columnVisibility);
    if (visibility) params.set(TABLE_PARAM.visibility, visibility);
    else params.delete(TABLE_PARAM.visibility);

    const order = state.columnOrder.join(",");
    if (order) params.set(TABLE_PARAM.order, order);
    else params.delete(TABLE_PARAM.order);

    const sizing = serializeSizing(state.columnSizing);
    if (sizing) params.set(TABLE_PARAM.sizing, sizing);
    else params.delete(TABLE_PARAM.sizing);

    const grouping = state.grouping.join(",");
    if (grouping) params.set(TABLE_PARAM.grouping, grouping);
    else params.delete(TABLE_PARAM.grouping);

    // The mount pass adopts the URL's own state — replace, never a new entry.
    // It is consumed even when the URL already matches, which it does when the
    // table mounts after hydration and reads the URL in its first render.
    const isFirstRun = isFirstRunRef.current;
    isFirstRunRef.current = false;

    const qs = params.toString();
    // An empty projection never leaves the URL bare when `emptyQuery` is
    // given — a cleared or reset view names the built-in view explicitly
    // (`view=list`), the same as any other view, so a fresh load never finds
    // a bare URL to redirect.
    const projectedQs = !qs && emptyQuery ? emptyQuery : qs;
    if (projectedQs === window.location.search.replace(/^\?/, "")) return;

    const url = projectedQs ? `${pathname}?${projectedQs}` : pathname;
    const replace = isFirstRun || replaceNextRef.current;
    const isLayoutOnly = layoutOnlyRef.current;
    const delay =
      isFirstRun || !replace ? 0 : navigate ? SEARCH_DEBOUNCE_MS : 150;
    // The mount pass canonicalising a bare URL names the view already
    // rendered — no state changed, so no router navigation and no refetch,
    // just a rewrite. A later empty projection (Reset, clearing every param)
    // is a real state change and goes through the branches below like any
    // other write.
    const isMountCanonicalisation = isFirstRun && !qs && Boolean(emptyQuery);
    replaceNextRef.current = false;
    layoutOnlyRef.current = false;

    const timer = setTimeout(() => {
      if (isMountCanonicalisation) {
        window.history.replaceState(window.history.state, "", url);
      } else if (navigate && !isLayoutOnly) {
        // The server reads these params; a real navigation triggers the RSC
        // refetch. scroll:false keeps the table in view across page changes.
        if (replace) router.replace(url, { scroll: false });
        else router.push(url, { scroll: false });
      } else if (replace) {
        // No router navigation (no RSC refetch, no scroll change);
        // router.push/replace would re-render the tree.
        window.history.replaceState(window.history.state, "", url);
      } else {
        window.history.pushState(window.history.state, "", url);
      }
    }, delay);
    return () => clearTimeout(timer);
  }, [
    state,
    pathname,
    navigate,
    emptyQuery,
    router,
    replaceNextRef,
    layoutOnlyRef,
  ]);

  return view;
}
