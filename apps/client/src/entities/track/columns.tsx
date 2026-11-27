"use client";

import { AppLink } from "@/components/navigation/AppLink";
import {
  inverseRelationLabel,
  relationLabel,
} from "@/components/product-linking/RelationSelector";
import { StatusDisplay } from "@/components/status/StatusDisplay";
import {
  countColumn,
  idColumn,
  labelsColumn,
  PLAY_COLUMN_SIZE,
  priorityColumn,
  relativeDateColumn,
  releaseDateColumn,
  TABLE_THUMB_WIDTH,
  textColumn,
  timestampColumns,
  titleColumn,
} from "@/components/tables/columns";
import { customFieldColumns } from "@/components/tables/custom-field-columns";
import { ArchivedFlag } from "@/components/track/ArchivedFlag";
import { TableRowPlay } from "@/components/tables/TableRowPlay";
import { Tag, TrackTags } from "@/components/tables/TrackTags";
import { duplicateFlagLabel } from "@/components/track-audio/version-rows";
import { sessionHref } from "@/entities/session/columns";
import type { EntityTableChild } from "@/entities/table-types";
import { CheckboxDisplay } from "@/fields/checkbox";
import { formatLufs } from "@workspace/ui/lib/loudness";
import { hrefFromParsedRoute, imageUrl } from "@/lib/utils";
import { IconDeviceLaptop } from "@tabler/icons-react";
import type { CustomField, Label, ListTrack } from "@workspace/api/api";
import { StatusChip } from "@workspace/ui/components/status-chip";
import { createAppColumnHelper } from "@/components/tables/data-table-hook";

const columnHelper = createAppColumnHelper<ListTrack>();

export function trackHref(
  row: ListTrack,
  projectId: number,
  collectionId?: number
) {
  return hrefFromParsedRoute(
    { kind: "track", trackId: row.id, collectionId },
    projectId
  );
}

/**
 * A track's cover art, falling back to its first collection's — the same rule
 * the track page uses for its hero, so a track shows the same artwork wherever
 * it appears. Most tracks carry no image of their own and inherit the release's.
 */
export function trackCoverImage(row: ListTrack): string | null | undefined {
  return row.image || row.collections?.[0]?.image;
}

export function trackColumns(
  projectId: number,
  projectLabels: Label[],
  collectionId: number | undefined,
  onRemoveFromCollection: (collectionId: number, trackId: number) => void,
  onRemoveRelation: (trackId: number, relationId: number) => void,
  customFields: readonly CustomField[] = []
) {
  return columnHelper.columns([
    columnHelper.display({
      id: "play",
      ...PLAY_COLUMN_SIZE,
      cell: (info) => (
        <TableRowPlay
          kind="track"
          id={info.row.original.id}
          title={info.row.original.title}
          collectionId={collectionId}
        />
      ),
    }),
    idColumn(columnHelper),
    // The position within the collection being viewed. Absent everywhere else,
    // since the number belongs to the membership rather than the track.
    columnHelper.accessor((row) => row.trackNumber ?? undefined, {
      id: "trackNumber",
      header: "#",
      size: 64,
      minSize: 56,
      cell: (info) => (
        <span className="block text-right tabular-nums">{info.getValue()}</span>
      ),
    }),
    titleColumn(columnHelper, {
      id: "title",
      header: "Title",
      title: (row) => row.title,
      href: (row) => trackHref(row, projectId, collectionId),
      image: (row) => imageUrl(trackCoverImage(row), TABLE_THUMB_WIDTH),
      trailing: (row) => (
        <>
          {row.explicit && <ExplicitMark />}
          {row.duplicateOfVersion != null && (
            <DuplicateMark version={row.duplicateOfVersion} />
          )}
          {row.archivedAt != null && <ArchivedFlag />}
        </>
      ),
    }),
    // The value is the array itself, not its joined text: the column is an
    // editable `list` cell, and that kind formats and saves a `string[]`.
    columnHelper.accessor(
      (row) => (Array.isArray(row.artists) ? row.artists : []),
      {
        id: "artists",
        header: "Artists",
        enableSorting: false,
        cell: (info) => info.getValue().join(", "),
      }
    ),
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
    columnHelper.accessor((row) => row.collections?.length ?? 0, {
      id: "collections",
      header: "Collections",
      enableSorting: false,
      cell: (info) => (
        <TrackTags
          trackId={info.row.original.id}
          defaultTab="collection"
          linkedCollectionIds={info.row.original.collections.map((c) => c.id)}
          items={info.row.original.collections}
          getKey={(collection) => collection.id}
          renderItem={(collection) => (
            <Tag
              href={hrefFromParsedRoute(
                { kind: "collection", collectionId: collection.id },
                projectId
              )}
              onRemove={() =>
                onRemoveFromCollection(collection.id, info.row.original.id)
              }
            >
              {collection.title}
            </Tag>
          )}
        />
      ),
    }),
    columnHelper.accessor((row) => row.relations?.length ?? 0, {
      id: "relations",
      header: "Relations",
      enableSorting: false,
      cell: (info) => (
        <TrackTags
          trackId={info.row.original.id}
          defaultTab="relation"
          items={info.row.original.relations}
          getKey={(rel) => rel.id}
          renderItem={(rel) => (
            <Tag
              href={hrefFromParsedRoute(
                { kind: "track", trackId: rel.otherTrack.id },
                projectId
              )}
              onRemove={() => onRemoveRelation(info.row.original.id, rel.id)}
            >
              {rel.direction === "from"
                ? relationLabel(rel.relationType.name, rel.otherTrack.title)
                : inverseRelationLabel(
                    rel.relationType.name,
                    rel.otherTrack.title
                  )}
            </Tag>
          )}
        />
      ),
    }),
    labelsColumn(columnHelper, "track", projectLabels),
    releaseDateColumn(columnHelper),
    textColumn(columnHelper, {
      id: "isrc",
      header: "ISRC",
      value: (row) => row.isrc,
    }),
    textColumn(columnHelper, {
      id: "iswc",
      header: "ISWC",
      value: (row) => row.iswc,
    }),
    columnHelper.accessor((row) => row.explicit, {
      id: "explicit",
      header: "Explicit",
      size: 88,
      cell: (info) => (
        <CheckboxDisplay value={info.getValue()} label="Explicit" />
      ),
    }),
    textColumn(columnHelper, {
      id: "key",
      header: "Key",
      value: (row) => row.key,
      display: (row, format) => format.key(row.keyTonic, row.keyScale),
    }),
    textColumn(columnHelper, {
      id: "bpm",
      header: "BPM",
      value: (row) => row.bpm,
      display: (row, format) => row.bpm && format.tempo(row.bpm),
    }),
    textColumn(columnHelper, {
      id: "lufs",
      header: "LUFS",
      value: (row) => (row.lufs == null ? null : formatLufs(row.lufs)),
      display: (row, format) => row.lufs != null && format.lufs(row.lufs),
      className: "text-right tabular-nums",
    }),
    relativeDateColumn(columnHelper, {
      id: "lastSaveAt",
      header: "Last save",
      value: (row) => row.lastSaveAt,
    }),
    countColumn(columnHelper, {
      id: "saveCount",
      header: "Saves",
      value: (row) => row.saveCount,
    }),
    ...customFieldColumns(columnHelper, customFields),
    ...timestampColumns(columnHelper),
  ]);
}

/** The advisory mark beside an explicit track's title. */
function ExplicitMark() {
  return (
    <StatusChip flag colour="var(--ink-soft)" className="flex-none">
      <abbr title="Explicit" className="no-underline">
        E
      </abbr>
    </StatusChip>
  );
}

/** The badge beside a track's title when its primary audio's fingerprint
 *  matches an earlier version; the full "same audio as v3" reads in the
 *  tooltip rather than the badge itself, which stays as compact as the
 *  explicit mark beside it. */
function DuplicateMark({ version }: { version: number }) {
  const label = duplicateFlagLabel(version);
  return (
    <StatusChip flag colour="var(--ink-soft)" className="flex-none">
      <abbr title={label} className="no-underline">
        Dup
      </abbr>
    </StatusChip>
  );
}

/**
 * A session under an expanded track. The listing carries a summary; the full
 * row replaces it once the track's sessions have been fetched.
 */
export type SessionRow = EntityTableChild["track"];

/**
 * A session drawn as a sub-row: an icon, the name as a link to the session,
 * its "Main" flag.
 */
export function SessionTitle({
  session,
  projectId,
  collectionId,
}: {
  session: SessionRow;
  projectId: number;
  collectionId?: number;
}) {
  return (
    <span className="flex min-w-0 items-center gap-2 text-ink-soft">
      <IconDeviceLaptop
        size={14}
        className="flex-none text-ink-faint"
        aria-hidden
      />
      <AppLink
        href={sessionHref(session, projectId, collectionId)}
        className="min-w-0 truncate hover:underline"
      >
        {session.name}
      </AppLink>
      {session.main && (
        <StatusChip flag colour="var(--ink-soft)" className="flex-none">
          Main
        </StatusChip>
      )}
    </span>
  );
}
