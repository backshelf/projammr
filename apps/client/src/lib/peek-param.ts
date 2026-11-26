/**
 * The `peek` query param: the id of the row open in the side panel.
 *
 * It is deliberately not part of a saved view (see `VIEW_QUERY_PARAMS`) — an
 * open panel is a position in the data, not a lens on it.
 */

/**
 * Reads the param. Anything that is not a positive integer — a stale id from a
 * hand-edited URL, a fragment of another app's query string — reads as closed
 * rather than opening an empty panel.
 */
export function parsePeek(raw: string | null): number | null {
  if (raw == null || raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) return null;
  return n;
}

/**
 * The row the panel should show, and where it sits in the peekable rows of the
 * current page. `index` is -1 when the id names no row on this page — the id
 * survives in the URL, but the panel stays closed rather than showing a
 * neighbouring row the user did not ask for.
 */
export function resolvePeek<T extends { id: number }>(
  rows: T[],
  peekId: number | null
): { row: T | null; index: number; total: number } {
  const total = rows.length;
  if (peekId == null) return { row: null, index: -1, total };
  const index = rows.findIndex((row) => row.id === peekId);
  return { row: index >= 0 ? (rows[index] as T) : null, index, total };
}

/**
 * The id to open when stepping by `delta`. `null` at either end — stepping
 * back past the first row, or forward past the last with nothing more to
 * load. Stepping forward past the last loaded row while `hasMore` is true
 * returns `"load"` instead of clamping, for the caller to load the next page
 * and step once it lands.
 */
export function stepPeek<T extends { id: number }>(
  rows: T[],
  index: number,
  delta: 1 | -1,
  { hasMore }: { hasMore: boolean }
): number | null | "load" {
  if (index < 0) return null;
  const next = index + delta;
  if (next < 0) return null;
  if (next >= rows.length) return hasMore ? "load" : null;
  return (rows[next] as T).id;
}

/** The `peek` query-string key. */
export const PEEK_PARAM = "peek";

/** The current URL's peek id (null during SSR). */
export function readPeekFromUrl(): number | null {
  if (typeof window === "undefined") return null;
  return parsePeek(new URLSearchParams(window.location.search).get(PEEK_PARAM));
}

/**
 * Writes the peek id into the current URL, leaving every other param alone.
 *
 * Uses `history` directly rather than the router: no server render depends on
 * `peek`, so a navigation would refetch the page for a panel that is already
 * rendered from data in hand. Opening pushes an entry so back closes the
 * panel; closing replaces, so back does not immediately reopen it.
 */
export function writePeekToUrl(rowId: number | null): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (rowId == null) url.searchParams.delete(PEEK_PARAM);
  else url.searchParams.set(PEEK_PARAM, String(rowId));

  const next = url.pathname + url.search;
  if (next === window.location.pathname + window.location.search) return;

  if (rowId == null)
    window.history.replaceState(window.history.state, "", next);
  else window.history.pushState(window.history.state, "", next);
}
