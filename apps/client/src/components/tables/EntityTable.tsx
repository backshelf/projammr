"use client";

import { DataTable, usePageTableState } from "@/components/tables/DataTable";
import {
  assembleEntityTableProps,
  EMPTY_LIST,
  type EntityTableProps,
  type EntityTableRootProps,
} from "@/components/tables/entity-table-props";
import { useSavedViews } from "@/components/tables/use-saved-views";
import { entityModule } from "@/entities";
import {
  type EntityTableChild,
  type EntityTableContext,
  type EntityTableRow,
} from "@/entities/table-types";
import { entityTable } from "@/entities/tables";
import { useEntityMutations } from "@/hooks/use-entity-mutations";
import { useProjectRole } from "@/hooks/use-project-role";
import { useShallowStable } from "@/hooks/use-shallow-stable";
import { BUILT_IN_VIEW_QUERY } from "@/lib/default-view";
import { useSetting } from "@/lib/settings/provider";
import type { TableEntityKind } from "@workspace/api/api";
import { useMemo } from "react";

/**
 * Any entity kind's table. The kind's definition supplies the columns, the
 * editors and the hierarchy; everything else — the nouns, the routes, the
 * mutation handlers, the saved views — is derived from the kind here, so the
 * three kinds share one table rather than three copies of one.
 *
 * It takes a `kind` rather than a definition because the pages that render it
 * are server components, which cannot send a definition's hooks and callbacks
 * across the boundary. The definition is looked up here, in the browser.
 *
 * The `DataTable` root keys its own memos on the props it is handed, so the props
 * assembled here hold their identity for as long as what they are built from
 * does: `ctx` while the page is unchanged, the definition's parts while their
 * members are, and the assembled set while all of those are.
 */
export function EntityTable<K extends TableEntityKind>(
  props: EntityTableProps<K>
) {
  const { kind, projectId } = props;
  const definition = entityTable(kind);
  const entity = entityModule(kind);
  const canEdit = useProjectRole()?.can("editor") ?? true;
  // Loads follow page 1's own size (`props.pageSize`); the setting only
  // stands in where the rows came without one.
  const rowsPerLoad = useSetting("tables.rowsPerLoad");
  const pinnedIdentityColumn = useSetting("tables.pinnedIdentityColumn");

  const ctx: EntityTableContext<K> = useMemo(
    () => ({
      projectId,
      embedded: props.embedded ?? false,
      canEdit,
      statuses: props.statuses ?? EMPTY_LIST,
      projectLabels: props.projectLabels ?? EMPTY_LIST,
      priorityLevels: props.priorityLevels ?? EMPTY_LIST,
      relationTypes: props.relationTypes ?? EMPTY_LIST,
      customFields: props.customFields ?? EMPTY_LIST,
      scope: props.scope,
      facets: props.facets,
      rows: props.rows,
    }),
    [projectId, canEdit, props]
  );

  // Unconditional: a mounted table's kind never changes, so the definition
  // whose hook this is never changes either. A definition memoises its columns
  // and its hierarchy but returns them in a fresh object, so the object itself
  // is what has to be held still.
  const parts = useShallowStable(definition.useParts(ctx));
  const mutations = useEntityMutations(kind, projectId, parts.mutationOptions);
  const savedViews = useSavedViews(
    projectId,
    kind,
    props.savedViews,
    props.me ?? ""
  );

  // Assembling is pure, but the props it builds are read by the `DataTable`
  // root's own memos, so they keep their identity for as long as their inputs do.
  const tableProps = useMemo(
    () =>
      assembleEntityTableProps({
        definition,
        entity,
        parts,
        mutations,
        savedViews,
        props,
        rowsPerLoad,
        pinnedIdentityColumn,
      }),
    [
      definition,
      entity,
      parts,
      mutations,
      savedViews,
      props,
      rowsPerLoad,
      pinnedIdentityColumn,
    ]
  );

  return props.embedded ? (
    <EmbeddedEntityTable<K> {...tableProps} />
  ) : (
    <PageEntityTable<K> {...tableProps} />
  );
}

/**
 * The kind's table as the page's own: its view state travels in the URL, and it
 * claims the hotkey scope from mount. The URL source navigates when the server
 * pages the rows.
 */
function PageEntityTable<K extends TableEntityKind>(
  props: EntityTableRootProps<K>
) {
  const urlState = usePageTableState(props.serverPage, BUILT_IN_VIEW_QUERY);

  return (
    <DataTable<EntityTableRow[K], EntityTableChild[K]>
      {...props}
      urlState={urlState}
      hotkeys="page"
    >
      <EntityTableLayout<K> />
    </DataTable>
  );
}

/**
 * The kind's table inside an entity page: the view state stays in React, since
 * the URL belongs to the page, and the hotkey scope follows the pointer or
 * focus.
 */
function EmbeddedEntityTable<K extends TableEntityKind>(
  props: EntityTableRootProps<K>
) {
  return (
    <DataTable<EntityTableRow[K], EntityTableChild[K]> {...props}>
      <EntityTableLayout<K> />
    </DataTable>
  );
}

/** The parts every entity table renders, in the order they render. */
function EntityTableLayout<K extends TableEntityKind>() {
  return (
    <>
      <DataTable.Toolbar<EntityTableRow[K], EntityTableChild[K]>>
        <DataTable.SavedViews<EntityTableRow[K], EntityTableChild[K]> />
      </DataTable.Toolbar>

      <DataTable.Cards<EntityTableRow[K], EntityTableChild[K]> />

      <DataTable.Grid<EntityTableRow[K], EntityTableChild[K]> />

      <DataTable.Paging />

      <DataTable.Selection />

      <DataTable.Peek<EntityTableRow[K], EntityTableChild[K]> />

      <DataTable.Move />
    </>
  );
}
