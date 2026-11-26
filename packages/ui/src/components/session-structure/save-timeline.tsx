import type { SessionSave } from "@workspace/api/api";
import { Anchor, type LinkComponent } from "@workspace/ui/components/anchor";
import { SaveRowBody } from "@workspace/ui/components/session-structure/save-row-body";
import {
  defaultFormatters,
  type Formatters,
} from "@workspace/ui/lib/formatters";
import type { DiffChip } from "@workspace/session-diff";
import { LABEL } from "@workspace/ui/lib/shell";
import { cn } from "@workspace/ui/lib/utils";

export type SaveTimelineEntry = {
  id: number;
  fileUpdatedAt: string;
  machineName: string | null;
  source: SessionSave["source"];
  /** Computed by the caller, so `meta` never has to be serialised to the client. */
  chips: DiffChip[];
  /** What the save is of. A session's own history is already titled by the
   *  page it sits on; a project-wide feed mixes sessions and needs the name
   *  on the row. */
  title?: string;
};

type DayGroup<T> = {
  key: number;
  label: string;
  entries: T[];
};

/** Entries grouped by calendar day in the set's zone, in one pass so the
 *  group's day label comes from the entry that opened it rather than an
 *  index lookup. `entries` is assumed newest first, which the groups
 *  preserve. The two most recent days read as `Today`/`Yesterday`; older
 *  ones keep the dated label. */
function groupByDay<T extends SaveTimelineEntry>(
  entries: T[],
  asOf: Date,
  format: Formatters
): DayGroup<T>[] {
  const groups: DayGroup<T>[] = [];
  const indexByKey = new Map<number, number>();
  for (const entry of entries) {
    const key = format.calendarDay(entry.fileUpdatedAt);
    const index = indexByKey.get(key);
    if (index == null) {
      indexByKey.set(key, groups.length);
      groups.push({
        key,
        label: format.dayLabel(entry.fileUpdatedAt, asOf),
        entries: [entry],
      });
    } else {
      groups[index]?.entries.push(entry);
    }
  }
  return groups;
}

/** What an entry links out through (`LinkComponent`). */
export type TimelineLink = LinkComponent;

function TimelineEntryRow<T extends SaveTimelineEntry>({
  entry,
  hrefFor,
  link: Link,
  marked,
  format,
}: {
  entry: T;
  hrefFor: (entry: T) => string;
  link: TimelineLink;
  marked: boolean;
  format: Formatters;
}) {
  return (
    <Link
      href={hrefFor(entry)}
      className={cn(
        "-ml-px flex flex-col gap-1 border-l-2 py-2 pr-2 pl-4 motion-ink",
        "hover:bg-[color-mix(in_oklab,var(--ink)_4%,transparent)]",
        marked ? "border-l-art" : "border-l-transparent"
      )}
    >
      <SaveRowBody
        at={entry.fileUpdatedAt}
        stamp={format.time(entry.fileUpdatedAt)}
        title={entry.title}
        machineName={entry.machineName}
        source={entry.source}
        chips={entry.chips}
      />
    </Link>
  );
}

/**
 * A project or session's saves, newest first, grouped by day. Each entry
 * links out (`hrefFor`) and carries its own diff chips — the caller computes
 * them, so the save's raw `meta` never has to reach the client. `marked`
 * lights the left edge of specific entries (the history page uses it for the
 * pair currently being compared). Entries are generic over the timeline
 * shape, so a caller that needs more on the row than the timeline draws —
 * the project feed carries each save's destination — can hand `hrefFor` its
 * own type without a lookup back into the source data. `link` is the element
 * each entry links out through, a plain anchor unless the caller has a router
 * link to hand over. `asOf` fixes what "today" means: a server render passes
 * the moment it ran, a client caller passes a value fixed at mount so
 * hydration and later renders agree. `format` is the viewer's formatter set,
 * which the days and times are written and zoned by: `useFormat()` from a
 * client caller, `cachedFormatters()` from a server one. A page rendered
 * ahead of time has no viewer and passes `timeZone` instead, so its HTML is
 * written at the defaults in that zone rather than the zone of the machine
 * that built it.
 */
export function SaveTimeline<T extends SaveTimelineEntry>({
  entries,
  hrefFor,
  link = Anchor,
  marked,
  // A server render runs once per request, so the wall clock read here is
  // stable for that render; client callers pass a value fixed at mount.
  // eslint-disable-next-line @eslint-react/purity
  asOf = new Date(),
  format,
  timeZone,
}: {
  entries: T[];
  hrefFor: (entry: T) => string;
  link?: TimelineLink;
  marked?: Set<number>;
  asOf?: Date;
  format?: Formatters;
  timeZone?: string;
}) {
  if (entries.length === 0) return null;
  const formats = format ?? defaultFormatters(timeZone);

  return (
    <div className="border-l border-rule">
      {groupByDay(entries, asOf, formats).map((group) => (
        <div key={group.key}>
          <div className={cn(LABEL, "px-4 pt-4 pb-1 text-ink-soft")}>
            {group.label}
          </div>
          {group.entries.map((entry) => (
            <TimelineEntryRow
              key={entry.id}
              entry={entry}
              hrefFor={hrefFor}
              link={link}
              marked={marked?.has(entry.id) ?? false}
              format={formats}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
