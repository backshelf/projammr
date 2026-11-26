import { useId, type CSSProperties, type JSX } from "react";
import { useFormat } from "@workspace/ui/components/format-provider";
import { Row, Rows } from "@workspace/ui/components/layout/rows";
import { sectionTitle } from "@workspace/ui/components/layout/section-head";
import { SaveRowBody } from "@workspace/ui/components/session-structure/save-row-body";
import { STATUS_PIE } from "@workspace/ui/components/status-chip";
import { cn } from "@workspace/ui/lib/utils";

import type { HeadCommit, PushDot, SaveRow, SetMeta } from "../ipc";
import { chipsOf } from "./save-chips";

const PUSH_WORDS: Record<PushDot, string> = {
  pending: "Waiting to push",
  pushing: "Pushing",
  pushed: "Pushed",
};

/** How far round each state's pie is filled: ink and whole when pushed, the accent half way while going up. */
const PUSH_LOOK: Record<PushDot, { fill: number; tone: string }> = {
  pending: { fill: 0, tone: "text-ink-soft" },
  pushing: { fill: 50, tone: "text-art" },
  pushed: { fill: 100, tone: "text-ink" },
};

/** The dot in front of a save or a commit: the status pie, hollow while pending, the accent while pushing, ink once pushed. */
export function PushDotMark({ push }: { push: PushDot }): JSX.Element {
  const { fill, tone } = PUSH_LOOK[push];
  return (
    <span
      role="img"
      aria-label={PUSH_WORDS[push]}
      title={PUSH_WORDS[push]}
      style={{ "--pct": fill } as CSSProperties}
      className={cn(STATUS_PIE, "mt-1 flex before:size-2.5", tone)}
    />
  );
}

/** The heading over the list: "3 saves since 'added strings'", or just the count when nothing was committed. */
function headingOf(count: number, commit: HeadCommit | null): string {
  const saves = `${count} ${count === 1 ? "save" : "saves"}`;
  return commit === null
    ? saves
    : `${saves} since \u2018${commit.message}\u2019`;
}

/** The empty line of a save whose chips are none: it was read and the facets name nothing, or it could not be read. */
function emptyOf(save: SaveRow): string {
  return save.unreadable
    ? "Couldn\u2019t read this save"
    : "Saved, no track or setting changed";
}

/**
 * The saves since the last commit, each with its time, what it changed and a dot for whether the hub has it. A save
 * made on the day of the newest reads as a time of day; an older one, as a date and time.
 */
export function SavesList({
  saves,
  headMeta,
  lastCommit,
}: {
  saves: readonly SaveRow[];
  headMeta: SetMeta | null;
  lastCommit: HeadCommit | null;
}): JSX.Element {
  const headingId = useId();
  const format = useFormat();
  const chips = chipsOf(saves, headMeta);
  const newestDay = saves[0] ? format.calendarDay(saves[0].at) : null;

  return (
    <section aria-labelledby={headingId} className="flex flex-col">
      <h2
        id={headingId}
        className={cn(sectionTitle(), "mb-2 truncate normal-case")}
      >
        {headingOf(saves.length, lastCommit)}
      </h2>
      <Rows as="ul">
        {saves.map((save, index) => (
          <Row
            as="li"
            key={save.id}
            className="items-start gap-2.5 px-0 [contain-intrinsic-size:auto_3rem] [content-visibility:auto]"
          >
            <PushDotMark push={save.push} />
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <SaveRowBody
                at={new Date(save.at).toISOString()}
                stamp={
                  format.calendarDay(save.at) === newestDay
                    ? format.time(save.at)
                    : format.dateTime(save.at)
                }
                machineName={null}
                chips={chips[index] ?? []}
                empty={emptyOf(save)}
                trailing={
                  save.push === "pushed" ? null : (
                    <span className="ml-auto text-micro text-ink-soft">
                      {save.push === "pushing" ? "pushing" : "pending"}
                    </span>
                  )
                }
              />
            </span>
          </Row>
        ))}
      </Rows>
    </section>
  );
}
