/**
 * The query-string vocabulary a table reads and writes. Names are short
 * because they sit in the address bar. The URL-state hook, saved views and the
 * server-side page loader all derive from this one registry, so a filter
 * cannot exist in one and be silently dropped by another.
 */

import {
  customFieldIdOf,
  type CustomFieldKey,
  type CustomFieldParams,
  isCustomFieldKey,
} from "@/fields/custom-field";
import type {
  CollectionsPageQuery,
  SessionsPageQuery,
  TracksPageQuery,
} from "@workspace/api/api";
import {
  COLLECTION_FILTER_PARAMS,
  type CollectionFilterParam,
  SESSION_FILTER_PARAMS,
  type SessionFilterParam,
  TRACK_FILTER_PARAMS,
  type TrackFilterParam,
} from "@workspace/api/lib/enums";

export const TABLE_PARAM = {
  search: "q",
  sort: "sort",
  visibility: "cols",
  order: "order",
  sizing: "w",
  grouping: "group",
  /**
   * Which surface renders the rows (list vs. board). Distinct from a "saved
   * view" (a named filter/layout preset) — this is a display mode, not a
   * lens, so it is excluded from {@link VIEW_QUERY_PARAMS}.
   */
  view: "view",
  /**
   * Whether the listing includes archived rows. A route-level scope, not a
   * lens — like `view`, excluded from {@link VIEW_QUERY_PARAMS}. Absent means
   * "hide"; that value never appears in the URL itself.
   */
  archived: "archived",
} as const;

/**
 * The column filters any listing reads, as the server's list query schemas
 * declare them (generated into the API package), each named once. A custom
 * field's filter is a filter too, under its `cf_<id>` key; see
 * {@link isFilterParam}.
 */
export const FILTER_PARAM_NAMES: readonly FilterParam[] = [
  ...new Set([
    ...TRACK_FILTER_PARAMS,
    ...COLLECTION_FILTER_PARAMS,
    ...SESSION_FILTER_PARAMS,
  ]),
];

export type FilterParam =
  TrackFilterParam | CollectionFilterParam | SessionFilterParam;

const FILTER_PARAM_SET: ReadonlySet<string> = new Set(FILTER_PARAM_NAMES);

/** Whether `key` is a column filter: one a listing declares, or a custom field's. */
export function isFilterParam(
  key: string
): key is FilterParam | CustomFieldKey {
  return FILTER_PARAM_SET.has(key) || isCustomFieldKey(key);
}

/** Each declared filter's value, typed as its listing's query reads it. */
type FilterValues = Pick<TracksPageQuery, TrackFilterParam> &
  Pick<CollectionsPageQuery, CollectionFilterParam> &
  Pick<SessionsPageQuery, SessionFilterParam>;

/** Reads one raw query value, or refuses it with `undefined`. */
type FilterValueParser<K extends FilterParam> = (
  raw: string
) => FilterValues[K] | undefined;

/**
 * The filters whose value is not free text. A raw value the server's schema
 * would refuse is dropped here rather than sent, where it would fail the whole
 * page; a filter whose value is free text passes through as the URL spells it.
 */
type CheckedFilterParam = {
  [K in FilterParam]-?: string extends NonNullable<FilterValues[K]> ? never : K;
}[FilterParam];

const id = (raw: string) => {
  const n = Number(raw);
  return raw.trim() !== "" && Number.isInteger(n) ? n : undefined;
};
const ID_LIST = /^\d+(,\d+)*$/;
/** A relation filter's raw value: `any`, or a positive relation type id. An
 *  old saved view's kind name (or anything else) matches neither and is
 *  dropped, as an unknown filter value is anywhere else. */
const RELATION_VALUE = /^\d+$/;

const FILTER_VALUE_PARSERS: {
  [K in CheckedFilterParam]: FilterValueParser<K>;
} & { [K in FilterParam]?: FilterValueParser<K> } = {
  status: id,
  collection: id,
  label: id,
  track: id,
  relation: (raw) =>
    raw === "any" || (RELATION_VALUE.test(raw) && Number(raw) > 0)
      ? (raw as NonNullable<FilterValues["relation"]>)
      : undefined,
  priority: (raw) => (ID_LIST.test(raw) ? raw : undefined),
  explicit: (raw) => (raw === "true" || raw === "false" ? raw : undefined),
  inDit: (raw) => (raw === "true" || raw === "false" ? raw : undefined),
};

/**
 * The column filters among `entries`, each read as its listing's query types
 * it; a value that does not read is left out, and a custom field's passes
 * through as it is, the server being the judge of its encoding.
 */
function readFilters(entries: Iterable<[string, string]>): TableFilters {
  const out: Record<string, string | number> = {};
  for (const [key, raw] of entries) {
    if (raw === "" || !isFilterParam(key)) continue;
    const parse = isCustomFieldKey(key)
      ? undefined
      : (FILTER_VALUE_PARSERS[key] as FilterValueParser<FilterParam>);
    const value = parse ? parse(raw) : raw;
    if (value !== undefined) out[key] = value;
  }
  return out as TableFilters;
}

/**
 * `view`'s values for the filters `params` names: the one place a kind's page
 * query takes its declared filters from.
 */
export function declaredFilters<K extends FilterParam>(
  view: TableSearchParams,
  params: readonly K[]
): Pick<TableFilters, K> {
  // Every key of `TableFilters` is optional, which TypeScript cannot see
  // through a `Pick` over a key it does not know yet.
  const out = {} as Pick<TableFilters, K>;
  for (const key of params) {
    if (view[key] !== undefined) out[key] = view[key];
  }
  return out;
}

/**
 * `view`'s custom field filters. The generated query types cannot name a
 * `cf_<id>` key (the listings read them from a loose schema), so a kind whose
 * rows carry custom fields spreads these into its page query beside the typed
 * filters, and the page-1 actions forward them from that query.
 */
export function customFieldFilters(view: object): CustomFieldParams {
  const out: CustomFieldParams = {};
  for (const [key, value] of Object.entries(view)) {
    if (isCustomFieldKey(key) && typeof value === "string") out[key] = value;
  }
  return out;
}

/**
 * Everything a saved table view captures: the visible set and the layout.
 * Page position and transient state (row selection, expansion) are
 * deliberately excluded — a view is a lens, not a scroll position.
 */
const VIEW_QUERY_PARAMS: readonly string[] = [
  TABLE_PARAM.search,
  TABLE_PARAM.sort,
  TABLE_PARAM.visibility,
  TABLE_PARAM.order,
  TABLE_PARAM.sizing,
  TABLE_PARAM.grouping,
  ...FILTER_PARAM_NAMES,
];

/**
 * Narrows an arbitrary query string to just {@link VIEW_QUERY_PARAMS} and the
 * custom field filters, in a canonical order: the listed params as listed, then
 * the custom field filters by field id. Used both when saving the current view
 * and when applying a stored one, so a saved view can never carry a stray
 * `page` or an unknown key. A custom field deleted since the view was saved
 * keeps its param, which the listings ignore.
 */
export function filterViewQuery(query: string): string {
  const incoming = new URLSearchParams(query);
  const out = new URLSearchParams();
  for (const key of VIEW_QUERY_PARAMS) {
    const value = incoming.get(key);
    if (value) out.set(key, value);
  }
  const customKeys = [...new Set(incoming.keys())]
    .filter(isCustomFieldKey)
    .sort((a, b) => customFieldIdOf(a) - customFieldIdOf(b));
  for (const key of customKeys) {
    const value = incoming.get(key);
    if (value) out.set(key, value);
  }
  return out.toString();
}

/**
 * Column filter values, typed as the listings' queries read them, and any
 * custom field's filter as the URL spells it.
 */
export type TableFilters = Partial<FilterValues> & CustomFieldParams;

/** The parsed shape a list page hands to its paginated loader. */
export type TableSearchParams = {
  q?: string;
  sort?: string;
  group?: string;
  view?: "list" | "board";
  archived?: "include" | "only";
} & TableFilters;

/**
 * A list page's `href` opened already narrowed to `filters`, such as the
 * tracks under one label or the tracks crediting one artist.
 */
export function withFilters(href: string, filters: TableFilters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && isFilterParam(key)) {
      params.set(key, String(value));
    }
  }
  const query = params.toString();
  return query ? `${href}?${query}` : href;
}

type RawSearchParams = Record<string, string | string[] | undefined>;

/**
 * The view a list page's query names, for its page-1 loader: search, sort,
 * grouping, the display mode and every column filter it carries.
 */
export function parseTableQuery(sp: RawSearchParams): TableSearchParams {
  const one = (v: string | string[] | undefined) =>
    Array.isArray(v) ? v[0] : v;
  const filters = readFilters(
    Object.entries(sp).flatMap(([key, value]): [string, string][] => {
      const raw = one(value);
      return raw === undefined ? [] : [[key, raw]];
    })
  );
  const archived = one(sp[TABLE_PARAM.archived]);
  return {
    q: one(sp[TABLE_PARAM.search]),
    sort: one(sp[TABLE_PARAM.sort]),
    group: one(sp[TABLE_PARAM.grouping]),
    view: one(sp[TABLE_PARAM.view]) === "board" ? "board" : undefined,
    archived:
      archived === "include" || archived === "only" ? archived : undefined,
    ...filters,
  };
}

/**
 * The column filters `state` holds (raw, as the URL spells them), typed for the
 * server: what a URL table sends as its view.
 */
export function filtersFromState(state: Record<string, string>): TableFilters {
  return readFilters(Object.entries(state));
}

/** A column layout, by id: visible unless explicitly `false`. */
export type ColumnVisibilityState = Record<string, boolean>;

/** `cols=-isrc,-iswc` — a leading `-` marks a hidden column; everything else is
 *  visible by default, so only the exceptions travel in the URL. Shared with
 *  `use-table-url-state.ts` so a table's own writes and a settings-derived
 *  default use the one encoding. */
export function serializeVisibility(state: ColumnVisibilityState): string {
  return Object.entries(state)
    .map(([id, visible]) => (visible ? id : `-${id}`))
    .join(",");
}

/**
 * `?page=` as `PageLinks` writes it: a whole number ≥ 1. Anything else (absent,
 * a typo, a fraction) is the first page, rather than a read the API rejects.
 */
export function parsePageParam(sp: RawSearchParams): number {
  const raw = sp.page;
  const page = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isInteger(page) && page >= 1 ? page : 1;
}
