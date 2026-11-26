"use client";

import { MachineLink } from "@/components/repo/LastPush";
import { useSetting } from "@/lib/settings/provider";
import { hrefFromParsedRoute } from "@/lib/utils";
import type { Repo } from "@workspace/api/api";
import { useMemo } from "react";

import { countColumn, textColumn, titleColumn } from "./columns";
import { createAppColumnHelper } from "./data-table-hook";
import { DataTable } from "./DataTable";

const columnHelper = createAppColumnHelper<Repo>();

/** How many branches a repo's sets hold between them. */
export const branchCount = (repo: Pick<Repo, "sets">) =>
  repo.sets.reduce((count, set) => count + set.branches.length, 0);

function getColumns(projectId: number, viewerId: string | null) {
  return columnHelper.columns([
    titleColumn(columnHelper, {
      id: "name",
      header: "Name",
      title: (row) => row.name,
      href: (row) =>
        hrefFromParsedRoute({ kind: "repo", repoId: row.id }, projectId),
    }),
    countColumn(columnHelper, {
      id: "sets",
      header: "Sets",
      value: (row) => row.sets.length,
      size: 88,
      hideSortIndicator: true,
    }),
    countColumn(columnHelper, {
      id: "branches",
      header: "Branches",
      value: branchCount,
      size: 112,
      hideSortIndicator: true,
    }),
    textColumn(columnHelper, {
      id: "lastPush",
      header: "Last Push",
      value: (row) => row.lastPushAt,
      size: 144,
      display: (row, format) =>
        row.lastPushAt == null ? (
          <span className="text-ink-soft">—</span>
        ) : (
          <time title={format.dateTime(row.lastPushAt)}>
            {format.relative(row.lastPushAt)}
          </time>
        ),
    }),
    textColumn(columnHelper, {
      id: "machine",
      header: "Machine",
      value: (row) => row.lastPushMachine?.name,
      size: 160,
      display: (row) =>
        row.lastPushMachine ? (
          <MachineLink machine={row.lastPushMachine} viewerId={viewerId} />
        ) : (
          <span className="text-ink-soft">—</span>
        ),
    }),
    textColumn(columnHelper, {
      id: "storage",
      header: "Storage",
      value: (row) => row.storage.setBytes + row.storage.sampleBytes,
      size: 120,
      className: "text-right tabular-nums",
      display: (row, format) =>
        format.bytes(row.storage.setBytes + row.storage.sampleBytes, 1),
    }),
  ]);
}

/**
 * The dit repositories holding a set of the page's tracks. Repo is not an
 * entity kind, so this is a `DataTable` directly (the `AssetsTable` route) with
 * nothing to delete or peek: a row's name opens the repo page, and its machine
 * opens that machine's row in Settings when the machine is the viewer's.
 */
export function ReposTable({
  repos,
  projectId,
  viewerId,
}: {
  repos: Repo[];
  projectId: number;
  /** The signed-in user, whose own machines link; `null` links none. */
  viewerId: string | null;
}) {
  const columns = useMemo(
    () => getColumns(projectId, viewerId),
    [projectId, viewerId]
  );
  const pinnedIdentityColumn = useSetting("tables.pinnedIdentityColumn");

  return (
    <DataTable
      data={repos}
      columns={columns}
      emptyText="No repositories."
      pinnedColumnId={pinnedIdentityColumn ? "name" : undefined}
      entityLabel="repository"
    >
      <DataTable.Grid />
    </DataTable>
  );
}
