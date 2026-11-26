"use client";

import { getCollectionsPageForProject } from "@/actions/projects";
import { PlayAffordance } from "@/components/music-player/PlayAffordance";
import { TABLE_THUMB_WIDTH, TitleCell } from "@/components/tables/columns";
import {
  customFieldCells,
  customFieldFilterColumns,
  customFieldGroupings,
  customFieldGroupKey,
  customFieldKeys,
  customFieldSeed,
} from "@/components/tables/custom-field-parts";
import { customFieldWrites, isCustomFieldKey } from "@/fields/custom-field";
import type { NewRowConfig } from "@/components/tables/DraftRow";
import type {
  EditableCellConfig,
  FilterColumnConfig,
} from "@/components/tables/generic-table-types";
import type { SubRowsConfig } from "@/components/tables/generic-table-types";
import { draftFieldsFrom } from "@/components/tables/new-row";
import type { PeekField, PeekRow } from "@/components/tables/PeekPanel";
import {
  PriorityBadge,
  priorityFilterColumn,
} from "@/components/tables/Priority";
import {
  collectionColumns,
  collectionHref,
} from "@/entities/collection/columns";
import { pageQueryOf } from "@/entities/collection/api";
import { createEntity } from "@/entities/mutations";
import type {
  EntityTableChild,
  EntityTableDefinition,
} from "@/entities/table-types";
import { defaultStatusRaw } from "@/components/forms/components/default-status";
import { useMutate } from "@/hooks/use-mutate";
import { customFieldFilters } from "@/lib/table-params";
import { useSetting } from "@/lib/settings/provider";
import { hrefFromParsedRoute, imageUrl } from "@/lib/utils";
import type { ListCollection } from "@workspace/api/api";
import { isActionError } from "@workspace/api/lib/action-result";
import { Formatted } from "@workspace/ui/components/format-provider";
import { rowPlay, rowPlayAlways } from "@workspace/ui/components/table";
import { useCallback, useMemo } from "react";
import { toast } from "sonner";

/** A member track's own page, outside the collection it was reached through. */
function collectionTrackHref(
  track: EntityTableChild["collection"],
  projectId: number
) {
  return hrefFromParsedRoute({ kind: "track", trackId: track.id }, projectId);
}

/** The ids `collectionToPeekRow` gives its fields — what a card's `keyFields`
 *  may name. */
type CollectionPeekFieldId = "releaseDate" | "tracks" | "upc" | "id";

/** The card's meta line: the release date and the track count. */
const COLLECTION_CARD_FIELDS: CollectionPeekFieldId[] = [
  "releaseDate",
  "tracks",
];

/** A collection's row data projected onto the peek panel's shape — shared by
 *  the table and the board view, which both open the same panel from a row. */
function collectionToPeekRow(row: ListCollection): PeekRow {
  const trackCount = row.tracks?.length ?? 0;
  const fields: (PeekField & { id: CollectionPeekFieldId })[] = [
    {
      id: "releaseDate",
      label: "Release",
      value: row.releaseDate ? (
        <Formatted>{(format) => format.date(row.releaseDate!)}</Formatted>
      ) : null,
    },
    { id: "tracks", label: "Tracks", value: trackCount },
    { id: "upc", label: "UPC", value: row.upc, mono: true, span: 2 },
    { id: "id", label: "ID", value: row.id, mono: true },
  ];
  return {
    id: row.id,
    title: row.title,
    subtitle: `${trackCount} ${trackCount === 1 ? "track" : "tracks"}`,
    image: row.image,
    priority: row.priority,
    status: row.status,
    fields,
    related: [
      {
        label: "Tracks",
        items: (row.tracks ?? []).map((t) => ({
          id: t.id,
          label: t.title,
        })),
      },
      {
        label: "Labels",
        items: (row.labels ?? []).map((l) => ({
          id: l.id,
          label: l.name,
        })),
      },
    ],
  };
}

export const collectionTable = {
  kind: "collection",
  identityField: "title",
  href: collectionHref,
  toPeekRow: collectionToPeekRow,
  pageQuery: pageQueryOf,
  board: {
    fetchPage: async (projectId, { page, pageSize, status, filters }) => {
      const result = await getCollectionsPageForProject(projectId, {
        page,
        pageSize,
        status,
        q: filters.q,
        priority: filters.priority?.toString(),
        ...customFieldFilters(filters),
      });
      if (isActionError(result)) return result;
      return { rows: result.rows, rowCount: result.rowCount };
    },
    toCard: (row) => ({
      id: row.id,
      title: row.title,
      subtitle: `${row.tracks?.length ?? 0} tracks`,
      image: row.image,
      priority: row.priority,
    }),
  },
  useParts: ({
    projectId,
    projectLabels,
    statuses,
    priorityLevels,
    customFields,
  }) => {
    const mutate = useMutate();
    const columns = useMemo(
      () => collectionColumns(projectId, projectLabels, customFields),
      [projectId, projectLabels, customFields]
    );

    const editableCells: Record<string, EditableCellConfig> = useMemo(
      () => ({
        priority: { type: "priority", priorityLevels },
        status: { type: "status", statuses },
        releaseDate: { type: "date" },
        upc: { type: "text", placeholder: "UPC" },
        ...customFieldCells(customFields),
      }),
      [statuses, priorityLevels, customFields]
    );

    const filterColumns: FilterColumnConfig[] = useMemo(
      () => [
        {
          id: "status",
          label: "Status",
          param: "status",
          options: statuses.map((s) => ({
            value: String(s.id),
            label: s.name,
          })),
        },
        priorityFilterColumn(priorityLevels),
        ...customFieldFilterColumns(customFields),
      ],
      [statuses, priorityLevels, customFields]
    );

    const cards = useMemo(
      () => ({
        keyFields: COLLECTION_CARD_FIELDS,
        play: (row: ListCollection) => ({
          kind: "collection" as const,
          id: row.id,
          title: row.title,
        }),
        childCard: (track: EntityTableChild["collection"]) => ({
          id: track.id,
          title: track.title,
          subtitle: track.priority.name,
          href: collectionTrackHref(track, projectId),
        }),
      }),
      [projectId]
    );

    const initiallyHiddenColumns = useMemo(
      () => ["createdAt", ...customFieldKeys(customFields)],
      [customFields]
    );

    const defaultStatusId = useSetting("project-defaults.collectionStatusId");

    const newRow: NewRowConfig = useMemo(
      () => ({
        entityLabel: "collection",
        defaults: { status: defaultStatusRaw(defaultStatusId, statuses) },
        fields: draftFieldsFrom(
          editableCells,
          ["title", "status", "releaseDate", ...customFieldKeys(customFields)],
          // The identity column is a link, not an editable cell, so its draft
          // input is declared here.
          {
            title: {
              type: "text",
              placeholder: "Collection title",
              required: true,
            },
          }
        ),
        groupSeed: (groupParam, groupKey) =>
          customFieldSeed(customFields, groupParam, groupKey),
        onCreate: async (draft) => {
          // With none, the server fills the collection's status.
          const statusId =
            draft.status == null ? undefined : Number(draft.status);
          const releaseDate =
            typeof draft.releaseDate === "string" ? draft.releaseDate : null;

          const result = await mutate(
            createEntity("collection", {
              title: String(draft.title),
              projectId,
              statusId,
              releaseDate,
              fields: customFieldWrites(draft),
            })
          );
          if (isActionError(result)) {
            toast.error(`Failed to create collection: ${result.error}`);
            return false;
          }
          // The list rows carry a joined status the create response lacks, so
          // the default `createEntity` refresh refetches rather than splicing
          // in a partial row.
          toast.success(`Created "${String(draft.title)}"`);
          return true;
        },
      }),
      [
        editableCells,
        projectId,
        mutate,
        customFields,
        statuses,
        defaultStatusId,
      ]
    );

    const groupByOptions = useMemo(
      () => [
        { id: "status", label: "Status", filterParam: "status" },
        { id: "priority", label: "Priority", filterParam: "priority" },
        ...customFieldGroupings(customFields),
      ],
      [customFields]
    );

    const getRowGroupKey = useCallback(
      (row: ListCollection, groupKey: string) =>
        isCustomFieldKey(groupKey)
          ? customFieldGroupKey(row, groupKey)
          : groupKey === "priority"
            ? String(row.priority.id)
            : row.status?.id != null
              ? String(row.status.id)
              : null,
      []
    );

    const trackTitleConfig = useMemo(
      () => ({
        href: (track: EntityTableChild["collection"]) =>
          collectionTrackHref(track, projectId),
        image: (track: EntityTableChild["collection"]) =>
          imageUrl(track.image, TABLE_THUMB_WIDTH),
      }),
      [projectId]
    );

    const hoverPlay = useSetting("tables.hoverPlay");
    const subRows: SubRowsConfig<
      ListCollection,
      EntityTableChild["collection"]
    > = useMemo(
      () => ({
        getRows: (row) => row.tracks,
        cells: {
          play: (track) => (
            <PlayAffordance
              kind="track"
              id={track.id}
              title={track.title}
              className={hoverPlay === "always" ? rowPlayAlways : rowPlay}
            />
          ),
          title: (track) => (
            <TitleCell row={track} config={trackTitleConfig}>
              {track.title}
            </TitleCell>
          ),
          priority: (track) => <PriorityBadge level={track.priority} />,
        },
      }),
      [trackTitleConfig, hoverPlay]
    );

    return {
      columns,
      editableCells,
      filterColumns,
      newRow,
      groupByOptions,
      getRowGroupKey,
      subRows,
      cards,
      initiallyHiddenColumns,
    };
  },
} satisfies EntityTableDefinition<"collection">;
