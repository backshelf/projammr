"use client";

import { removeTrackFromCollection } from "@/actions/collections";
import { getTracksPageForProject, updateTrackNumber } from "@/actions/tracks";
import type { BulkSelection } from "@/entities/api";
import type { NewRowConfig } from "@/components/tables/DraftRow";
import type {
  CellValue,
  EditableCellConfig,
  FilterColumnConfig,
  TableAction,
} from "@/components/tables/generic-table-types";
import type { SubRowsConfig } from "@/components/tables/generic-table-types";
import {
  customFieldCells,
  customFieldFilterColumns,
  customFieldGroupings,
  customFieldGroupKey,
  customFieldKeys,
  customFieldSeed,
} from "@/components/tables/custom-field-parts";
import { customFieldWrites, isCustomFieldKey } from "@/fields/custom-field";
import { LabelsCell } from "@/components/tables/LabelsCell";
import { draftFieldsFrom } from "@/components/tables/new-row";
import type { PeekField, PeekRow } from "@/components/tables/PeekPanel";
import { priorityFilterColumn } from "@/components/tables/Priority";
import { archiveTracks, unarchiveTracks } from "@/entities/track/archive";
import { archivedScopeOf, pageQueryOf } from "@/entities/track/api";
import { sessionHref } from "@/entities/session/columns";
import {
  collectionTracksChanged,
  createEntity,
  linkTracksToCollection,
  removeTrackRelation,
} from "@/entities/mutations";
import type {
  EntityTableChild,
  EntityTableDefinition,
} from "@/entities/table-types";
import { defaultStatusRaw } from "@/components/forms/components/default-status";
import { useMutate } from "@/hooks/use-mutate";
import { useSetting } from "@/lib/settings/provider";
import { clientGetTrackSessions } from "@/lib/client-api";
import type { MutationRouter } from "@/lib/mutation";
import { customFieldFilters } from "@/lib/table-params";
import { IconArchive, IconArchiveOff } from "@tabler/icons-react";
import type { ListTrack } from "@workspace/api/api";
import { isActionError } from "@workspace/api/lib/action-result";
import { Formatted, useFormat } from "@workspace/ui/components/format-provider";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  type SessionRow,
  SessionTitle,
  trackColumns,
  trackCoverImage,
  trackHref,
} from "./columns";

/** The ids `trackToPeekRow` gives its fields — what a card's `keyFields` may name. */
type TrackPeekFieldId =
  "collections" | "releaseDate" | "bpm" | "key" | "id" | "isrc" | "iswc";

/** A track's row data projected onto the peek panel's shape — shared by the
 *  table and the board view, which both open the same panel from a row. */
function trackToPeekRow(row: ListTrack): PeekRow {
  const artists = Array.isArray(row.artists) ? row.artists : [];
  const fields: (PeekField & { id: TrackPeekFieldId })[] = [
    {
      id: "collections",
      label: "Collections",
      value: (row.collections ?? []).map((c) => c.title).join(", "),
    },
    {
      id: "releaseDate",
      label: "Release",
      value: row.releaseDate ? (
        <Formatted>{(format) => format.date(row.releaseDate!)}</Formatted>
      ) : null,
    },
    {
      id: "bpm",
      label: "BPM",
      value: row.bpm && (
        <Formatted>{(format) => format.tempo(row.bpm!)}</Formatted>
      ),
    },
    {
      id: "key",
      label: "Key",
      value: row.key && (
        <Formatted>
          {(format) => format.key(row.keyTonic, row.keyScale)}
        </Formatted>
      ),
    },
    { id: "id", label: "ID", value: row.id, mono: true },
    { id: "isrc", label: "ISRC", value: row.isrc, mono: true, span: 2 },
    { id: "iswc", label: "ISWC", value: row.iswc, mono: true },
  ];
  return {
    id: row.id,
    title: row.title,
    subtitle: artists.join(", "),
    flag: row.explicit ? "Explicit" : undefined,
    image: trackCoverImage(row),
    priority: row.priority,
    status: row.status,
    fields,
    related: [
      {
        label: "Collections",
        items: (row.collections ?? []).map((c) => ({
          id: c.id,
          label: c.title,
        })),
      },
      {
        label: "Sessions",
        items: (row.sessions ?? []).map((session) => ({
          id: session.id,
          label: session.name,
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

/** Where a track lives and its tempo: the two things a phone list can carry
 *  beside the artists. */
const TRACK_CARD_FIELDS: TrackPeekFieldId[] = ["collections", "bpm"];

/**
 * Archive on a live track, Unarchive on an archived one. A run of exactly one
 * id names that track (from `rows`) in its toast.
 */
export function trackTableActions(
  projectId: number,
  rows: ListTrack[],
  router: MutationRouter
): TableAction<ListTrack>[] {
  const titleOf = (selection: BulkSelection) =>
    selection.all || selection.ids.length !== 1
      ? undefined
      : rows.find((row) => row.id === selection.ids[0])?.title;

  return [
    {
      id: "archive",
      label: "Archive",
      icon: IconArchive,
      offered: (row) => row.archivedAt == null,
      run: (selection) =>
        archiveTracks({
          projectId,
          selection,
          title: titleOf(selection),
          router,
        }),
    },
    {
      id: "unarchive",
      label: "Unarchive",
      icon: IconArchiveOff,
      offered: (row) => row.archivedAt != null,
      run: (selection) =>
        unarchiveTracks({
          projectId,
          selection,
          title: titleOf(selection),
          router,
        }),
    },
  ];
}

export const trackTable = {
  kind: "track",
  identityField: "title",
  href: (row, projectId, scope) =>
    trackHref(row, projectId, scope?.collectionId),
  toPeekRow: trackToPeekRow,
  pageQuery: pageQueryOf,
  board: {
    fetchPage: async (
      projectId,
      { page, pageSize, status, filters },
      scope
    ) => {
      const result = await getTracksPageForProject(projectId, {
        page,
        pageSize,
        status,
        priority: filters.priority?.toString(),
        collection: scope?.collectionId ?? filters.collection,
        q: filters.q,
        relation: filters.relation,
        label: filters.label,
        artist: filters.artist,
        explicit: filters.explicit,
        ...customFieldFilters(filters),
        archived: archivedScopeOf(scope, filters),
      });
      if (isActionError(result)) return result;
      return { rows: result.rows, rowCount: result.rowCount };
    },
    toCard: (row) => ({
      id: row.id,
      title: row.title,
      subtitle: Array.isArray(row.artists) ? row.artists.join(", ") : "",
      image: trackCoverImage(row),
      priority: row.priority,
      archived: row.archivedAt !== null,
    }),
  },
  useParts: ({
    projectId,
    embedded,
    statuses,
    projectLabels,
    priorityLevels,
    relationTypes,
    customFields,
    facets,
    rows: tracks,
    scope: { collectionId, collections },
  }) => {
    const mutate = useMutate();
    const router = useRouter();

    const actions = useMemo(
      () => trackTableActions(projectId, tracks, router),
      [projectId, tracks, router]
    );

    const removeFromCollection = useCallback(
      async (targetCollectionId: number, trackId: number) => {
        const result = await removeTrackFromCollection(
          targetCollectionId,
          trackId
        );
        if (isActionError(result)) {
          toast.error(`Failed to unlink: ${result.error}`);
          return;
        }
        toast.success("Unlinked from collection");
        await mutate(collectionTracksChanged());
      },
      [mutate]
    );

    const removeRelation = useCallback(
      async (trackId: number, relationId: number) => {
        const result = await mutate(removeTrackRelation(trackId, relationId));
        if (isActionError(result)) {
          toast.error(`Failed to remove relation: ${result.error}`);
          return;
        }
        toast.success("Relation removed");
      },
      [mutate]
    );

    const columns = useMemo(
      () =>
        trackColumns(
          projectId,
          projectLabels,
          collectionId,
          removeFromCollection,
          removeRelation,
          customFields
        ),
      [
        projectId,
        projectLabels,
        collectionId,
        removeFromCollection,
        removeRelation,
        customFields,
      ]
    );

    const editableCells: Record<string, EditableCellConfig> = useMemo(
      () => ({
        artists: { type: "list", placeholder: "Comma-separated names" },
        priority: { type: "priority", priorityLevels },
        status: { type: "status", statuses },
        releaseDate: { type: "date" },
        isrc: { type: "text", placeholder: "USXX12300000" },
        iswc: { type: "text", placeholder: "T-00000000000" },
        explicit: { type: "checkbox" },
        ...(collectionId != null
          ? { trackNumber: { type: "number" as const, placeholder: "#" } }
          : {}),
        ...customFieldCells(customFields),
      }),
      [statuses, priorityLevels, collectionId, customFields]
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
        {
          id: "collections",
          label: "Collection",
          param: "collection",
          options: collections.map((c) => ({
            value: String(c.id),
            label: c.title,
          })),
        },
        {
          id: "relations",
          label: "Relation",
          param: "relation",
          options: [
            { value: "any", label: "Has any relation" },
            ...relationTypes.map((t) => ({
              value: String(t.id),
              label: t.name,
            })),
          ],
        },
        {
          id: "labels",
          label: "Label",
          param: "label",
          options: projectLabels.map((l) => ({
            value: String(l.id),
            label: l.name,
          })),
        },
        {
          id: "artists",
          label: "Artist",
          param: "artist",
          options: Object.keys(facets?.artist ?? {})
            .sort((a, b) => a.localeCompare(b))
            .map((name) => ({ value: name, label: name })),
        },
        {
          id: "explicit",
          label: "Explicit",
          param: "explicit",
          options: [
            { value: "true", label: "Explicit" },
            { value: "false", label: "Not explicit" },
          ],
        },
        ...customFieldFilterColumns(customFields),
      ],
      [
        statuses,
        priorityLevels,
        relationTypes,
        collections,
        projectLabels,
        facets,
        customFields,
      ]
    );

    const defaultStatusId = useSetting("project-defaults.trackStatusId");
    const defaultArtists = useSetting("project-defaults.artists");

    const newRow: NewRowConfig = useMemo(
      () => ({
        entityLabel: "track",
        defaults: {
          status: defaultStatusRaw(defaultStatusId, statuses),
          artists: defaultArtists.join(", "),
        },
        fields: draftFieldsFrom(
          editableCells,
          [
            "title",
            "artists",
            "status",
            "priority",
            ...customFieldKeys(customFields),
          ],
          {
            // The identity column is a link, not an editable cell, so its
            // draft input is declared here.
            title: {
              type: "text",
              placeholder: "Track title",
              required: true,
            },
            // Never a visible column, so only ever rendered (locked) when a
            // collection group header opens its "+ Add" row.
            collection: { type: "number" },
          }
        ),
        groupSeed: (groupParam, groupKey) => {
          const seed = customFieldSeed(customFields, groupParam, groupKey);
          if (seed) return seed;
          if (groupParam === "status")
            return { field: "status", value: Number(groupKey) };
          if (groupParam === "priority")
            return { field: "priority", value: Number(groupKey) };
          if (groupParam === "collection")
            return { field: "collection", value: Number(groupKey) };
          return null;
        },
        onCreate: async (draft) => {
          const artists = Array.isArray(draft.artists) ? draft.artists : [];
          const statusId =
            draft.status == null ? undefined : Number(draft.status);
          // A level id; with none, the server gives the track the default.
          const priorityId =
            draft.priority == null ? undefined : Number(draft.priority);
          const targetCollectionId =
            collectionId ??
            (draft.collection == null ? undefined : Number(draft.collection));

          const result = await mutate(
            createEntity(
              "track",
              {
                title: String(draft.title),
                artists,
                statusId,
                priorityId,
                projectId,
                fields: customFieldWrites(draft),
              },
              // A link follows when there's a target collection, and its own
              // "route" invalidation does the one refresh; with no link,
              // createEntity's default ["route"] refreshes here instead.
              targetCollectionId ? [] : ["route"]
            )
          );
          if (isActionError(result)) {
            toast.error(`Failed to create track: ${result.error}`);
            return false;
          }

          if (targetCollectionId) {
            // The list rows carry joined status, collections and sessions the
            // create response lacks, so let the link's own "route" refresh do
            // the one refetch rather than splice a partial row.
            const addResult = await mutate(
              linkTracksToCollection(targetCollectionId, [result.id])
            );
            if (isActionError(addResult)) {
              toast.error(
                `Failed to add track to collection: ${addResult.error}`
              );
              return false;
            }
          }

          toast.success(`Created "${String(draft.title)}"`);
          return true;
        },
      }),
      [
        editableCells,
        projectId,
        collectionId,
        mutate,
        customFields,
        statuses,
        defaultStatusId,
        defaultArtists,
      ]
    );

    const groupByOptions = useMemo(
      () => [
        { id: "status", label: "Status", filterParam: "status" },
        { id: "priority", label: "Priority", filterParam: "priority" },
        { id: "label", label: "Label", filterParam: "label" },
        { id: "artist", label: "Artist", filterParam: "artist" },
        ...customFieldGroupings(customFields),
      ],
      [customFields]
    );

    const getRowGroupKey = useCallback(
      (row: ListTrack, groupKey: string): string | string[] | null => {
        if (isCustomFieldKey(groupKey))
          return customFieldGroupKey(row, groupKey);
        if (groupKey === "priority") return String(row.priority.id);
        if (groupKey === "label")
          return (row.labels ?? []).map((l) => String(l.id));
        if (groupKey === "artist")
          return Array.isArray(row.artists) ? row.artists : [];
        return row.status?.id != null ? String(row.status.id) : null;
      },
      []
    );

    const mutationOptions = useMemo(
      () => ({
        // The number lives on the collection-track membership, so it is saved
        // through the collection rather than as a field on the track. Other
        // fields fall through to the default patch.
        saveField: async (
          rowId: number,
          field: string,
          value: CellValue
        ): Promise<boolean | undefined> => {
          if (field !== "trackNumber") return undefined;
          if (collectionId == null) return false;
          const next = Number(value);
          if (!Number.isFinite(next)) {
            toast.error("Track number must be a number");
            return false;
          }
          const result = await updateTrackNumber(collectionId, rowId, next);
          if (isActionError(result)) {
            toast.error(`Save failed: ${result.error}`);
            return false;
          }
          return true;
        },
      }),
      [collectionId]
    );

    const onBulkAddToCollection = useCallback(
      async (targetCollectionId: number, trackIds: number[]) => {
        const result = await mutate(
          linkTracksToCollection(targetCollectionId, trackIds)
        );
        return isActionError(result)
          ? { ok: false }
          : { ok: true, count: result.added };
      },
      [mutate]
    );

    // Full session rows per track, once the track has been expanded. Until the
    // fetch lands, the summaries the listing carries stand in. Keyed off the
    // `tracks` identity: a refetched page starts the caches over, so an
    // expanded track's children never go stale against a fresh parent.
    const [loadedSessions, setLoadedSessions] = useState<{
      forTracks: ListTrack[];
      byTrack: Record<number, SessionRow[]>;
    }>({ forTracks: tracks, byTrack: {} });
    const sessionsByTrack = useMemo(
      () => (loadedSessions.forTracks === tracks ? loadedSessions.byTrack : {}),
      [loadedSessions, tracks]
    );

    const handleRowExpand = useCallback(
      async (row: ListTrack) => {
        const result = await clientGetTrackSessions(row.id);
        if (isActionError(result)) {
          toast.error(`Failed to load sessions: ${result.error}`);
          return;
        }
        setLoadedSessions((prev) => ({
          forTracks: tracks,
          byTrack: {
            ...(prev.forTracks === tracks ? prev.byTrack : {}),
            [row.id]: result,
          },
        }));
      },
      [tracks]
    );

    const subRows: SubRowsConfig<ListTrack, EntityTableChild["track"]> =
      useMemo(
        () => ({
          getRows: (row) => sessionsByTrack[row.id] ?? row.sessions,
          onExpand: handleRowExpand,
          cells: {
            title: (session) => (
              <SessionTitle
                session={session}
                projectId={projectId}
                collectionId={collectionId}
              />
            ),
            artists: (session) => session.dawName ?? session.daw,
            key: (session) => (
              <Formatted>
                {(format) => format.key(session.rootNote, session.scale)}
              </Formatted>
            ),
            bpm: (session) =>
              session.tempo && (
                <Formatted>
                  {(format) => format.tempo(session.tempo!)}
                </Formatted>
              ),
            labels: (session) => (
              <LabelsCell
                entityType="session"
                entityId={session.id}
                projectLabels={projectLabels}
              />
            ),
          },
        }),
        [
          sessionsByTrack,
          handleRowExpand,
          projectLabels,
          projectId,
          collectionId,
        ]
      );

    const format = useFormat();
    const cards = useMemo(
      () => ({
        keyFields: TRACK_CARD_FIELDS,
        play: (row: ListTrack) => ({
          kind: "track" as const,
          id: row.id,
          title: row.title,
        }),
        childCard: (session: SessionRow) => ({
          id: session.id,
          title: session.name,
          subtitle: [
            session.dawName ?? session.daw,
            session.tempo && format.tempo(session.tempo, { unit: true }),
          ]
            .filter(Boolean)
            .join(" · "),
          href: sessionHref(session, projectId, collectionId),
        }),
      }),
      [projectId, collectionId, format]
    );

    const rowAccent = useMemo(
      () => ({ accentHex: (row: ListTrack) => row.status?.colourHex }),
      []
    );

    const initiallyHiddenColumns = useMemo(
      () => [
        "releaseDate",
        "isrc",
        "iswc",
        "explicit",
        "createdAt",
        ...(embedded ? ["collections"] : []),
        // Only a collection gives a track a number.
        ...(collectionId == null ? ["trackNumber"] : []),
        ...customFieldKeys(customFields),
      ],
      [embedded, collectionId, customFields]
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
      rowAccent,
      initiallyHiddenColumns,
      bulkCollections: collections,
      onBulkAddToCollection,
      mutationOptions,
      actions,
    };
  },
} satisfies EntityTableDefinition<"track">;
