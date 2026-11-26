"use client";

import type { TableSearchParams } from "@/lib/table-params";
import type { RowData } from "@tanstack/react-table";
import {
  type SetStateAction,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import type { DataTableProps, PageResult } from "./generic-table-types";
import { rowIdOf } from "./row-id";
import { locationViewParams } from "./use-table-url-state";

/** Where the request for the window's next page stands. */
type LoadState = "idle" | "loading" | "error";

/** What the parts read about the rows the table has loaded. */
export type LoadedStatus = {
  /** Rows in the window. */
  count: number;
  /** Whether the server holds rows past the window. */
  hasMore: boolean;
  state: LoadState;
};

/**
 * The rows a table has loaded, pages `1..pages` of the view `viewKey` names.
 * `rowCount` and `pageSize` are the server's, from the last page it returned.
 */
type LoadedWindow<TData> = {
  rows: TData[];
  pages: number;
  rowCount: number;
  pageSize: number;
  viewKey: string;
  state: LoadState;
  /** The `rows` prop the window was last reconciled with. */
  source: TData[];
  /**
   * The view `source` was rendered for. A URL table's is the location's once
   * the commit that delivered the prop has landed (the server rendered for
   * the URL, whatever view state the table holds); until then, and for any
   * other table, the view current when the prop last changed.
   */
  sourceKey: string;
  /**
   * Bumped by every refetch and every view change. A response requested
   * under an older generation describes a window that no longer exists and
   * is dropped.
   */
  generation: number;
  /** Pages to refetch for `generation`, started once the window commits. */
  refetch: { generation: number; pages: number } | null;
  /**
   * The window holds rows of another view under `viewKey`: a URL table's
   * `rows` prop while `viewKey` differs from `sourceKey` (until the
   * navigation's new prop lands, or the view returns to the prop's own), or
   * an embedded table's rows until its view-change refetch succeeds. Nothing
   * pages it meanwhile, or the next page of this view would be merged under
   * rows of another.
   */
  pending: boolean;
};

/**
 * Whether the server holds a page past the window. Page arithmetic rather
 * than a row count: rows that shift between pages while the window loads
 * leave it short of `rowCount` with every page fetched.
 */
const hasMore = (held: LoadedWindow<unknown>) =>
  !held.pending && held.pages * held.pageSize < held.rowCount;

/**
 * `incoming` merged into `rows` by id: a row already loaded keeps its
 * position and takes the incoming row's fields, a new one is appended.
 */
function mergeById<TData>(rows: TData[], incoming: TData[]): TData[] {
  const next = rows.slice();
  const indexOf = new Map(rows.map((row, index) => [rowIdOf(row), index]));
  for (const row of incoming) {
    const id = rowIdOf(row);
    const index = indexOf.get(id);
    if (index === undefined) {
      indexOf.set(id, next.length);
      next.push(row);
    } else {
      next[index] = row;
    }
  }
  return next;
}

/**
 * A window holding just the `rows` prop, as page 1. The server does not send
 * a page size with the props; page 1 is a full page whenever more rows exist,
 * so its length stands in until a load returns the real one.
 */
function windowOf<TData>(
  rows: TData[],
  rowCount: number | undefined,
  viewKey: string,
  generation: number,
  sourceKey: string
): LoadedWindow<TData> {
  return {
    rows,
    pages: 1,
    rowCount: rowCount ?? rows.length,
    pageSize: rows.length,
    viewKey,
    state: "idle",
    source: rows,
    sourceKey,
    generation,
    refetch: null,
    pending: false,
  };
}

/**
 * `held` with `sourceKey` as the view its `rows` prop was rendered for. A
 * window that is just the prop pages only under that view; one still holding
 * the rows it loaded keeps them until its refetch replaces them.
 */
function sourcedFrom<TData>(
  held: LoadedWindow<TData>,
  sourceKey: string
): LoadedWindow<TData> {
  return {
    ...held,
    sourceKey,
    pending:
      held.rows === held.source ? held.viewKey !== sourceKey : held.pending,
  };
}

/** `held` after a refetch of its first `pages` pages returned `results`. */
function refetched<TData>(
  held: LoadedWindow<TData>,
  results: PageResult<TData>[],
  pages: number
): LoadedWindow<TData> {
  const { rowCount, pageSize } = results[0]!;
  return {
    ...held,
    rows: results.reduce<TData[]>(
      (rows, result) => mergeById(rows, result.rows),
      []
    ),
    rowCount,
    pageSize,
    // Rows deleted elsewhere can leave the last pages empty; the window
    // claims only the pages that still hold rows, so a later append starts
    // at the first page it has not seen.
    pages: Math.min(pages, Math.max(1, Math.ceil(rowCount / pageSize))),
    refetch: null,
    pending: false,
  };
}

/** `held` with page `page`, which the server returned as `result`. */
function appended<TData>(
  held: LoadedWindow<TData>,
  result: PageResult<TData>,
  page: number
): LoadedWindow<TData> {
  return {
    ...held,
    rows: mergeById(held.rows, result.rows),
    pages: Math.max(held.pages, page),
    rowCount: result.rowCount,
    pageSize: result.pageSize,
    state: "idle",
  };
}

type LoadedWindowOptions<TData extends RowData> = {
  /** The `rows` prop: page 1 of the view the server rendered it for. */
  rows: TData[];
  /** The server's paging; absent when the table holds every row itself. */
  serverPage: DataTableProps<TData>["serverPage"];
  /** The view `serverPage.load` fetches for. */
  viewParams: () => TableSearchParams;
  /**
   * Whether the server renders the `rows` prop for the current view, as it
   * does for a table whose view lives in the URL. Otherwise the prop holds
   * page 1 of the view the table mounted with.
   */
  serverDriven: boolean;
  /**
   * Whether the view is grouped. A grouped page is a preview of each group,
   * not page 1 of `rowCount`, and the server answers every page with the same
   * preview, so a grouped window never has more to load.
   */
  grouped: boolean;
};

/**
 * The rows a table has loaded, owned by the table rather than mirrored from
 * its props, so a page appended on demand survives the props changing.
 *
 * - The `rows` prop seeds page 1.
 * - `loadMore` appends the next page through `serverPage.load`, merged by id.
 *   A second call while one runs returns the same promise. A failed page
 *   sets the state to `"error"` until `retryLoad` fetches it again.
 * - The `rows` prop changing under the same view means the server's data
 *   changed: every loaded page is refetched in parallel and replaces the
 *   window, or, when the prop is page 1 of the window's view and the window
 *   holds only that page, the prop replaces it. A failed refetch keeps the
 *   window and says so. An append in flight is superseded, and runs again on
 *   the refetched window. A URL table's prop that the location says is
 *   another view's (a navigation landing after the view moved on, or browser
 *   back) is not paged until the view returns to it or the next prop lands.
 * - The view changing drops the append in flight — clearing it so the next
 *   `loadMore` starts fresh for the new window rather than reusing the
 *   dropped one — and resets the window to the `rows` prop; when the prop is
 *   not page 1 of the new view, page 1 is refetched for it. A window whose
 *   rows cannot yet be confirmed for the new view (stale props still under
 *   the new key, or that refetch failing) refuses to page until real rows or
 *   the refetch land.
 * - Without `serverPage` the window is the `rows` prop and never grows.
 *
 * `loadMore`, `ensureLoaded` and `retryLoad` settle once what they loaded has
 * committed, so a caller can scroll to a row as soon as they resolve. All
 * three keep their identity for the life of the table.
 */
export function useLoadedWindow<TData extends RowData>({
  rows,
  serverPage,
  viewParams,
  serverDriven,
  grouped,
}: LoadedWindowOptions<TData>) {
  // Layout (visibility, order, sizing) is not part of the key: it changes
  // what is drawn, never which rows the server returns.
  const viewKey = useMemo(() => JSON.stringify(viewParams()), [viewParams]);
  const [mountViewKey] = useState(viewKey);
  const paged = serverPage != null;

  const [held, setHeld] = useState(() =>
    windowOf(rows, serverPage?.rowCount, viewKey, 0, viewKey)
  );

  // A URL table's prop is rendered for the location, which a render cannot
  // read: Next writes a navigation's URL in an insertion effect, so the render
  // that delivers its rows, or mounts the table it navigated to, still sees
  // the previous one. The location read once that commit lands names the
  // prop's view, and the render after takes it.
  const [located, setLocated] = useState<{
    source: TData[];
    sourceKey: string;
  } | null>(null);

  // The async side reads the committed window and the latest loader through
  // refs, so a render that never commits cannot leak into either.
  const committedRef = useRef(held);
  const latestRef = useRef({ load: serverPage?.load, viewParams, grouped });
  const waitersRef = useRef<Array<() => void>>([]);
  const refetchRef = useRef<Promise<void> | null>(null);
  const appendRef = useRef<Promise<void> | null>(null);

  if (rows !== held.source || (paged && viewKey !== held.viewKey)) {
    const generation = held.generation + 1;
    // A new prop is taken for the current view's until a URL table's commit
    // says otherwise (below); an unchanged one keeps the view it was rendered
    // for.
    const sourceKey = rows !== held.source ? viewKey : held.sourceKey;
    const fromProps = windowOf(
      rows,
      serverPage?.rowCount,
      viewKey,
      generation,
      sourceKey
    );
    const propsAreView = serverDriven || viewKey === mountViewKey;
    if (!paged) {
      setHeld(fromProps);
    } else if (viewKey !== held.viewKey) {
      // A URL table's view changes before the navigation that renders its
      // rows lands, so until then the prop is another view's page 1; one that
      // returns to the prop's own view (the first render adopting the URL, a
      // search typed and cleared within its debounce) needs no navigation. An
      // embedded table's prop is the mount view's until page 1 is refetched.
      setHeld(
        propsAreView
          ? { ...fromProps, pending: serverDriven && viewKey !== sourceKey }
          : { ...fromProps, pending: true, refetch: { generation, pages: 1 } }
      );
    } else if (propsAreView && held.pages === 1) {
      setHeld({ ...fromProps, state: held.state });
    } else {
      setHeld({
        ...held,
        source: rows,
        sourceKey,
        generation,
        refetch: { generation, pages: held.pages },
      });
    }
  } else if (
    located?.source === held.source &&
    located.sourceKey !== held.sourceKey
  ) {
    setHeld(sourcedFrom(held, located.sourceKey));
  }

  const { source, sourceKey } = held;
  useLayoutEffect(() => {
    if (!serverDriven) return;
    const locationKey = JSON.stringify(locationViewParams());
    if (locationKey !== sourceKey) {
      // eslint-disable-next-line react-hooks/set-state-in-effect, @eslint-react/set-state-in-effect -- the location only names the prop's view after the commit; see the comment on `located`
      setLocated({ source, sourceKey: locationKey });
    }
  }, [serverDriven, source, sourceKey]);

  useLayoutEffect(() => {
    latestRef.current = { load: serverPage?.load, viewParams, grouped };
  });

  useLayoutEffect(() => {
    committedRef.current = held;
    const waiters = waitersRef.current;
    waitersRef.current = [];
    for (const resolve of waiters) resolve();
  }, [held]);

  // A view change drops anything an in-flight append is doing for the old
  // one; clearing the ref here (rather than in the loop below) means the
  // sentinel's next `loadMore` starts a fresh append for the new window
  // instead of getting back the old promise, which is settling with nothing
  // loaded and no way to say so.
  useLayoutEffect(() => {
    appendRef.current = null;
  }, [held.viewKey]);

  /**
   * Applies `update` unless a refetch or a view change has committed since
   * `generation`, and resolves once whatever was applied has committed.
   */
  const commit = useCallback(
    (
      generation: number,
      update: (current: LoadedWindow<TData>) => LoadedWindow<TData>
    ): Promise<void> => {
      if (committedRef.current.generation !== generation) {
        return Promise.resolve();
      }
      const done = new Promise<void>((resolve) => {
        waitersRef.current.push(resolve);
      });
      setHeld((current) =>
        current.generation === generation ? update(current) : current
      );
      return done;
    },
    []
  );

  const job = held.refetch;
  useLayoutEffect(() => {
    const load = latestRef.current.load;
    if (!job || !load) return;
    const view = latestRef.current.viewParams();
    const settled = Promise.all(
      Array.from({ length: job.pages }, (_, index) => load(index + 1, view))
    ).then(
      (results) =>
        commit(job.generation, (current) =>
          refetched(current, results, job.pages)
        ),
      () => {
        if (committedRef.current.generation === job.generation) {
          toast.error("Couldn't refresh the table");
        }
      }
    );
    refetchRef.current = settled;
    void settled.then(() => {
      if (refetchRef.current === settled) refetchRef.current = null;
    });
  }, [job, commit]);

  const setData = useCallback((update: SetStateAction<TData[]>) => {
    setHeld((current) => {
      const next = typeof update === "function" ? update(current.rows) : update;
      return next === current.rows ? current : { ...current, rows: next };
    });
  }, []);

  const append = useCallback(
    (retry: boolean): Promise<void> => {
      if (appendRef.current) return appendRef.current;

      const run = async () => {
        for (;;) {
          while (refetchRef.current) await refetchRef.current;
          const start = committedRef.current;
          const {
            load,
            viewParams: view,
            grouped: isGrouped,
          } = latestRef.current;
          if (
            !load ||
            isGrouped ||
            !hasMore(start) ||
            (start.state === "error" && !retry)
          ) {
            // A refetch that ran while this page loaded can leave nothing
            // past the window, and the page is no longer wanted.
            if (start.state === "loading") {
              await commit(start.generation, (current) => ({
                ...current,
                state: "idle",
              }));
            }
            return;
          }

          const { generation, viewKey: startKey } = start;
          const page = start.pages + 1;
          await commit(generation, (current) => ({
            ...current,
            state: "loading",
          }));
          const result = await load(page, view()).catch(() => null);
          await commit(generation, (current) =>
            result
              ? appended(current, result, page)
              : { ...current, state: "error" }
          );

          const now = committedRef.current;
          // A view change drops the page; a page that landed, or failed, on
          // the window it was fetched for is done. Otherwise a refetch
          // replaced the window first: fetch the page again for it.
          if (now.viewKey !== startKey) return;
          if (now.generation === generation || now.pages >= page) return;
        }
      };

      const promise = run().finally(() => {
        // A view change may already have cleared this to let a fresh append
        // start; only drop it here if it is still this run's.
        if (appendRef.current === promise) appendRef.current = null;
      });
      appendRef.current = promise;
      return promise;
    },
    [commit]
  );

  const loadMore = useCallback(() => append(false), [append]);
  const retryLoad = useCallback(() => append(true), [append]);

  const ensureLoaded = useCallback(
    async (index: number): Promise<boolean> => {
      const { viewKey: startKey } = committedRef.current;
      for (;;) {
        const current = committedRef.current;
        if (current.viewKey !== startKey) return false;
        if (index < current.rows.length) return true;
        const { load, grouped: isGrouped } = latestRef.current;
        if (!load || isGrouped || !hasMore(current)) return false;
        if (current.state === "error") return false;
        await append(false);
        if (committedRef.current === current) return false;
      }
    },
    [append]
  );

  const more = !grouped && hasMore(held);
  const loaded = useMemo(
    (): LoadedStatus => ({
      count: held.rows.length,
      hasMore: more,
      state: held.state,
    }),
    [held.rows.length, more, held.state]
  );

  return {
    data: held.rows,
    setData,
    /** The server's count of rows matching the view. */
    rowCount: held.rowCount,
    loaded,
    loadMore,
    ensureLoaded,
    retryLoad,
  };
}
