import type { SessionSave } from "@workspace/api/api";
import type { DiffChip } from "@workspace/session-diff";
import { DiffChipList } from "@workspace/ui/components/session-structure/diff-chip-list";
import { StatusChip } from "@workspace/ui/components/status-chip";
import type { ReactNode } from "react";

/** The sources a row marks with a chip; a scan or an app save is the unmarked default. */
const SOURCE_CHIP_LABEL: Partial<Record<SessionSave["source"], string>> = {
  backup: "Backup",
  dit: "dit",
};

/**
 * What a save row reads, wherever saves are listed: when it was saved, on what
 * machine, from what source and what it changed, as the children of the row's
 * own flex column. `stamp` is the time as the row words it, `title` names what
 * the save is of where a list mixes sessions, and `trailing` ends the first
 * line (the compare marks and the row's actions). A list whose saves all come
 * from one place leaves `source` out, and one that words
 * a save that changed nothing the diff reads in `empty`.
 */
export function SaveRowBody({
  at,
  stamp,
  title,
  machineName,
  source,
  chips,
  empty = "Saved, nothing tracked changed",
  trailing,
}: {
  /** The save's `fileUpdatedAt`. */
  at: string;
  stamp: string;
  title?: string;
  machineName: string | null;
  source?: SessionSave["source"];
  chips: DiffChip[];
  /** What a row with no chips says. */
  empty?: string;
  trailing?: ReactNode;
}) {
  const sourceLabel = source && SOURCE_CHIP_LABEL[source];
  return (
    <>
      <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <time dateTime={at} className="text-micro text-ink-soft tabular-nums">
          {stamp}
        </time>
        {title != null && <span className="text-small text-ink">{title}</span>}
        {machineName != null && (
          <span className="text-micro text-ink-soft">{machineName}</span>
        )}
        {sourceLabel != null && (
          <StatusChip flag colour="var(--ink-soft)">
            {sourceLabel}
          </StatusChip>
        )}
        {trailing}
      </span>
      {chips.length > 0 ? (
        <DiffChipList chips={chips} />
      ) : (
        <span className="text-micro text-ink-soft">{empty}</span>
      )}
    </>
  );
}
