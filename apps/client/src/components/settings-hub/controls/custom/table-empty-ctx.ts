import { EMPTY_LIST } from "@/components/tables/entity-table-props";
import type { EntityTableContext } from "@/entities/table-types";
import type { TableEntityKind } from "@workspace/api/api";

/**
 * The context a hub control's `useParts()` call reads `kind`'s columns, sort
 * options and grouping options through: the list page's table (not an
 * embedded one, which hides more columns by default), with no rows, no
 * project data beyond the id, and — for a hub page with no project
 * (`projectId` is `null`) — built-in columns only, since `customFields` stays
 * empty either way.
 */
export function emptyTableCtx<K extends TableEntityKind>(
  kind: K,
  projectId: number | null
): EntityTableContext<K> {
  const scope: EntityTableContext<K>["scope"] = (
    kind === "track"
      ? { collections: EMPTY_LIST }
      : kind === "session"
        ? { tracks: EMPTY_LIST, daws: EMPTY_LIST, machines: EMPTY_LIST }
        : {}
  ) as EntityTableContext<K>["scope"];

  return {
    projectId: projectId ?? 0,
    embedded: false,
    canEdit: false,
    statuses: EMPTY_LIST,
    projectLabels: EMPTY_LIST,
    priorityLevels: EMPTY_LIST,
    relationTypes: EMPTY_LIST,
    customFields: EMPTY_LIST,
    scope,
    rows: EMPTY_LIST,
  };
}
