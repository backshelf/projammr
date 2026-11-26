import { keyedByContent } from "@workspace/ui/lib/keyed";
import type { HeatmapDay } from "@workspace/api/api";
import { LABEL } from "@workspace/ui/lib/shell";
import {
  heatmapCells,
  heatmapDays,
  type HeatmapCell,
} from "@workspace/ui/lib/heatmap";
import { cn } from "@workspace/ui/lib/utils";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export type HeatmapProps = {
  days: HeatmapDay[];
  from: Date;
  to: Date;
  /** Drops the month-label row and the weekday-initials column, leaving the
   *  bare grid — for a small inline placement (the track rail) where those
   *  labels would cost more width than they earn. */
  compact?: boolean;
  /** The `YYYY-MM-DD` day drawn as picked. */
  selectedDay?: string;
  /** Makes the grid interactive. Fires with the clicked day, including the
   *  one already selected — clearing a selection is the caller's decision,
   *  since only it knows where that state lives. */
  onSelectDay?: (day: string) => void;
  /** `"strip"` draws the days from `from` to `to` in one row, with no
   *  padding back to Sunday, no month row and no weekday column (`compact` is
   *  implied) — for a short window such as a week, where the grid would be a
   *  single column. Default `"grid"`. */
  layout?: "grid" | "strip";
  /** Rises the dated cells left to right on mount, each growing from the
   *  baseline as a waveform's bars do; motion-free under reduced motion. */
  sweep?: boolean;
  /** The day each week column starts on, the viewer's `format.weekStart`:
   *  0 Sunday (the default), 1 Monday, 6 Saturday. */
  weekStart?: 0 | 1 | 6;
};

/** A year-scale activity grid: 7 rows (weekdays) by N week columns, coloured
 *  by the artwork channel so it inherits a project's accent (or reads as
 *  plain grey on a page with no artwork) with no palette hue of its own. A
 *  native `title` stands in for a per-cell tooltip — 365 grid cells is too
 *  many portals for one chart. A day with no saves still shows its cell:
 *  the artwork mix grounds on `--paper-sunk` rather than transparency, so the
 *  grid keeps its shape through a quiet month. Pure markup over pre-computed
 *  cells and no state of its own, so without `onSelectDay` it renders on the
 *  server; with one, each day becomes a keyboard-reachable button. */
export function Heatmap({
  days,
  from,
  to,
  compact = false,
  selectedDay,
  onSelectDay,
  layout = "grid",
  sweep = false,
  weekStart = 0,
}: HeatmapProps) {
  const strip = layout === "strip";
  const bare = compact || strip;
  const cells: HeatmapCell[] = strip
    ? heatmapDays(days, from, to)
    : heatmapCells(days, from, to, weekStart);
  const weeks = Math.ceil(cells.length / 7);
  // Padding cells only lead, so a dated cell's place in the sweep is its
  // position past them.
  const datedCount = cells.filter((cell) => cell.day != null).length;
  const padding = cells.length - datedCount;
  const weekdays = WEEKDAYS.map((_, row) => WEEKDAYS[(row + weekStart) % 7]!);

  // A month label goes above the first week column whose first day falls in
  // that month, so each label marks where the month actually starts on the
  // grid rather than a fixed interval.
  const monthLabels = new Map<number, string>();
  let lastMonth = -1;
  for (let week = 0; week < weeks; week++) {
    const cell = cells[week * 7];
    if (cell?.day == null) continue;
    const month = new Date(cell.day).getUTCMonth();
    const label = MONTHS[month];
    if (month !== lastMonth && label !== undefined) {
      monthLabels.set(week, label);
      lastMonth = month;
    }
  }

  // A year of 11px columns is wider than most columns it sits in, and the
  // grid is fixed-width by nature — there is nothing to reflow. The outer box
  // takes the column's width and scrolls the grid inside it, so the last
  // weeks stay reachable instead of painting outside the content edge.
  return (
    <div className="max-w-full overflow-x-auto">
      <div className="inline-flex flex-col gap-1">
        {!bare && (
          <div
            className={`grid gap-[3px] pl-5 ${LABEL} text-ink-soft`}
            style={{ gridTemplateColumns: `repeat(${weeks}, 11px)` }}
          >
            {Array.from({ length: weeks }, (_, week) => (
              <span key={week} className="leading-none">
                {monthLabels.get(week) ?? ""}
              </span>
            ))}
          </div>
        )}
        <div className="flex gap-1">
          {/* Fixed at w-4 so the month row above clears it with pl-5: the
            initials plus the gap-1 beside them. */}
          {!bare && (
            <div
              className={`grid w-4 grid-rows-7 gap-[3px] ${LABEL} text-ink-soft`}
            >
              {weekdays.map((weekday, row) => (
                <span
                  key={weekday}
                  className="flex h-[11px] items-center leading-none"
                >
                  {row % 2 === 1 ? weekday[0] : ""}
                </span>
              ))}
            </div>
          )}
          <div
            className={
              strip
                ? "grid grid-flow-col grid-rows-1 gap-[3px]"
                : "grid grid-flow-col grid-rows-7 gap-[3px]"
            }
            style={
              sweep
                ? ({
                    gridAutoColumns: "11px",
                    "--n": datedCount,
                  } as React.CSSProperties)
                : { gridAutoColumns: "11px" }
            }
          >
            {keyedByContent(cells, (cell) => cell.day ?? "pad").map(
              ({ key, item: cell }, index) => {
                if (cell.day == null) {
                  return <i key={key} className="size-[11px]" />;
                }

                const day = cell.day;
                const label = `${day}: ${cell.saves} save${cell.saves === 1 ? "" : "s"}`;
                const style = {
                  "--level": cell.level,
                  ...(sweep && { "--i": index - padding }),
                } as React.CSSProperties;
                const className = cn(
                  "size-[11px] rounded-[2px] bg-[color-mix(in_oklab,var(--art)_calc(var(--level)*22%),var(--paper-sunk))]",
                  sweep && "heatmap__cell--sweep",
                  day === selectedDay &&
                    "outline outline-1 outline-offset-1 outline-art"
                );

                // A quiet day is worth picking too — "nothing saved then" is an
                // answer — so every dated cell is a target, not just the lit ones.
                return onSelectDay ? (
                  <button
                    key={day}
                    type="button"
                    title={label}
                    aria-label={label}
                    aria-pressed={day === selectedDay}
                    onClick={() => onSelectDay(day)}
                    style={style}
                    className={className}
                  />
                ) : (
                  <i
                    key={day}
                    title={label}
                    style={style}
                    className={className}
                  />
                );
              }
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
