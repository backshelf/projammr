import {
  and,
  asc,
  count,
  eq,
  inArray,
  isNull,
  type SQL,
  type SQLWrapper,
  sql,
} from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { z } from "zod";
import { db, type Tx } from "../index.js";
import { idListParamSchema } from "../../entities/filters.js";
import { clearEntityLabels, type LabelTarget } from "./labels.js";

/**
 * Shared query-parameter and response contract for the paginated project list
 * endpoints (tracks, collections, sessions). Each entity supplies its own
 * whitelist of sort keys; everything else here is identical across the three.
 */

const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

/** Query params common to every paginated list route. `sort` is `<key>.<dir>`. */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  // A caller asking for more than the server hands out (a table's
  // `rowsPerLoad` setting is the viewer's to set) gets the most it gives,
  // not a rejected request.
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .default(DEFAULT_PAGE_SIZE)
    .transform((pageSize) => Math.min(pageSize, MAX_PAGE_SIZE)),
  sort: z.string().optional(),
  q: z.string().trim().optional(),
  /** A whitelisted grouping key; validated per entity in the query layer. */
  groupBy: z.string().optional(),
});

const DEFAULT_SAVES_LIMIT = 100;
const MAX_SAVES_LIMIT = 500;

/** The `limit` query of the save list and of the commit lists that take its bounds. */
export const savesQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_SAVES_LIMIT)
    .default(DEFAULT_SAVES_LIMIT),
});

/** Parsed `sort=<key>.<dir>` — `key` is validated against the entity whitelist. */
export type SortSpec = { key: string; desc: boolean };

export function parseSort(
  raw: string | undefined,
  allowedKeys: readonly string[]
): SortSpec | null {
  if (!raw) return null;
  const [key, dir] = raw.split(".");
  if (!key || !allowedKeys.includes(key)) return null;
  return { key, desc: dir === "desc" };
}

/**
 * A grouping of the full filtered result set. `key` is the stable value the
 * client matches a row against (a status id, a priority level id, a track id,
 * as a string); `label` is what the section header shows; `count` is the total rows
 * in that group across every page. Ordered the same way the rows are.
 */
export type GroupSummary = { key: string; label: string; count: number };

/**
 * Faceted option counts for the filterable columns, computed against the full
 * matching set (not just the returned page) so the client's filter menus can
 * show totals even under server pagination. Each facet applies every *other*
 * active filter but excludes its own, matching TanStack's faceting semantics.
 * Keys are stringified facet values (a status id, a DAW name, …); values are
 * the row count for that option.
 */
export type Facets = Record<string, Record<string, number>>;

/**
 * The envelope an entity table's list route returns: a page of rows, plus the
 * facet and group summaries its filter menus are built from. A listing that
 * has no such menus returns `pageResponseSchema` instead.
 */
export function paginatedResponseSchema<T extends z.ZodTypeAny>(row: T) {
  return z.object({
    rows: z.array(row),
    rowCount: z.number(),
    page: z.number(),
    pageSize: z.number(),
    facets: z.record(z.string(), z.record(z.string(), z.number())),
    groups: z.array(
      z.object({
        key: z.string(),
        label: z.string(),
        count: z.number(),
      })
    ),
  });
}

/** The plain envelope a paged listing returns: one page of rows and where it sits in the whole. */
export function pageResponseSchema<T extends z.ZodTypeAny>(row: T) {
  return z.object({
    rows: z.array(row),
    rowCount: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
  });
}

export type Paginated<T> = {
  rows: T[];
  rowCount: number;
  page: number;
  pageSize: number;
  groups: GroupSummary[];
  facets: Facets;
};

export function offsetOf(page: number, pageSize: number): number {
  return (page - 1) * pageSize;
}

/**
 * Escapes `%`, `_` and `\` in a user-typed search term before it is wrapped in
 * `%…%` for an `ilike`. Postgres treats `%` and `_` as wildcards and `\` as
 * the escape character inside a pattern; left unescaped, a term containing
 * any of them would silently match more or less than the text it names.
 */
export function escapeLikeTerm(term: string): string {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * Body shape for the bulk-update routes. `projectId` scopes the write (and is
 * what `authorizeProject` reads). The selection is either an explicit `ids`
 * list or `all: true` plus the same filter params the paginated list route
 * takes, so "select every row matching this filter" applies the patch to rows
 * the client never had to enumerate. `patch` is validated per entity by the
 * route.
 */
export const bulkSelectionSchema = z.union([
  z.object({ ids: z.array(z.number().int()).min(1) }),
  z
    .object({ all: z.literal(true) })
    .catchall(z.union([z.string(), z.number()])),
]);

/**
 * The `archived` list param of the entities that can be archived: absent is
 * live rows only, `only` is archived rows only, `include` is both. The same
 * string rides in an `all: true` selection's filters.
 */
export const archivedScopeSchema = z.enum(["only", "include"]);

export type ArchivedScope = z.infer<typeof archivedScopeSchema>;

export type BulkSelection = z.infer<typeof bulkSelectionSchema>;

/**
 * Body shape for the bulk-delete routes: the same selection the bulk patch
 * takes, with nothing to apply. Rows the selection names outside `projectId`
 * are not matched, so they are neither deleted nor counted.
 */
export const bulkDeleteSchema = z.object({
  projectId: z.coerce.number().int(),
  selection: bulkSelectionSchema,
});

/** How many rows a bulk delete removed. */
export const bulkDeletedSchema = z.object({ deleted: z.number() });

/*
 * The machinery every paginated list is built from.
 *
 * Filtering, sorting and pagination all run in the database. Each entity
 * builds the filtered/sorted/paginated set of row ids with a core `select`
 * (joining status or track when a sort key or filter needs it), counts the
 * full filtered set in parallel, then hydrates that id page through the
 * relational query builder so callers get the same `with:` shape as the
 * unpaginated endpoints. The hydrated rows are re-ordered in memory to match
 * the id page, since `WHERE id IN (...)` does not preserve order.
 *
 * Sort keys are whitelisted per entity and mapped to columns there; a client
 * string is never interpolated into `orderBy`. Every sort appends `id` as a
 * tiebreaker so rows with equal sort values keep a stable order across pages.
 */

/**
 * A join a listing adds when its sort key, filter or grouping reads a column
 * from another table. Declared as data rather than as a builder callback so
 * the machinery applies it without losing the select's result type.
 */
export type TableJoin = { table: PgTable; on: SQL };

/**
 * Applies a listing's joins to a query, in order. A table already joined is
 * skipped, so a grouping and a sort key that read the same joined table (both
 * naming the listing's one join to it) join it once.
 */
export function withJoins<Q extends { leftJoin(table: PgTable, on: SQL): Q }>(
  query: Q,
  joins: readonly TableJoin[]
): Q {
  const joined = new Set<PgTable>();
  return joins.reduce((q, join) => {
    if (joined.has(join.table)) return q;
    joined.add(join.table);
    return q.leftJoin(join.table, join.on);
  }, query);
}

/**
 * The order term for a listing's sort key: ascending or descending, with nulls
 * last in both directions, so rows with no value never lead the list.
 */
export function sortTerm(column: SQLWrapper, descending: boolean): SQL {
  return descending
    ? sql`${column} desc nulls last`
    : sql`${column} asc nulls last`;
}

export async function hydratePage<T extends { id: number }>(
  ids: number[],
  fetchByIds: (ids: number[]) => Promise<T[]>
): Promise<T[]> {
  if (ids.length === 0) return [];
  const rows = await fetchByIds(ids);
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter((r): r is T => r !== undefined);
}

/**
 * Counts rows grouped by `key` (a column or an expression over one), returned
 * as `{ [stringified key]: count }`. `null` keys (e.g. a track with no status)
 * are dropped — a "none" option is the client's concern. `where` is the
 * filter set with this facet's own predicate omitted.
 */
export async function facetCounts(
  key: PgColumn | SQL,
  from: PgTable,
  where: SQL | undefined
): Promise<Record<string, number>> {
  const rows = await db
    .select({ key, value: count() })
    .from(from)
    .where(where)
    .groupBy(key);
  const out: Record<string, number> = {};
  for (const r of rows) {
    if (r.key == null) continue;
    out[String(r.key)] = r.value;
  }
  return out;
}

/**
 * One group key of a paginated list. `keyColumn` is the stable value a row is
 * bucketed by (a status id, a priority level id, a track id); `orderColumn` is
 * what both the id-page query and the summary query sort groups by (often the
 * same, but status groups order by `statuses.percentage` and priority groups
 * by the level's rank while keying on the id); `joins` are the joins the
 * ordering/labelling needs;
 * `labelColumn` supplies the header text when it lives on a joined table;
 * `noneLabel` names the null bucket. The order and the label may also be an
 * expression over `keyColumn` alone (a custom select field orders by its
 * options' positions), which a grouped summary can select and order by since
 * it groups by `keyColumn`.
 */
export type GroupKey = {
  keyColumn: PgColumn;
  orderColumn: PgColumn | SQL;
  joins?: TableJoin[];
  labelColumn?: PgColumn | SQL;
  noneLabel: string;
};

/**
 * The entry a request's `groupBy` names in a group-key map, or undefined for a
 * key the map does not own. A bare `map[key]` also answers for the names every
 * object inherits (`constructor`, `toString`, `__proto__`).
 */
export function ownGroupKey<T>(
  keys: Readonly<Record<string, T>>,
  key: string
): T | undefined {
  return Object.hasOwn(keys, key) ? keys[key] : undefined;
}

/**
 * Group summaries for the full filtered set: `GROUP BY` the key column, ordered
 * the same way the id-page query orders its groups, so the client's section
 * headers line up with the rows and carry a real cross-page count. The null
 * bucket sorts last and is labelled with `noneLabel`.
 */
export async function groupSummaries(
  from: PgTable,
  spec: GroupKey,
  where: SQL | undefined
): Promise<GroupSummary[]> {
  const label = spec.labelColumn ?? spec.keyColumn;
  const rows = await withJoins(
    db
      .select({ key: spec.keyColumn, label, value: count() })
      .from(from)
      .$dynamic(),
    spec.joins ?? []
  )
    .where(where)
    .groupBy(spec.keyColumn, label, spec.orderColumn)
    .orderBy(
      sql`${spec.orderColumn} asc nulls last`,
      sql`${spec.keyColumn} asc nulls last`
    );

  return rows.map((r) => ({
    key: r.key == null ? "__none__" : String(r.key),
    label: r.label == null ? spec.noneLabel : String(r.label),
    count: r.value,
  }));
}

/**
 * How many rows of each group a grouped list returns. Grouped mode is not
 * row-paginated — every group is shown at once — so each group contributes at
 * most this many rows; a group with more gets a "show all" affordance on the
 * client that drops grouping and filters to just that group.
 */
const GROUP_PREVIEW_SIZE = 10;

/**
 * The id list for a grouped page: the first `GROUP_PREVIEW_SIZE` rows of every
 * group, ordered by the group then the active sort then `id`. A `row_number()`
 * window partitioned by the group key does the per-group limit in one query.
 * `idColumn` is the primary key being selected; `sortSql` is the already-built
 * `ORDER BY` expression list (sort key + id tiebreaker); `sortJoins` are the
 * joins that sort key reads, applied beside the group's own.
 */
export async function groupedIdRows(
  from: PgTable,
  idColumn: PgColumn,
  spec: GroupKey,
  where: SQL | undefined,
  sortSql: SQL[],
  sortJoins: readonly TableJoin[]
): Promise<number[]> {
  const partitionOrder = sql.join(
    [sql`${spec.orderColumn} asc nulls last`, ...sortSql],
    sql`, `
  );
  const ranked = withJoins(
    db
      .select({
        id: idColumn,
        rn: sql<number>`row_number() over (partition by ${spec.keyColumn} order by ${partitionOrder})`.as(
          "rn"
        ),
        groupOrder: sql`${spec.orderColumn}`.as("group_order"),
        groupKeyOrder: sql`${spec.keyColumn}`.as("group_key_order"),
      })
      .from(from)
      .$dynamic(),
    [...(spec.joins ?? []), ...sortJoins]
  );
  const sub = ranked.where(where).as("ranked");

  const rows = await db
    .select({ id: sub.id })
    .from(sub)
    .where(sql`${sub.rn} <= ${GROUP_PREVIEW_SIZE}`)
    .orderBy(
      sql`${sub.groupOrder} asc nulls last`,
      sql`${sub.groupKeyOrder} asc nulls last`,
      asc(sub.rn)
    );
  return rows.map((r) => Number(r.id));
}

/**
 * A many-to-many grouping: a row belongs to every value it links to (a track
 * with three labels shows under three section headers). `pairs` is a SQL
 * fragment — a `SELECT entity_id, key, label` — yielding one row per
 * (row, group value) pair. `noneLabel` names the bucket of rows with no link.
 */
export type ExpandedGroupKey = {
  pairs: SQL;
  noneLabel: string;
};

/** The filtered-row subquery both many-to-many helpers start from. */
function filteredIdsSql(
  table: PgTable,
  idColumn: PgColumn,
  where: SQL | undefined
): SQL {
  return where
    ? sql`(select ${idColumn} as id from ${table} where ${where})`
    : sql`(select ${idColumn} as id from ${table})`;
}

/**
 * Grouped id page for a many-to-many grouping. Ranks the filtered id set by
 * `sortSql` (the already-built `ORDER BY` expression list, sort key + id
 * tiebreaker; `sortJoins` are the joins it reads), left-joins it to the
 * expansion pairs, ranks rows within each group by that order, and takes the
 * first `GROUP_PREVIEW_SIZE` of each. A row linking to several groups appears
 * once per group; a row linking to none falls in the `__none__` bucket. Returns
 * `(id, key)` pairs — the same row id can appear under several keys.
 */
export async function expandedGroupedIdRows(
  table: PgTable,
  idColumn: PgColumn,
  spec: ExpandedGroupKey,
  where: SQL | undefined,
  sortSql: SQL[],
  sortJoins: readonly TableJoin[]
): Promise<{ id: number; key: string }[]> {
  const filtered = withJoins(
    db
      .select({
        id: idColumn,
        ord: sql`row_number() over (order by ${sql.join(sortSql, sql`, `)})`.as(
          "ord"
        ),
      })
      .from(table)
      .$dynamic(),
    sortJoins
  )
    .where(where)
    .getSQL();
  const { rows } = await db.execute<{ id: number; key: string | null }>(sql`
    select id, key from (
      select
        f.id as id,
        p.key as key,
        p.label as label,
        row_number() over (partition by p.key order by f.ord) as rn
      from (${filtered}) as f
      left join (${spec.pairs}) as p on p.entity_id = f.id
    ) ranked
    where rn <= ${GROUP_PREVIEW_SIZE}
    order by label asc nulls last, key asc nulls last, rn asc
  `);
  return rows.map((r) => ({
    id: Number(r.id),
    key: r.key == null ? "__none__" : String(r.key),
  }));
}

/** Group summaries for a many-to-many grouping: one row per distinct value. */
export async function expandedGroupSummaries(
  table: PgTable,
  idColumn: PgColumn,
  spec: ExpandedGroupKey,
  where: SQL | undefined
): Promise<GroupSummary[]> {
  const filtered = filteredIdsSql(table, idColumn, where);
  const { rows } = await db.execute<{
    key: string | null;
    label: string | null;
    value: number | string;
  }>(sql`
    select p.key as key, p.label as label, count(distinct f.id) as value
    from ${filtered} as f
    left join (${spec.pairs}) as p on p.entity_id = f.id
    group by p.key, p.label
    order by p.label asc nulls last, p.key asc nulls last
  `);
  return rows.map((r) => ({
    key: r.key == null ? "__none__" : String(r.key),
    label: r.label == null ? spec.noneLabel : String(r.label),
    count: Number(r.value),
  }));
}

/**
 * `status=0` is the reserved "no status" sentinel — status ids are a serial
 * primary key starting at 1, so 0 never names a real row and is safe to
 * repurpose for `IS NULL` (a plain equality match can't express that).
 */
export function statusFilterSql(
  column: PgColumn,
  statusId: number | undefined
): SQL | undefined {
  if (statusId == null) return undefined;
  return statusId === 0 ? isNull(column) : eq(column, statusId);
}

/** Rows whose `column` holds any of `ids`; no filter for none. */
export function membershipFilterSql(
  column: PgColumn,
  ids: readonly number[] | undefined
): SQL | undefined {
  if (!ids || ids.length === 0) return undefined;
  return inArray(column, [...ids]);
}

/*
 * Bulk field updates and deletes.
 *
 * A selection is either an explicit list of row ids or the "all rows matching
 * the current filter" flag the table sends when the user picks select-all past
 * a single page — the server can't be handed ids it never sent. Both resolve to
 * a `where` clause scoped to the project, so a caller can never touch another
 * project's rows even by passing foreign ids. A patch is applied in one
 * `UPDATE` and a delete runs as one `DELETE`; either way the ids actually
 * touched are what comes back.
 */

/** The numeric value of a filter carried on an `all: true` selection. */
export function selectionNumber(
  v: string | number | undefined
): number | undefined {
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** The string value of a filter carried on an `all: true` selection. */
export function selectionString(
  v: string | number | undefined
): string | undefined {
  return v == null ? undefined : String(v);
}

/**
 * The ids of a list filter carried on an `all: true` selection, in the
 * list param's own comma-separated form; ignored unless every id parses.
 */
export function selectionIds(
  v: string | number | undefined
): number[] | undefined {
  return idListParamSchema.safeParse(selectionString(v)).data;
}

export function selectionScope(
  idColumn: PgColumn,
  selection: BulkSelection,
  matchAll: SQL | undefined
): SQL | undefined {
  if ("all" in selection) return matchAll;
  if (selection.ids.length === 0) return sql`false`;
  return and(matchAll, inArray(idColumn, selection.ids));
}

/** The filters an `all: true` selection carries; an id list carries none. */
export function selectionFilters(
  selection: BulkSelection
): Record<string, string | number | undefined> {
  return "all" in selection ? selection : {};
}

/**
 * Runs a selection's `DELETE` and clears the label links of everything it
 * removed. `entity_labels` is polymorphic and has no FK to the deleted rows,
 * so nothing else would take them with it.
 */
export async function deleteSelected(
  entityType: LabelTarget,
  deleteRows: (tx: Tx) => Promise<{ id: number }[]>
): Promise<number[]> {
  return db.transaction(async (tx) => {
    const ids = (await deleteRows(tx)).map((row) => row.id);
    await clearEntityLabels(tx, entityType, ids);
    return ids;
  });
}
