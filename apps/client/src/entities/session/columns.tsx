"use client";

import { LinkToDialog } from "@/components/product-linking/LinkToDialog";
import { OpenInDawButton } from "@/components/session/OpenInDawButton";
import { holderOfRepo } from "@/components/session/open-in-daw";
import {
  countColumn,
  idColumn,
  labelsColumn,
  priorityColumn,
  relativeDateColumn,
  textColumn,
  timestampColumns,
  titleColumn,
} from "@/components/tables/columns";
import { OverflowChipList } from "@/components/tables/OverflowChipList";
import { Tag } from "@/components/tables/TrackTags";
import { useProjectRole } from "@/hooks/use-project-role";
import { hrefFromParsedRoute } from "@/lib/utils";
import { IconPlus } from "@tabler/icons-react";
import type { Label, ListSession, Machine } from "@workspace/api/api";
import { Button } from "@workspace/ui/components/button";
import { StatusChip } from "@workspace/ui/components/status-chip";
import { spellKey } from "@workspace/session-diff/musical-key";
import { createAppColumnHelper } from "@/components/tables/data-table-hook";

const columnHelper = createAppColumnHelper<ListSession>();

/** A session's page, under its track and the collection it was reached from. */
export function sessionHref(
  row: { id: number; trackId?: number | null },
  projectId: number,
  collectionId?: number
) {
  return hrefFromParsedRoute(
    {
      kind: "session",
      sessionId: row.id,
      trackId: row.trackId || undefined,
      collectionId,
    },
    projectId
  );
}

/** The "In dit" column's cell and the filter's option text for one value. */
export const inDitLabel = (inDit: boolean): "Yes" | "No" =>
  inDit ? "Yes" : "No";

function AssignSessionCell({ sessionId }: { sessionId: number }) {
  const canEdit = useProjectRole()?.can?.("editor") ?? true;
  if (!canEdit) return <span className="text-ink-soft">—</span>;
  return (
    <LinkToDialog targetKind="session" targetId={sessionId}>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Assign to a track"
        className="size-6 text-ink-soft hover:text-ink"
      >
        <IconPlus size={14} />
      </Button>
    </LinkToDialog>
  );
}

export function sessionColumns(
  projectId: number,
  projectLabels: Label[],
  collectionId: number | undefined,
  machines: readonly Machine[]
) {
  return columnHelper.columns([
    columnHelper.display({
      id: "actions",
      header: "",
      enableHiding: false,
      size: 96,
      minSize: 96,
      maxSize: 96,
      enableResizing: false,
      cell: (info) => {
        const session = info.row.original;
        return (
          <OpenInDawButton
            sessionId={session.id}
            holder={holderOfRepo(machines, session.repoId)}
            compact
          />
        );
      },
    }),
    idColumn(columnHelper),
    titleColumn(columnHelper, {
      id: "name",
      header: "Name",
      title: (row) => row.name,
      href: (row) => sessionHref(row, projectId, collectionId),
      // Main marks the session that represents the track; it sits beside the
      // name rather than standing in for any of the count columns.
      trailing: (row) =>
        row.main ? (
          <StatusChip flag colour="var(--ink-soft)" className="flex-none">
            Main
          </StatusChip>
        ) : null,
    }),
    textColumn(columnHelper, {
      id: "dawName",
      header: "DAW",
      size: 104,
      value: (row) => row.dawName ?? row.daw,
    }),
    priorityColumn(columnHelper),
    columnHelper.accessor((row) => row.track?.title ?? undefined, {
      id: "track",
      header: "Track",
      cell: (info) => {
        const session = info.row.original;
        const track = session.track;

        if (track) {
          return (
            <Tag
              href={hrefFromParsedRoute(
                { kind: "track", trackId: track.id },
                projectId
              )}
            >
              {track.title}
            </Tag>
          );
        }

        return <AssignSessionCell sessionId={session.id} />;
      },
    }),
    columnHelper.accessor(
      (row) => row.track?.collections?.map((c) => c.title).join(", ") ?? "",
      {
        id: "collection",
        header: "Collection",
        enableSorting: false,
        cell: (info) => {
          const collections = info.row.original.track?.collections ?? [];
          if (collections.length === 0)
            return <span className="text-ink-soft">—</span>;
          return (
            <OverflowChipList
              items={collections}
              maxVisible={2}
              getKey={(c) => c.id}
              overflowLabel="collections"
              renderItem={(c) => (
                <Tag
                  href={hrefFromParsedRoute(
                    { kind: "collection", collectionId: c.id },
                    projectId
                  )}
                >
                  {c.title}
                </Tag>
              )}
            />
          );
        },
      }
    ),
    labelsColumn(columnHelper, "session", projectLabels),
    textColumn(columnHelper, {
      id: "key",
      header: "Key",
      size: 88,
      value: (row) => spellKey(row.rootNote, row.scale, "sharps"),
      display: (row, format) => format.key(row.rootNote, row.scale),
    }),
    textColumn(columnHelper, {
      id: "tempo",
      header: "BPM",
      size: 76,
      value: (row) => row.tempo,
      display: (row, format) => row.tempo && format.tempo(row.tempo),
    }),
    textColumn(columnHelper, {
      id: "tracks",
      header: "Tracks",
      size: 76,
      value: (row) => row.tracksCount,
    }),
    textColumn(columnHelper, {
      id: "scenes",
      header: "Scenes",
      size: 76,
      value: (row) => row.scenesCount,
    }),
    textColumn(columnHelper, {
      id: "inDit",
      header: "In dit",
      size: 80,
      value: (row) => inDitLabel(row.inDit),
    }),
    relativeDateColumn(columnHelper, {
      id: "lastSaveAt",
      header: "Last save",
      value: (row) => row.lastSaveAt,
    }),
    countColumn(columnHelper, {
      id: "saveCount",
      header: "Saves",
      size: 76,
      value: (row) => row.saveCount,
    }),
    ...timestampColumns(columnHelper),
  ]);
}
