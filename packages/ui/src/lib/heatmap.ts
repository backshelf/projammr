import type { HeatmapDay } from "@workspace/api/api";

/** The intensity bucket a heatmap cell renders at. Fixed thresholds so two
 *  projects (or a project and a track) read against the same scale rather
 *  than each stretching its own range across four levels. */
export function levelFor(saves: number): 0 | 1 | 2 | 3 | 4 {
  if (saves <= 0) return 0;
  if (saves === 1) return 1;
  if (saves <= 3) return 2;
  if (saves <= 6) return 3;
  return 4;
}

/** One cell of the 7-row grid. A padding cell fills the space before `from`
 *  in its week and is not a day that could have had saves — the grid
 *  must render it as an empty slot, not a level-0 day, so `day` distinguishes
 *  the two rather than a sentinel level or count would. */
export type HeatmapDayCell = {
  day: string;
  level: 0 | 1 | 2 | 3 | 4;
  saves: number;
};

export type HeatmapCell = { day: null } | HeatmapDayCell;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Midnight UTC of the given `Date`, read as a calendar day. Every date this
 *  module handles is treated as a UTC day rather than a local instant — the
 *  `day` strings that come from the server are already bucketed into the
 *  viewer's local calendar day, so from here on they are just calendar dates
 *  with no timezone left to reason about. */
function utcDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function parseDay(day: string): number {
  const parts = day.split("-").map(Number);
  const year = parts[0] ?? 0;
  const month = parts[1] ?? 1;
  const date = parts[2] ?? 1;
  return Date.UTC(year, month - 1, date);
}

/** Every local day in `[from, to)`, in order, with no padding: a single row
 *  reads the days as they fall. */
export function heatmapDays(
  days: HeatmapDay[],
  from: Date,
  to: Date
): HeatmapDayCell[] {
  const byDay = new Map(days.map((d) => [d.day, d.saves]));

  const cells: HeatmapDayCell[] = [];
  for (let t = utcDay(from); t < utcDay(to); t += DAY_MS) {
    const day = new Date(t).toISOString().slice(0, 10);
    const saves = byDay.get(day) ?? 0;
    cells.push({ day, level: levelFor(saves), saves });
  }
  return cells;
}

/** Every local day in `[from, to)`, left-padded to the first day of
 *  `from`'s week so the 7-row grid lines up: `weekStart` is that day, 0 for
 *  Sunday, 1 for Monday, 6 for Saturday. The window itself is unchanged; only
 *  where its first column starts moves. */
export function heatmapCells(
  days: HeatmapDay[],
  from: Date,
  to: Date,
  weekStart = 0
): HeatmapCell[] {
  const fromWeekday = new Date(utcDay(from)).getUTCDay(); // 0 = Sunday
  const lead = (fromWeekday - weekStart + 7) % 7;
  const padding: HeatmapCell[] = Array.from({ length: lead }, () => ({
    day: null,
  }));
  return [...padding, ...heatmapDays(days, from, to)];
}

/** The longest run of consecutive active days, and how many days have passed
 *  since the most recent one. `days` only lists days that had activity, so a
 *  missing date is a gap in the streak even though it's not present in the
 *  array — consecutiveness is judged on the parsed dates, not on adjacency
 *  in the list. `since` is `null` when there is no activity at all, since
 *  there's no "last save" for a sentinel count to describe.
 *
 *  `asOf` is the day `since` counts back from. It is a parameter rather than
 *  a read of the clock so that a server render and the hydration that follows
 *  it agree on the number even across midnight.
 *
 *  `current` is the run of consecutive active days still counted as ongoing:
 *  it ends on `asOf`'s day or the day before, since a producer who saved
 *  yesterday is still "on" their streak today. It is `0` once the most
 *  recent active day is older than that. */
export function streaks(
  days: HeatmapDay[],
  asOf: Date
): {
  longest: number;
  since: number | null;
  current: number;
} {
  if (days.length === 0) return { longest: 0, since: null, current: 0 };

  const dates = [...new Set(days.map((d) => parseDay(d.day)))].sort(
    (a, b) => a - b
  );

  let longest = 1;
  let run = 1;
  for (let i = 1; i < dates.length; i++) {
    const previous = dates[i - 1];
    const date = dates[i];
    if (date !== undefined && previous !== undefined) {
      run = date - previous === DAY_MS ? run + 1 : 1;
      longest = Math.max(longest, run);
    }
  }

  const last = dates[dates.length - 1] ?? 0;
  const since = Math.round((utcDay(asOf) - last) / DAY_MS);

  let current = 0;
  if (since <= 1) {
    current = 1;
    for (let i = dates.length - 1; i > 0; i--) {
      const previous = dates[i - 1];
      const date = dates[i];
      if (
        previous === undefined ||
        date === undefined ||
        date - previous !== DAY_MS
      ) {
        break;
      }
      current++;
    }
  }

  return { longest, since, current };
}
