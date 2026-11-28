import { AppLink } from "@/components/navigation/AppLink";
import { releasePhrase } from "@/lib/release";
import { useSetting } from "@/lib/settings/provider";
import type { ImageWidth } from "@/lib/utils";
import type { RowData } from "@tanstack/react-table";
import type { Label, PriorityLevel } from "@workspace/api/api";
import { Formatted } from "@workspace/ui/components/format-provider";
import { TrackCell } from "@workspace/ui/components/table";
import type { Formatters } from "@workspace/ui/lib/formatters";
import { cn } from "@workspace/ui/lib/utils";
import type { ReactNode } from "react";

import type { createAppColumnHelper } from "./data-table-hook";
import { LabelsCell } from "./LabelsCell";
import { PriorityBadge } from "./Priority";

/*
 * Column factories shared by the three entity tables. Each returns a column
 * definition from the table's own helper, so the value type of every column
 * still flows from the row type it is built for.
 */

type Helper<T extends RowData> = ReturnType<typeof createAppColumnHelper<T>>;

/**
 * The image width a row thumbnail asks the API for. `TrackCell` and the board
 * card draw theirs at 28–32 CSS pixels, which 64 covers on a 2× display.
 */
export const TABLE_THUMB_WIDTH: ImageWidth = 64;

/** The identity column's link: the row's thumb and title, underlined on hover. */
const TITLE_LINK =
  "block min-w-0 text-body font-medium text-ink underline-offset-4 hover:underline";

/**
 * The columns a grid navigates and copies: every editable column plus the
 * identity column, which is a link and so never editable, in column order.
 */
export function navigableColumnIds(
  columns: readonly { id?: string }[],
  editable: Record<string, unknown>,
  identityId: string
): string[] {
  return columns.flatMap(({ id }) =>
    id !== undefined && (id === identityId || id in editable) ? [id] : []
  );
}

export function idColumn<T extends { id: number }>(helper: Helper<T>) {
  return helper.accessor((row) => row.id, {
    id: "id",
    header: "ID",
    size: 72,
    minSize: 72,
    maxSize: 72,
    enableResizing: false,
    // The column is fixed at 72px specifically so "ID" always shows in
    // full; the sort-direction icon would eat into that on a header this
    // narrow, so it is dropped here even though the column still sorts.
    meta: { hideSortIndicator: true },
    // The id is the row's handle, and is never editable, so it carries the
    // peek affordance: a reliable target in every table regardless of which
    // other columns happen to be editable.
    cell: (info) => (
      <info.cell.PeekHandle>
        <span className="block text-right font-mono text-micro text-ink-soft tabular-nums motion-ink group-hover/id:text-ink">
          {info.getValue()}
        </span>
      </info.cell.PeekHandle>
    ),
  });
}

/**
 * The pinned identity column: a link to the row's page holding an optional
 * artwork thumb and the title, plus whatever the table wants trailing the
 * link (a "Main" flag, a session icon). The link is all the column does; the
 * cell's padding only places the cell cursor.
 */
export function titleColumn<T extends RowData>(
  helper: Helper<T>,
  config: {
    id: string;
    header: string;
    title: (row: T) => string;
    href: (row: T) => string;
    image?: (row: T) => string | null | undefined;
    leading?: (row: T) => ReactNode;
    trailing?: (row: T) => ReactNode;
  }
) {
  return helper.accessor((row) => config.title(row), {
    id: config.id,
    header: config.header,
    enableHiding: false,
    size: 280,
    minSize: 160,
    cell: (info) => (
      <TitleCell row={info.row.original} config={config}>
        {info.getValue()}
      </TitleCell>
    ),
  });
}

/** The identity cell on its own, for a sub-row drawn with the parent's grid. */
export function TitleCell<T>({
  row,
  config,
  children,
}: {
  row: T;
  config: {
    href: (row: T) => string;
    image?: (row: T) => string | null | undefined;
    leading?: (row: T) => ReactNode;
    trailing?: (row: T) => ReactNode;
  };
  children: ReactNode;
}) {
  const thumbnails = useSetting("tables.thumbnails");
  const text = <span className="block truncate">{children}</span>;
  const link = (
    <AppLink href={config.href(row)} className={TITLE_LINK}>
      {config.image && thumbnails ? (
        <TrackCell image={config.image(row)}>{text}</TrackCell>
      ) : (
        text
      )}
    </AppLink>
  );
  const leading = config.leading?.(row);
  const trailing = config.trailing?.(row);
  return leading || trailing ? (
    <span className="flex min-w-0 items-center gap-2">
      {leading}
      {link}
      {trailing}
    </span>
  ) : (
    link
  );
}

/**
 * The level a row carries, drawn from the row itself: a level deleted since the
 * page loaded still shows as it was. The value is the level's name, which is
 * what a copied cell holds and a paste parses back; a table sorting its own
 * rows orders them by rank, as the server does.
 */
export function priorityColumn<T extends { priority: PriorityLevel }>(
  helper: Helper<T>
) {
  return helper.accessor((row) => row.priority.name, {
    id: "priority",
    header: "Priority",
    size: 96,
    sortFn: (a, b) => a.original.priority.rank - b.original.priority.rank,
    cell: (info) => (
      <PriorityBadge level={info.row.original.priority} hideDefault />
    ),
  });
}

export function labelsColumn<T extends { id: number; labels?: Label[] }>(
  helper: Helper<T>,
  entityType: "track" | "collection" | "session",
  projectLabels: Label[]
) {
  return helper.accessor((row) => row.labels?.length ?? 0, {
    id: "labels",
    header: "Labels",
    enableSorting: false,
    cell: (info) => (
      <LabelsCell
        entityType={entityType}
        entityId={info.row.original.id}
        labels={info.row.original.labels}
        projectLabels={projectLabels}
      />
    ),
  });
}

/**
 * A plain scalar column: the accessor's value, rendered as-is, or as
 * `display` writes it from the row in the viewer's formats where the value
 * is a raw figure (a key, a tempo, a loudness) the viewer reads their own
 * way. The value stays what the column sorts and copies.
 */
export function textColumn<T extends RowData>(
  helper: Helper<T>,
  config: {
    id: string;
    header: string;
    value: (row: T) => string | number | null | undefined;
    display?: (row: T, format: Formatters) => ReactNode;
    sortable?: boolean;
    size?: number;
    minSize?: number;
    className?: string;
  }
) {
  const { display } = config;
  return helper.accessor((row) => config.value(row) ?? undefined, {
    id: config.id,
    header: config.header,
    enableSorting: config.sortable ?? true,
    ...(config.size != null ? { size: config.size } : {}),
    ...(config.minSize != null ? { minSize: config.minSize } : {}),
    cell: (info) => {
      const content = display ? (
        <Formatted>{(format) => display(info.row.original, format)}</Formatted>
      ) : (
        info.getValue()
      );
      return config.className ? (
        <span className={cn("block", config.className)}>{content}</span>
      ) : (
        content
      );
    },
  });
}

export function dateTimeColumn<T extends RowData>(
  helper: Helper<T>,
  config: {
    id: string;
    header: string;
    value: (row: T) => string | null | undefined;
  }
) {
  return helper.accessor((row) => config.value(row) ?? undefined, {
    id: config.id,
    header: config.header,
    cell: (info) => {
      const value = info.getValue();
      return value ? (
        <Formatted>{(format) => format.dateTime(value)}</Formatted>
      ) : undefined;
    },
  });
}

/**
 * A date read as "3 days ago", with the absolute date and time as its hover
 * title, or as the absolute date `dateTimeColumn` renders when
 * `tables.dateColumns` is `"absolute"`; "—" when there is none either way.
 */
export function relativeDateColumn<T extends RowData>(
  helper: Helper<T>,
  config: {
    id: string;
    header: string;
    value: (row: T) => string | null | undefined;
    size?: number;
  }
) {
  return helper.accessor((row) => config.value(row) ?? undefined, {
    id: config.id,
    header: config.header,
    ...(config.size != null ? { size: config.size } : {}),
    cell: (info) => {
      const value = info.getValue();
      if (!value) return <span className="text-ink-soft">—</span>;
      return <RelativeDateCell value={value} />;
    },
  });
}

function RelativeDateCell({ value }: { value: string }) {
  const dateColumns = useSetting("tables.dateColumns");
  if (dateColumns === "absolute") {
    return <Formatted>{(format) => format.dateTime(value)}</Formatted>;
  }
  return (
    <Formatted>
      {(format) => (
        <time title={format.dateTime(value)}>{format.relative(value)}</time>
      )}
    </Formatted>
  );
}

/** An integer count in tabular figures; a row with none reads 0. */
export function countColumn<T extends RowData>(
  helper: Helper<T>,
  config: {
    id: string;
    header: string;
    value: (row: T) => number | null | undefined;
    /** Narrower than the default for a column of short counts. */
    size?: number;
    /** Drops the sort-direction icon, which would eat a narrow header (as `idColumn` does). */
    hideSortIndicator?: boolean;
  }
) {
  return helper.accessor((row) => config.value(row) ?? 0, {
    id: config.id,
    header: config.header,
    ...(config.size != null ? { size: config.size } : {}),
    ...(config.hideSortIndicator ? { meta: { hideSortIndicator: true } } : {}),
    cell: (info) => (
      <span className="block text-right tabular-nums">{info.getValue()}</span>
    ),
  });
}

/** A calendar release date column (`YYYY-MM-DD`), rendered with a relative phrase and full date tooltip. */
export function releaseDateColumn<
  T extends { releaseDate: string | null | undefined },
>(helper: Helper<T>) {
  return helper.accessor((row) => row.releaseDate ?? undefined, {
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
  });
}

/** The trailing `updatedAt` / `createdAt` pair every entity table ends with. */
export function timestampColumns<
  T extends { updatedAt: string; createdAt: string },
>(helper: Helper<T>) {
  return [
    dateTimeColumn(helper, {
      id: "updatedAt",
      header: "Last Updated",
      value: (row) => row.updatedAt,
    }),
    dateTimeColumn(helper, {
      id: "createdAt",
      header: "Created At",
      value: (row) => row.createdAt,
    }),
  ];
}

/** Sizing for a leading play-only column (single transport button, no menu). */
export const PLAY_COLUMN_SIZE = {
  header: "",
  enableHiding: false,
  enableResizing: false,
  size: 56,
  minSize: 56,
  maxSize: 56,
} as const;

/** Sizing for a leading two-button column (play + overflow menu, e.g. files). */
export const ACTION_COLUMN_SIZE = {
  header: "",
  enableHiding: false,
  enableResizing: false,
  size: 88,
  minSize: 88,
  maxSize: 88,
} as const;
