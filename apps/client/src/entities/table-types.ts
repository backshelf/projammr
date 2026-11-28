import type { BoardCardData } from "@/components/tables/board/board-types";
import type { QueryOf } from "@/entities/api";
import type { DataTableProps } from "@/components/tables/DataTable";
import type { PeekRow } from "@/components/tables/PeekPanel";
import type { useEntityMutations } from "@/hooks/use-entity-mutations";
import type { TableSearchParams } from "@/lib/table-params";
import type { RowData } from "@tanstack/react-table";
import type {
  CustomField,
  Facets,
  GetCollection,
  GetTrack,
  Label,
  ListCollection,
  ListSession,
  ListTrack,
  Machine,
  PriorityScaleLevel,
  RelationTypeEntry,
  Session,
  SessionDaw,
  Status,
  TableEntityKind,
  TrackSessionSummary,
  TracksPageQuery,
} from "@workspace/api/api";
import type { ActionError } from "@workspace/api/lib/action-result";

/** The row a kind's table draws. */
export type EntityTableRow = {
  track: ListTrack;
  session: ListSession;
  collection: ListCollection;
};

/**
 * The rows a kind's table expands to under a parent row. A track expands to
 * its sessions, partially loaded until the full row arrives; a collection to
 * its tracks. Sessions have no hierarchy, so `never` is the honest child: a
 * `subRows` or a `childCard` on that kind does not type-check.
 */
export type EntityTableChild = {
  track: TrackSessionSummary & Partial<Session>;
  session: never;
  collection: ListCollection["tracks"][number];
};

/**
 * What a render site says about where a table sits, beyond the project: the
 * parent it is scoped to and the lists its pickers offer.
 */
export type EntityTableScope = {
  track: {
    collectionId?: number;
    /** Which archived tracks the table asks for; a collection's table defaults to all. */
    archived?: TracksPageQuery["archived"];
    collections: Pick<GetCollection, "id" | "title">[];
  };
  session: {
    trackId?: number;
    collectionId?: number;
    tracks: Pick<GetTrack, "id" | "title">[];
    daws: SessionDaw[];
    /** The caller's machines, for a row's Open in DAW. */
    machines: Machine[];
  };
  collection: Record<string, never>;
};

/** Everything a definition's `useParts` may read to build its table parts. */
export type EntityTableContext<K extends TableEntityKind> = {
  projectId: number;
  embedded: boolean;
  canEdit: boolean;
  statuses: Status[];
  projectLabels: Label[];
  /** The project's priority scale, bottom level first. */
  priorityLevels: PriorityScaleLevel[];
  /** The project's relation types, in list order. Empty for a kind with no
   *  relations (every kind but track). */
  relationTypes: RelationTypeEntry[];
  /** The custom fields the project defines for this kind, in their order; none
   *  for a kind that carries none. */
  customFields: CustomField[];
  scope: EntityTableScope[K];
  /**
   * The counts the server returned for the whole query, which is where a filter
   * over free text gets its options: the page being drawn would list only the
   * values that happen to be on it.
   */
  facets?: Facets;
  /** The page being drawn; a definition may key a cache off its identity. */
  rows: EntityTableRow[K][];
};

/**
 * The per-kind half of the `DataTable` root's props: what a kind supplies, as
 * opposed to what every table derives from the kind alone.
 */
export type EntityTableParts<Row extends RowData, Child = never> = Pick<
  DataTableProps<Row, Child>,
  | "columns"
  | "editableCells"
  | "navigableColumns"
  | "newRow"
  | "filterColumns"
  | "filterPresets"
  | "groupByOptions"
  | "getRowGroupKey"
  | "subRows"
  | "cards"
  | "initiallyHiddenColumns"
  | "rowAccent"
  | "bulkCollections"
  | "onBulkAddToCollection"
  | "reorder"
  | "actions"
> & { mutationOptions?: Parameters<typeof useEntityMutations>[2] };

/** One column's page of a board: the status it holds and which page to fetch. */
type EntityBoardQuery = {
  page: number;
  pageSize: number;
  status: number;
  filters: TableSearchParams;
};

/**
 * What a kind supplies for its board: how one column's page is fetched and how
 * a row becomes a card. The board is not part of the table, so none of it is a
 * hook and none of it reads the table's parts.
 */
export type EntityBoardDefinition<K extends TableEntityKind> = {
  fetchPage: (
    projectId: number,
    query: EntityBoardQuery,
    scope?: EntityTableScope[K]
  ) => Promise<{ rows: EntityTableRow[K][]; rowCount: number } | ActionError>;
  toCard: (row: EntityTableRow[K]) => BoardCardData;
};

/**
 * One table kind's definition. `useParts` is a hook because a kind's parts
 * need hooks (memoised columns, a sub-row cache).
 */
export type EntityTableDefinition<K extends TableEntityKind> = {
  kind: K;
  /** The row field a rename writes, and the one the peek panel titles by. */
  identityField: "title" | "name";
  href: (
    row: EntityTableRow[K],
    projectId: number,
    scope?: EntityTableScope[K]
  ) => string;
  toPeekRow: (row: EntityTableRow[K]) => PeekRow;
  /**
   * The kind's paginated route query for one view, dropped of `page` (which
   * `serverPage.load` adds beside it) — each kind's own `pageQueryOf`
   * (`entities/<kind>/api.ts`). A kind with no scope of its own (collection)
   * takes the view alone.
   */
  pageQuery: (
    view: TableSearchParams,
    scope?: EntityTableScope[K]
  ) => Omit<QueryOf[K], "page">;
  /** Absent for a kind with no board view. */
  board?: EntityBoardDefinition<K>;
  useParts: (
    ctx: EntityTableContext<K>
  ) => EntityTableParts<EntityTableRow[K], EntityTableChild[K]>;
};
