import { pluralizeCount } from "@workspace/session-diff/format";
import type { StructureDiff } from "@workspace/session-diff";
import {
  SPAN_LEVELS,
  type SkylineBar,
  type SkylineMark,
  type SkylineSpan,
  skylineOf,
} from "@workspace/session-diff/skyline";
import { LABEL } from "@workspace/ui/lib/shell";
import { cn } from "@workspace/ui/lib/utils";
import type { CSSProperties } from "react";

/** A bar's height: a floor so an empty track still stands, up to the full drawing. */
const BAR_FLOOR_PX = 4;
const BAR_RISE_PX = 36;

/** How far apart the group spans under the bars sit, one level to the next. */
const SPAN_STEP_PX = 5;

/** The share of the skyline a top-level group has to span before its name
 *  fits under it; a narrower group is named by its bars' hover titles alone.
 *  A group short of `ROOMY_SPAN_SHARE` is named only on a skyline wide enough
 *  to fit a name in that little of it. */
const NAMED_SPAN_SHARE = 0.08;
const ROOMY_SPAN_SHARE = 0.15;

const MARK_WORD: Record<SkylineMark, string> = {
  added: "added",
  removed: "removed",
  changed: "changed",
};

/** Each mark as the drawing's own geometry: a caret, a stroke, a dot. */
const MARK_SHAPE: Record<SkylineMark, string> = {
  added: "h-[5px] w-[7px] bg-art [clip-path:polygon(50%_0,100%_100%,0_100%)]",
  removed: "h-px w-[5px] bg-ink-faint",
  changed: "size-1 rounded-full bg-art",
};

/** The columns the bars sit in: one per track, plus one of air before the returns. */
function columnsOf(bars: SkylineBar[]) {
  const busAt = bars.findIndex((bar) => bar.busStart);
  const column = (index: number) =>
    index + (busAt >= 0 && index >= busAt ? 1 : 0);
  return { count: bars.length + (busAt >= 0 ? 1 : 0), column };
}

/** What a screen reader hears in place of the drawing. */
function summaryOf(bars: SkylineBar[]): string {
  const counts = (["added", "removed", "changed"] as const)
    .map(
      (mark) => [mark, bars.filter((bar) => bar.mark === mark).length] as const
    )
    .filter(([, count]) => count > 0)
    .map(([mark, count]) => `${count} ${MARK_WORD[mark]}`);
  const set = `The set's ${pluralizeCount(bars.length, "track")}`;
  return counts.length > 0 ? `${set}: ${counts.join(", ")}.` : `${set}.`;
}

/** How much of the skyline a span covers, from 0 to 1. */
function spanShare(
  span: SkylineSpan,
  columns: ReturnType<typeof columnsOf>
): number {
  return (
    (columns.column(span.to) - columns.column(span.from) + 1) / columns.count
  );
}

/** A span's horizontal extent, inset from its outer bars so neighbours never touch. */
function spanBox(
  span: SkylineSpan,
  columns: ReturnType<typeof columnsOf>
): CSSProperties {
  const from = columns.column(span.from);
  const to = columns.column(span.to);
  return {
    left: `${((from + 0.15) / columns.count) * 100}%`,
    width: `${((to - from + 0.7) / columns.count) * 100}%`,
  };
}

/**
 * The set drawn as a skyline: a bar per track in the order the set reads, in
 * the colour the DAW shows it in and as tall as its device chain is long,
 * with each group a span under the bars it holds (named at the top level) and
 * the returns set apart after a gap, the way a mixer lays them out. Under the
 * baseline, a mark says what the save did to a track: a caret where one was
 * added, a stroke where one was removed (its bar a ghost), a dot where one
 * changed. Pure markup that renders on the server; every bar and its outline
 * row carry the same index, which is all a client needs to link the two.
 */
export function SetSkyline({
  structure,
  className,
}: {
  structure: StructureDiff;
  className?: string;
}) {
  const { bars, spans } = skylineOf(structure);
  if (bars.length === 0) return null;

  const columns = columnsOf(bars);
  const grid: CSSProperties = {
    gridTemplateColumns: `repeat(${columns.count}, minmax(0, 1fr))`,
  };
  const levels = Math.min(
    SPAN_LEVELS,
    spans.reduce((deepest, span) => Math.max(deepest, span.depth + 1), 0)
  );
  const named = spans.filter(
    (span) => span.depth === 0 && spanShare(span, columns) >= NAMED_SPAN_SHARE
  );

  return (
    <div
      role="img"
      aria-label={summaryOf(bars)}
      className={cn("skyline @container/skyline select-none", className)}
      style={{ "--n": bars.length } as CSSProperties}
    >
      <div className="grid h-10 items-end" style={grid}>
        {bars.map((bar) => (
          <i
            key={bar.index}
            data-diff-bar={bar.index}
            data-mark={bar.mark ?? undefined}
            title={bar.mark ? `${bar.name} · ${MARK_WORD[bar.mark]}` : bar.name}
            className={cn(
              "skyline__bar block w-[clamp(1px,calc(100%-2px),8px)] justify-self-center motion-reveal",
              bar.mark === "removed"
                ? "border border-dashed border-ink-faint"
                : "bg-[var(--track,var(--ink-faint))] shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--ink)_10%,transparent)]",
              "group-data-hot/save-diff:opacity-35 data-hot:opacity-100!",
              !bar.mark && "group-data-[mode=changes]/save-diff:opacity-25",
              "group-data-[linked]/save-diff:cursor-pointer"
            )}
            style={
              {
                "--i": bar.index,
                "--track": bar.color,
                gridColumn: columns.column(bar.index) + 1,
                height: `${BAR_FLOOR_PX + bar.level * BAR_RISE_PX}px`,
              } as CSSProperties
            }
          />
        ))}
      </div>
      <i aria-hidden className="block border-t border-rule-strong" />
      <div className="mt-1 grid h-[5px] items-start" style={grid}>
        {bars.map((bar) =>
          bar.mark ? (
            <i
              key={bar.index}
              className={cn("block justify-self-center", MARK_SHAPE[bar.mark])}
              style={{ gridColumn: columns.column(bar.index) + 1 }}
            />
          ) : null
        )}
      </div>
      {levels > 0 && (
        <div
          className="relative mt-1.5"
          style={{ height: `${levels * SPAN_STEP_PX}px` }}
        >
          {spans.map((span) => (
            <i
              key={`${span.depth}:${span.from}`}
              title={span.name}
              className={cn(
                "absolute block rounded-full bg-[var(--track,var(--rule-strong))]",
                span.depth === 0 ? "h-0.5" : "h-px"
              )}
              style={
                {
                  ...spanBox(span, columns),
                  top: `${span.depth * SPAN_STEP_PX}px`,
                  "--track": span.color,
                } as CSSProperties
              }
            />
          ))}
        </div>
      )}
      {named.length > 0 && (
        <div className="relative mt-1 h-3.5">
          {named.map((span) => (
            <span
              key={span.from}
              className={cn(
                LABEL,
                "absolute top-0 block truncate pr-2 text-ink-soft",
                spanShare(span, columns) < ROOMY_SPAN_SHARE &&
                  "@max-xl/skyline:hidden"
              )}
              style={spanBox(span, columns)}
            >
              {span.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
