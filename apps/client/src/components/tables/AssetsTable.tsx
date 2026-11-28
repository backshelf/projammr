"use client";

import { AppLink } from "@/components/navigation/AppLink";
import { type BulkSelection, selectedIdsOf } from "@/entities/api";
import { useMutate } from "@/hooks/use-mutate";
import { bulkDeleteAssets } from "@/lib/asset-mutations";
import { getAssetsPage } from "@/lib/asset-queries";
import { useSetting } from "@/lib/settings/provider";
import type { TableSearchParams } from "@/lib/table-params";
import { hrefFromParsedRoute } from "@/lib/utils";
import { Formatted } from "@workspace/ui/components/format-provider";
import type { AssetAttachment, AssetWithContext } from "@workspace/api/api";
import { isActionError } from "@workspace/api/lib/action-result";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar";
import { useCallback, useMemo } from "react";

import { AssetRowActions } from "./AssetRowActions";
import { ACTION_COLUMN_SIZE, dateTimeColumn, idColumn } from "./columns";
import { createAppColumnHelper } from "./data-table-hook";
import { DataTable, usePageTableState } from "./DataTable";
import { OverflowChipList } from "./OverflowChipList";

const columnHelper = createAppColumnHelper<AssetWithContext>();

/** The file's extension, upper-cased — "WAV" reads better than "audio/x-wav". */
function extensionOf(name: string) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toUpperCase() : "—";
}

function attachmentHref(attachment: AssetAttachment, projectId: number) {
  switch (attachment.kind) {
    case "track":
      return hrefFromParsedRoute(
        { kind: "track", trackId: attachment.id },
        projectId
      );
    case "collection":
      return hrefFromParsedRoute(
        { kind: "collection", collectionId: attachment.id },
        projectId
      );
    case "session":
      return hrefFromParsedRoute(
        { kind: "session", sessionId: attachment.id },
        projectId
      );
    case "project":
      return hrefFromParsedRoute({ kind: "project" }, projectId);
  }
}

function getColumns(projectId: number) {
  return columnHelper.columns([
    columnHelper.display({
      id: "actions",
      ...ACTION_COLUMN_SIZE,
      cell: (info) => (
        <AssetRowActions asset={info.row.original} projectId={projectId} />
      ),
    }),
    idColumn(columnHelper),
    columnHelper.accessor((row) => row.name, {
      id: "name",
      header: "Name",
      enableHiding: false,
      size: 320,
      cell: (info) => (
        <span className="block truncate text-body" title={info.getValue()}>
          {info.getValue()}
        </span>
      ),
    }),
    columnHelper.accessor((row) => extensionOf(row.name), {
      id: "format",
      header: "Format",
      // Not a server sort key: sorting by it would move the URL and change
      // nothing about the rows that come back.
      enableSorting: false,
      size: 96,
      cell: (info) => (
        <span className="font-mono text-micro text-ink-soft">
          {info.getValue()}
        </span>
      ),
    }),
    columnHelper.accessor((row) => row.size, {
      id: "size",
      header: "Size",
      size: 112,
      cell: (info) => (
        <span className="block text-right font-mono text-micro tabular-nums">
          <Formatted>{(format) => format.bytes(info.getValue())}</Formatted>
        </span>
      ),
    }),
    columnHelper.accessor(
      (row) => row.attachments.map((a) => a.title).join(", "),
      {
        id: "attachedTo",
        header: "Attached To",
        // Not a server sort key: sorting by it would move the URL and change
        // nothing about the rows that come back.
        enableSorting: false,
        size: 240,
        cell: (info) => {
          const { attachments } = info.row.original;
          if (attachments.length === 0)
            return <span className="text-ink-soft">Unattached</span>;
          return (
            <OverflowChipList
              items={attachments}
              maxVisible={2}
              getKey={(attachment) => `${attachment.kind}-${attachment.id}`}
              overflowLabel="attachments"
              listClassName="gap-x-2"
              renderItem={(attachment) => (
                <AppLink
                  href={attachmentHref(attachment, projectId)}
                  className="max-w-36 truncate text-small text-ink-soft underline-offset-4 hover:text-ink hover:underline"
                >
                  {attachment.title}
                </AppLink>
              )}
            />
          );
        },
      }
    ),
    columnHelper.accessor((row) => row.uploadedBy?.name ?? undefined, {
      id: "uploadedBy",
      header: "Uploaded By",
      // Not a server sort key: sorting by it would move the URL and change
      // nothing about the rows that come back.
      enableSorting: false,
      size: 180,
      cell: (info) => {
        const user = info.row.original.uploadedBy;
        if (!user) return <span className="text-ink-soft">—</span>;
        return (
          <span className="flex min-w-0 items-center gap-2">
            <Avatar className="size-5">
              {user.image && <AvatarImage src={user.image} alt="" />}
              <AvatarFallback className="text-micro">
                {user.name.slice(0, 1).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="truncate">{user.name}</span>
          </span>
        );
      },
    }),
    dateTimeColumn(columnHelper, {
      id: "createdAt",
      header: "Uploaded",
      value: (row) => row.createdAt,
    }),
  ]);
}

export function AssetsTable({
  assets,
  rowCount,
  projectId,
}: {
  assets: AssetWithContext[];
  rowCount: number;
  projectId: number;
}) {
  const columns = useMemo(() => getColumns(projectId), [projectId]);
  const mutate = useMutate();
  const pinnedIdentityColumn = useSetting("tables.pinnedIdentityColumn");

  const deleteAssets = useCallback(
    async (ids: number[]) => {
      const result = await mutate(bulkDeleteAssets(projectId, ids));
      return isActionError(result)
        ? { ok: false as const }
        : { ok: true as const, deleted: result.deleted };
    },
    [mutate, projectId]
  );

  const onBulkDelete = useCallback(
    (selection: BulkSelection) => deleteAssets(selectedIdsOf(selection) ?? []),
    [deleteAssets]
  );

  const rowActions = useMemo(
    () => ({
      label: (row: AssetWithContext) => row.name,
      onDelete: async (id: number) => deleteAssets([id]),
    }),
    [deleteAssets]
  );

  // The page's own table: the server pages the rows, so its state travels in
  // the URL and the URL source navigates.
  const serverPage = useMemo(
    () => ({
      rowCount,
      selectAllMatching: false,
      load: async (page: number, view: TableSearchParams) => {
        const result = await getAssetsPage(projectId, {
          page,
          q: view.q,
          sort: view.sort,
        });
        if (isActionError(result)) throw new Error(result.error);
        return result;
      },
    }),
    [rowCount, projectId]
  );
  const urlState = usePageTableState(serverPage);

  return (
    <DataTable
      data={assets}
      columns={columns}
      initiallyHiddenColumns={["id"]}
      emptyText="No files uploaded yet."
      // Files are deleted by id, so the "select all N" escalation — which
      // hands back a filter instead of ids — has nothing to resolve to.
      serverPage={serverPage}
      pinnedColumnId={pinnedIdentityColumn ? "name" : undefined}
      enableSelection
      entityLabel="file"
      deleteKind="file"
      onBulkDelete={onBulkDelete}
      rowActions={rowActions}
      urlState={urlState}
      hotkeys="page"
    >
      <DataTable.Toolbar />

      <DataTable.Grid />

      <DataTable.Paging />

      <DataTable.Selection />
    </DataTable>
  );
}
