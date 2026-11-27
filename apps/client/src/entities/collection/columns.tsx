"use client";

import { StatusDisplay } from "@/components/status/StatusDisplay";
import {
  idColumn,
  labelsColumn,
  PLAY_COLUMN_SIZE,
  priorityColumn,
  TABLE_THUMB_WIDTH,
  textColumn,
  timestampColumns,
  titleColumn,
} from "@/components/tables/columns";
import { customFieldColumns } from "@/components/tables/custom-field-columns";
import { TableRowPlay } from "@/components/tables/TableRowPlay";
import { hrefFromParsedRoute, imageUrl } from "@/lib/utils";
import { releasePhrase } from "@/lib/release";
import type { CustomField, Label, ListCollection } from "@workspace/api/api";
import { Formatted } from "@workspace/ui/components/format-provider";
import { createAppColumnHelper } from "@/components/tables/data-table-hook";

const columnHelper = createAppColumnHelper<ListCollection>();

export function collectionHref(row: ListCollection, projectId: number) {
  return hrefFromParsedRoute(
    { kind: "collection", collectionId: row.id },
    projectId
  );
}

export function collectionColumns(
  projectId: number,
  projectLabels: Label[],
  customFields: readonly CustomField[] = []
) {
  return columnHelper.columns([
    columnHelper.display({
      id: "play",
      ...PLAY_COLUMN_SIZE,
      cell: (info) => (
        <TableRowPlay
          kind="collection"
          id={info.row.original.id}
          title={info.row.original.title}
        />
      ),
    }),
    idColumn(columnHelper),
    titleColumn(columnHelper, {
      id: "title",
      header: "Title",
      title: (row) => row.title,
      href: (row) => collectionHref(row, projectId),
      image: (row) => imageUrl(row.image, TABLE_THUMB_WIDTH),
    }),
    priorityColumn(columnHelper),
    columnHelper.accessor((row) => row.status?.percentage ?? null, {
      id: "status",
      header: "Status",
      cell: (info) => {
        const status = info.row.original.status;
        if (!status) return <span className="text-ink-soft">—</span>;
        return <StatusDisplay status={status} variant="chip" />;
      },
    }),
    labelsColumn(columnHelper, "collection", projectLabels),
    columnHelper.accessor((row) => row.releaseDate ?? undefined, {
      id: "releaseDate",
      header: "Release",
      cell: (info) => {
        const releaseDate = info.getValue();
        if (!releaseDate) return undefined;
        return (
          <Formatted>
            {(format) => (
              <span title={format.date(releaseDate)}>
                {releasePhrase(releaseDate).label}
              </span>
            )}
          </Formatted>
        );
      },
    }),
    textColumn(columnHelper, {
      id: "upc",
      header: "UPC",
      value: (row) => row.upc,
    }),
    ...customFieldColumns(columnHelper, customFields),
    ...timestampColumns(columnHelper),
  ]);
}
