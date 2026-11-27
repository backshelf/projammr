import type { PlaybackSubject } from "@/components/music-player/use-playback";
import { navigableColumnIds } from "@/components/tables/columns";
import type { DataTableProps } from "@/components/tables/DataTable";
import type {
  PageResult,
  SavedViewsConfig,
} from "@/components/tables/generic-table-types";
import { ENTITY_API, selectionScopeOf } from "@/entities/api";
import type {
  EntityTableChild,
  EntityTableDefinition,
  EntityTableParts,
  EntityTableRow,
  EntityTableScope,
} from "@/entities/table-types";
import type { EntityModule } from "@/entities/types";
import type { useEntityMutations } from "@/hooks/use-entity-mutations";
import { browserApi } from "@/lib/browser-api";
import type { ApiClient } from "@workspace/api/lib/authed-client";
import { isActionError } from "@workspace/api/lib/action-result";
import type {
  ActionError,
  CustomField,
  Facets,
  GroupSummary,
  Label,
  PriorityScaleLevel,
  RelationTypeEntry,
  SavedView,
  Status,
  TableEntityKind,
} from "@workspace/api/api";

/**
 * The stand-in for a list prop a render site left out. One shared value, because
 * a fresh `[]` per render changes the identity of everything derived from it.
 */
export const EMPTY_LIST: never[] = [];

/** The handlers `useEntityMutations` hands a table. */
export type EntityMutationHandlers = ReturnType<typeof useEntityMutations>;

/** The page of one kind a render site hands `EntityTable` to draw. */
export type EntityTableProps<K extends TableEntityKind> = {
  kind: K;
  rows: EntityTableRow[K][];
  /**
   * Rows matching the query across every page. Absent where the rows are not a
   * server page — an embedded list already scoped to its parent — which is what
   * leaves the table to filter, sort and paginate the rows it was given.
   */
  rowCount?: number;
  /**
   * The page size the server answered `rows` with. Every later page is loaded
   * at the same size, since the loaded window's pages are offsets of it: a
   * page the router cache restored from before a `tables.rowsPerLoad` change
   * keeps loading at its own size rather than skipping rows.
   */
  pageSize?: number;
  facets?: Facets;
  groups?: GroupSummary[];
  projectId: number;
  /** Offered by the bulk bar's "Set status"; ignored by a kind with no status. */
  statuses?: Status[];
  projectLabels?: Label[];
  /** The project's priority scale, which the priority cells, filter and bulk menu offer. */
  priorityLevels?: PriorityScaleLevel[];
  /** The project's relation types, which the relation filter offers. Track only. */
  relationTypes?: RelationTypeEntry[];
  /** The project's custom fields for this kind: a column, a filter and a bulk "Set field…" each. */
  customFields?: CustomField[];
  savedViews?: SavedView[];
  /** The signed-in caller's id; `""` where `cachedMe()` failed to read it. */
  me?: string;
  /**
   * Rendered inside an entity page rather than as that kind's index. The rows
   * are already scoped to that entity, so table state stays out of the URL,
   * which the page owns.
   */
  embedded?: boolean;
  scope: EntityTableScope[K];
};

/**
 * The `DataTable` root's props for one kind, less what the page and embedded
 * variants each decide for themselves: the parts, the URL source and the
 * hotkey scope.
 */
export type EntityTableRootProps<K extends TableEntityKind> = Omit<
  DataTableProps<EntityTableRow[K], EntityTableChild[K]>,
  "children" | "urlState" | "hotkeys"
>;

/**
 * Builds the `DataTable` root's props for one kind's page: the definition's
 * parts as given, and everything a table derives from its kind alone — its
 * nouns, its identity field, its routes and its mutation handlers.
 *
 * Pure, so a kind's table is one function call away from being asserted on
 * without a render. `EntityTable` owns the hooks that produce the arguments.
 */
export function assembleEntityTableProps<K extends TableEntityKind>({
  definition,
  entity,
  parts,
  mutations,
  savedViews,
  props,
  rowsPerLoad,
  pinnedIdentityColumn,
}: {
  definition: EntityTableDefinition<K>;
  entity: EntityModule<K>;
  parts: EntityTableParts<EntityTableRow[K], EntityTableChild[K]>;
  mutations: EntityMutationHandlers;
  savedViews: SavedViewsConfig;
  props: EntityTableProps<K>;
  /** `tables.rowsPerLoad`: every load's `pageSize` when page 1 carries none. */
  rowsPerLoad: number;
  /** `tables.pinnedIdentityColumn`: pins the identity column when on. */
  pinnedIdentityColumn: boolean;
}): EntityTableRootProps<K> {
  const {
    rows,
    rowCount,
    facets,
    groups = EMPTY_LIST,
    projectId,
    statuses = EMPTY_LIST,
    projectLabels,
    priorityLevels,
    embedded = false,
    scope,
  } = props;
  const { identityField } = definition;
  const { nouns } = entity;
  // A module labels a row by its identity field, which the kind's list row
  // carries too. TypeScript can only relate the two row types once the kind is
  // concrete, and here it is still a parameter.
  const labelOf = entity.labelOf as (row: EntityTableRow[K]) => string;

  // A row's page under the parent it was listed from, which is what a link
  // copied out of this table should reopen.
  const href = (row: EntityTableRow[K]) =>
    definition.href(row, projectId, scope);

  // `mutationOptions` is the component's argument to `useEntityMutations`, and
  // the only part of a kind's parts that is not a `DataTable` prop.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { mutationOptions, ...fromParts } = parts;

  return {
    ...fromParts,
    data: rows,
    // The kind's own set wins; otherwise the identity column plus whatever the
    // kind made editable, which is the same answer for every kind.
    navigableColumns:
      parts.navigableColumns ??
      navigableColumnIds(
        parts.columns,
        parts.editableCells ?? {},
        identityField
      ),
    onCellSave: mutations.onCellSave,
    emptyText: `No ${nouns.plural} yet`,
    entityLabel: nouns.singular,
    pinnedColumnId: pinnedIdentityColumn ? identityField : undefined,
    serverPage:
      rowCount != null
        ? {
            rowCount,
            load: (page, view) =>
              // A generic `kind` widens `ENTITY_API[kind]` to a union across
              // the table kinds, which TypeScript will not call with one
              // kind's query — the same problem `createEntity` (`entities/
              // mutations.ts`) solves for `create`. The assertion re-narrows
              // the call to the pairing `definition.kind` already fixed;
              // `PageRowOf[K]` (`entities/api.ts`) is `EntityTableRow[K]`.
              (
                ENTITY_API[definition.kind].page as (
                  api: ApiClient,
                  projectId: number,
                  query: Record<string, unknown> & { page: number }
                ) => Promise<PageResult<EntityTableRow[K]> | ActionError>
              )(browserApi, projectId, {
                ...definition.pageQuery(view, scope),
                page,
                pageSize: props.pageSize ?? rowsPerLoad,
              }).then((result) => {
                if (isActionError(result)) throw new Error(result.error);
                return result;
              }),
            scopeParams: selectionScopeOf(definition.pageQuery({}, scope)),
          }
        : undefined,
    facets,
    serverGroups: groups,
    enableSelection: true,
    bulkStatuses: entity.hasStatus ? statuses : undefined,
    bulkLabels: projectLabels,
    bulkPriorityLevels: priorityLevels,
    bulkFields: props.customFields,
    onBulkPatch: mutations.onBulkPatch,
    onBulkDelete: mutations.onBulkDelete,
    deleteKind: definition.kind,
    onBulkSetLabels: mutations.onBulkSetLabels,
    onBulkMove: mutations.onBulkMove,
    // An embedded table keeps its state out of the URL, and a saved view is
    // nothing but that state under a name.
    savedViews: embedded ? undefined : savedViews,
    // The open row travels in the URL only where the table owns it.
    peek: {
      toPeekRow: definition.toPeekRow,
      href,
      titleField: identityField,
      inUrl: !embedded,
    },
    // A moved row leaves the parents it was listed under behind, so its URL in
    // the destination project names the row alone.
    moveToProject: {
      kind: definition.kind,
      projectId,
      hrefInProject: (row: EntityTableRow[K], targetProjectId: number) =>
        definition.href(row, targetProjectId),
    },
    rowActions: {
      copyHref: href,
      label: labelOf,
      onDelete: mutations.onRowDelete,
      play:
        definition.kind === "track" || definition.kind === "collection"
          ? (row: EntityTableRow[K]): PlaybackSubject => ({
              kind: definition.kind as "track" | "collection",
              id: row.id,
              title: labelOf(row),
              collectionId:
                definition.kind === "track"
                  ? (scope as EntityTableScope["track"]).collectionId
                  : undefined,
            })
          : undefined,
    },
  };
}
