"use client";

import {
  BOARD_PAGE_SIZE,
  BoardView,
} from "@/components/tables/board/BoardView";
import { entityModule } from "@/entities";
import type { EntityTableRow, EntityTableScope } from "@/entities/table-types";
import { entityTable } from "@/entities/tables";
import { useEntityMutations } from "@/hooks/use-entity-mutations";
import { useProjectRole } from "@/hooks/use-project-role";
import type { TableSearchParams } from "@/lib/table-params";
import type { Status, TableEntityKind } from "@workspace/api/api";
import { useCallback } from "react";

/**
 * Any entity kind's board. The kind's definition supplies the column fetch and
 * the card projection through its `board`; the href, the peek panel and the
 * status move come from the kind as they do for its table.
 *
 * It takes a `kind` rather than a definition for the reason `EntityTable`
 * does: the pages that render it are server components, and a definition's
 * callbacks cannot cross that boundary. It does not build the table's parts:
 * the board is not the table.
 */
export function EntityBoard<K extends TableEntityKind>({
  kind,
  projectId,
  statuses,
  filters = {},
  scope,
}: {
  kind: K;
  projectId: number;
  statuses: Status[];
  filters?: TableSearchParams;
  scope?: EntityTableScope[K];
}) {
  const definition = entityTable(kind);
  const board = definition.board;
  if (!board) throw new Error(`The ${kind} kind has no board`);

  const mutations = useEntityMutations(kind, projectId);
  const canEdit = useProjectRole()?.can("editor") ?? true;

  const toPlay = useCallback(
    (row: EntityTableRow[K]) => {
      if (kind !== "track") return null;
      const track = row as { id: number; title?: string };
      return { kind: "track" as const, id: track.id, title: track.title };
    },
    [kind]
  );

  const fetchColumn = useCallback(
    (statusId: number, page: number) =>
      board.fetchPage(
        projectId,
        { page, pageSize: BOARD_PAGE_SIZE, status: statusId, filters },
        scope
      ),
    [board, projectId, filters, scope]
  );

  const href = useCallback(
    (row: EntityTableRow[K]) => definition.href(row, projectId, scope),
    [definition, projectId, scope]
  );

  const onMoveCard = useCallback(
    (rowId: number, newStatusId: number) =>
      mutations.onCellSave(rowId, "statusId", newStatusId),
    [mutations]
  );

  return (
    <BoardView<EntityTableRow[K]>
      statuses={statuses}
      fetchColumn={fetchColumn}
      toCard={board.toCard}
      toPeekRow={definition.toPeekRow}
      href={href}
      onMoveCard={onMoveCard}
      canEdit={canEdit}
      toPlay={kind === "track" ? toPlay : undefined}
      entityLabel={entityModule(kind).nouns.singular}
    />
  );
}
