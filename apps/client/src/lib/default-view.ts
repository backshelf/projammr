import { isCustomFieldKey } from "@/fields/custom-field";
import {
  FILTER_PARAM_NAMES,
  filterViewQuery,
  TABLE_PARAM,
} from "@/lib/table-params";
import type { RouteSearchParams } from "@/modules/route-module";

/**
 * The query a bare list URL redirects to when nothing says otherwise: no
 * filters, no saved view, list mode. Spelled through {@link TABLE_PARAM} so it
 * can never drift from the param name.
 */
export const BUILT_IN_VIEW_QUERY = `${TABLE_PARAM.view}=list`;

/** Every param whose presence means a URL already names a view — the same
 *  vocabulary {@link filterViewQuery} narrows to, plus `view` and `archived`
 *  (both deliberately excluded from that vocabulary, since neither is a
 *  saved-view lens) and any custom field filter. `peek` is deliberately not a
 *  member: peeking a row is not "naming a view", so a bare `?peek=5` still
 *  redirects, carrying `peek` along into the target. */
const VIEW_PARAM_KEYS: readonly string[] = [
  TABLE_PARAM.search,
  TABLE_PARAM.sort,
  TABLE_PARAM.visibility,
  TABLE_PARAM.order,
  TABLE_PARAM.sizing,
  TABLE_PARAM.grouping,
  TABLE_PARAM.view,
  TABLE_PARAM.archived,
  ...FILTER_PARAM_NAMES,
];

function isPresent(value: string | string[] | undefined): boolean {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw !== undefined && raw !== "";
}

/** Whether `sp` already names a view: any member of {@link VIEW_PARAM_KEYS},
 *  or a custom field filter, has a value. Reads the route's raw search
 *  params, not `parseTableQuery`'s result — `parseTableQuery` silently drops
 *  `cols`/`order`/`w`, exactly the params this most needs to see. */
export function hasViewParams(sp: RouteSearchParams): boolean {
  for (const key of VIEW_PARAM_KEYS) {
    if (isPresent(sp[key])) return true;
  }
  for (const key of Object.keys(sp)) {
    if (isCustomFieldKey(key) && isPresent(sp[key])) return true;
  }
  return false;
}

/**
 * The query to redirect to when `sp` asks for a board the list cannot show
 * (a kind without statuses, or an archived scope): every param kept, `view`
 * set to `list`. `undefined` when `sp` shows as it reads — the URL stays the
 * truth of what renders, and the target is never redirected again.
 */
export function unshowableBoardQuery(
  sp: RouteSearchParams,
  showsBoard: boolean
): string | undefined {
  const view = sp[TABLE_PARAM.view];
  if (showsBoard || (Array.isArray(view) ? view[0] : view) !== "board") {
    return undefined;
  }
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== undefined) params.append(key, item);
    }
  }
  params.set(TABLE_PARAM.view, "list");
  return params.toString();
}

/**
 * The redirect target for a bare list URL: `query` narrowed to the view
 * vocabulary, with `view` set unconditionally so the target always names a
 * display mode (never a bare URL a later load would redirect again). Knows
 * nothing about settings or saved views — the caller resolves which query
 * string and mode to pass in.
 */
export function defaultViewQuery(
  query: string,
  view: "list" | "board"
): string {
  const params = new URLSearchParams(filterViewQuery(query));
  params.set(TABLE_PARAM.view, view);
  return params.toString();
}
