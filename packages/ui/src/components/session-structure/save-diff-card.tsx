import type { SessionSave } from "@workspace/api/api";
import { DiffReadouts } from "@workspace/ui/components/session-structure/diff-readouts";
import { SampleDelta } from "@workspace/ui/components/session-structure/sample-delta";
import { SetSkyline } from "@workspace/ui/components/session-structure/set-skyline";
import { StructureOutline } from "@workspace/ui/components/session-structure/structure-outline";
import { pluralizeCount } from "@workspace/session-diff/format";
import {
  defaultFormatters,
  type Formatters,
} from "@workspace/ui/lib/formatters";
import {
  changedTrackCount,
  type SaveDiff,
  type StructureDiff,
} from "@workspace/session-diff";
import { LABEL } from "@workspace/ui/lib/shell";
import { cn } from "@workspace/ui/lib/utils";
import type { ReactNode } from "react";

/** One save as the card's header names it. */
export type SaveStamp = {
  /** When the file was saved, as an ISO timestamp. */
  at: string;
  /** The machine it was saved on. */
  machine?: string | null;
};

/** A recorded save as the card's header names it. */
export const stampOf = (
  save: Pick<SessionSave, "fileUpdatedAt" | "machineName">
): SaveStamp => ({ at: save.fileUpdatedAt, machine: save.machineName });

/**
 * When the two saves a card compares were made, in one line: the day, then
 * the two times when both fall on it, or a day and time each when they do
 * not. A first save says so. The two most recent days read as "Today" and
 * "Yesterday" against `asOf`; days and times are written and zoned by
 * `format`.
 */
export function savePairLabel(
  { before, after }: { before: SaveStamp | null; after: SaveStamp },
  { asOf, format }: { asOf: Date; format: Formatters }
): string {
  const dayOf = (iso: string) => format.dayLabel(iso, asOf);

  if (!before)
    return `${dayOf(after.at)} · ${format.time(after.at)} · first save seen`;
  return format.calendarDay(before.at) === format.calendarDay(after.at)
    ? `${dayOf(after.at)} · ${format.time(before.at)} → ${format.time(after.at)}`
    : `${dayOf(before.at)} ${format.time(before.at)} → ${dayOf(after.at)} ${format.time(after.at)}`;
}

/** "40 tracks · 2 changed": the set as the newer save has it, and how much of it the save touched. */
function trackCount(structure: StructureDiff): string {
  const present = structure.rows.filter((row) => row.status !== "removed");
  const changed = changedTrackCount(structure);
  const tracks = pluralizeCount(present.length, "track");
  return changed > 0 ? `${tracks} · ${changed} changed` : tracks;
}

/**
 * One save of a session against the one before it, on glass: the pair of
 * saves, the set drawn as a skyline in the DAW's own colours with what the
 * save changed marked on it, the values that moved each on its gauge, and the
 * set's outline with the changes drawn on its rows. Pure markup, so the site
 * renders it to static HTML; the client wraps it in `SaveDiffControls`, whose
 * switch and stepper go in `actions`, to link rows and bars, filter to the
 * changes and step through them. `diff` comes from `diffSave`, so the card
 * shows only what the session's DAW reports.
 *
 * The header says when the two saves were made and, under it, where the
 * newer one was. The file's name is not repeated there: the page around the
 * card names the set, and a page that shows the card on its own names it in
 * a caption (`children`). `format` is the viewer's formatter set the times
 * are written in; a page rendered ahead of time has no viewer and passes
 * `timeZone` instead, for the defaults in that zone.
 */
export function SaveDiffCard({
  as: Root = "div",
  diff,
  saves,
  daw,
  when,
  actions,
  collapseUnchanged = false,
  // A server render runs once per request, so the wall clock read here is
  // stable for that render; a page rendered ahead of time passes its own.
  // eslint-disable-next-line @eslint-react/purity
  asOf = new Date(),
  format,
  timeZone,
  className,
  children,
}: {
  /** A `figure` where the card is the proof a page shows, captioned by `children`. */
  as?: "div" | "figure";
  diff: SaveDiff;
  saves: { before: SaveStamp | null; after: SaveStamp };
  /** The DAW and version the newer save was written in ("Ableton Live 12.3"). */
  daw?: string;
  /**
   * What the header says about when the two saves were made, in place of
   * their times: a page that lets the reader choose the saves puts its
   * pickers here, since they name the same two saves.
   */
  when?: ReactNode;
  /** Controls for the card, set at the right of its header. */
  actions?: ReactNode;
  /** Fold runs of unchanged tracks behind a disclosure, for a card no client filters. */
  collapseUnchanged?: boolean;
  asOf?: Date;
  format?: Formatters;
  timeZone?: string;
  className?: string;
  /** What heads the card above its own header, such as a caption. */
  children?: ReactNode;
}) {
  // Where the newer save was made: the DAW that wrote it and the machine.
  const where = [daw, saves.after.machine].filter(Boolean).join(" · ");
  const formats = format ?? defaultFormatters(timeZone);

  return (
    <Root
      data-slot="save-diff"
      className={cn(
        "@container/save-diff flex min-w-0 flex-col gap-6 border-l border-glass-edge bg-glass p-6 backdrop-blur-[20px] backdrop-saturate-[1.2] phone:p-4",
        className
      )}
    >
      {children}
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          {when ?? (
            <p className={cn(LABEL, "text-ink")}>
              {savePairLabel(saves, { asOf, format: formats })}
            </p>
          )}
          {where && <p className={cn(LABEL, "text-ink-soft")}>{where}</p>}
        </div>
        {actions != null && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {actions}
          </div>
        )}
      </header>
      {diff.structure && <SetSkyline structure={diff.structure} />}
      <DiffReadouts readouts={diff.readouts} format={formats} />
      {!diff.first && !diff.changed && (
        <p className="text-small text-ink-soft">
          Nothing recorded changed between these saves.
        </p>
      )}
      {diff.structure && (
        <div>
          <div className="mb-1.5 flex items-baseline justify-between gap-3">
            <span className={cn(LABEL, "text-ink-soft")}>Tracks</span>
            <span className="text-micro text-ink-soft tabular-nums">
              {trackCount(diff.structure)}
            </span>
          </div>
          <StructureOutline
            diff={diff.structure}
            collapseUnchanged={collapseUnchanged}
            colors={diff.colors}
          />
        </div>
      )}
      <SampleDelta samples={diff.samples} />
    </Root>
  );
}
