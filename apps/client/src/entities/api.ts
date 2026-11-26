import type { ApiClient } from "@workspace/api/lib/authed-client";
import { collectionApi } from "@/entities/collection/api";
import { projectApi } from "@/entities/project/api";
import { sessionApi } from "@/entities/session/api";
import { trackApi } from "@/entities/track/api";
import type { PageResult } from "@/components/tables/generic-table-types";
import type {
  ActionError,
  Collection,
  CollectionsPageQuery,
  EntityKind,
  Label,
  ListCollection,
  ListSession,
  ListTrack,
  MoveReport,
  NewCollection,
  NewSession,
  NewTrack,
  Session,
  SessionsPageQuery,
  TableEntityKind,
  Track,
  TracksPageQuery,
} from "@workspace/api/api";

/** What a move would drop, asked of the server before the move is made. */
export type MovePreview = Pick<MoveReport, "droppedFields">;

/**
 * A bulk selection: either an explicit list of row ids, or every row matching
 * the current server-side filter (the flag the table sends once the user picks
 * "select all N" past a single page — the client can't enumerate ids it was
 * never sent). The `all` form carries the active filter params so the server
 * rebuilds the same `where` clause the list query used.
 */
export type BulkSelection =
  | { ids: number[]; all?: undefined }
  | ({ all: true } & { [param: string]: string | true });

/**
 * The row ids a selection names outright, or `undefined` when it stands for
 * every row matching the filter and only the server can enumerate it.
 */
export function selectedIdsOf(selection: BulkSelection): number[] | undefined {
  return selection.all ? undefined : selection.ids;
}

/**
 * The params a table's scope pins, as an `all` selection carries them: the
 * kind's page query for an empty view is exactly what the scope fixes (the
 * archived tracks page's `archived: "only"`, a collection's `collection`),
 * which the URL's filter params never hold. Without them the server would
 * re-resolve the selection against the kind's default scope.
 */
export function selectionScopeOf(
  pageQuery: Record<string, unknown>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [param, value] of Object.entries(pageQuery)) {
    if (value != null) out[param] = String(value);
  }
  return out;
}

/** The generic calls every entity kind supports, each taking the client that makes it. */
export type EntityApi = {
  /** Patches any subset of a row's fields; resolves to the row as the API echoes it. */
  patch: (
    api: ApiClient,
    id: number,
    body: Record<string, unknown>
  ) => Promise<Record<string, unknown> | ActionError>;
  remove: (api: ApiClient, id: number) => Promise<{ ok: true } | ActionError>;
};

/**
 * The additional calls the table kinds (everything but project) support.
 * `Query` is a page read's own query params, taken from the generated route
 * the kind's `page` calls. `PageRow` is what that route's `rows` actually
 * carry — the richer listing shape (joined status, collections, …), not the
 * thinner `Row` a mutation echoes back; it defaults to `Row` for a kind with
 * no `page` yet. {@link trackApi} is the first to supply both.
 */
export type TableEntityApi<
  Row,
  New,
  Query = Record<string, unknown>,
  PageRow = Row,
> = EntityApi & {
  create: (api: ApiClient, payload: New) => Promise<Row | ActionError>;
  bulkPatch: (
    api: ApiClient,
    projectId: number,
    selection: BulkSelection,
    patch: Record<string, unknown>
  ) => Promise<{ updated: number } | ActionError>;
  bulkRemove: (
    api: ApiClient,
    projectId: number,
    selection: BulkSelection
  ) => Promise<{ deleted: number } | ActionError>;
  bulkSetLabels: (
    api: ApiClient,
    projectId: number,
    selection: BulkSelection,
    labels: { add: number[]; remove: number[] }
  ) => Promise<{ updated: number } | ActionError>;
  bulkMove: (
    api: ApiClient,
    projectId: number,
    selection: BulkSelection,
    targetProjectId: number
  ) => Promise<({ moved: number } & MoveReport) | ActionError>;
  move: (
    api: ApiClient,
    id: number,
    projectId: number
  ) => Promise<MoveReport | ActionError>;
  /** The custom field values moving one row into `projectId` would drop. */
  movePreview: (
    api: ApiClient,
    id: number,
    projectId: number
  ) => Promise<MovePreview | ActionError>;
  /** The custom field values moving a selection into `targetProjectId` would drop. */
  bulkMovePreview: (
    api: ApiClient,
    projectId: number,
    selection: BulkSelection,
    targetProjectId: number
  ) => Promise<MovePreview | ActionError>;
  setLabels: (
    api: ApiClient,
    id: number,
    input: { labelIds?: number[]; names?: string[] }
  ) => Promise<Label[] | ActionError>;
  /** Fetches one page of rows the server has already filtered and sorted. */
  page: (
    api: ApiClient,
    projectId: number,
    query: Query & { page: number }
  ) => Promise<PageResult<PageRow> | ActionError>;
};

export type RowOf = {
  collection: Collection;
  track: Track;
  session: Session;
};

export type NewOf = {
  collection: NewCollection;
  track: NewTrack;
  session: NewSession;
};

/** A kind's `page` query params, before the `TableEntityApi.page` default of `Record<string, unknown>`. */
export type QueryOf = {
  collection: CollectionsPageQuery;
  track: TracksPageQuery;
  session: SessionsPageQuery;
};

/** A kind's `page` row, before the `TableEntityApi.page` default of `RowOf[K]`. */
export type PageRowOf = {
  collection: ListCollection;
  track: ListTrack;
  session: ListSession;
};

/**
 * The API calls for every entity kind, keyed the same way as `ENTITIES` in
 * `entities/index.ts`. `project` has no table operations; the other three are
 * {@link TableEntityApi}.
 */
export const ENTITY_API = {
  project: projectApi,
  collection: collectionApi,
  track: trackApi,
  session: sessionApi,
} as const satisfies {
  [K in EntityKind]: K extends TableEntityKind
    ? TableEntityApi<RowOf[K], NewOf[K], QueryOf[K], PageRowOf[K]>
    : EntityApi;
};
