import { zonedParts } from "@workspace/ui/lib/formatters";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The year-long window the project and profile save grids draw. */
export const YEAR_WEEKS = 53;

/** The window a heatmap covers, in the two senses of "when" it has to keep
 *  apart. */
export type HeatmapWindow = {
  /** Calendar days, for `heatmapCells`/`streaks` in
   *  `@workspace/ui/lib/heatmap`: each is the UTC midnight of a local
   *  year/month/day, read back as a plain date. `[from, to)`, `to` exclusive. */
  from: Date;
  to: Date;
  /** The last calendar day, in the same form; what `streaks` counts back from. */
  today: Date;
  /** Instants, for the server, which groups saves into local days itself: the
   *  local midnight that opens `from`'s day and the one that opens `to`'s. */
  query: { from: number; to: number; tz: string };
};

/**
 * `[from, to)` covering `weeks` trailing weeks up to and including the day
 * `asOf` falls on in `timeZone`, the zone the server groups the same saves in.
 * Every surface computing a heatmap window (the project page, the track
 * rail, the profile grid) shares this rather than re-deriving the same
 * day arithmetic three times.
 */
export function trailingWeekRange(
  weeks: number,
  asOf: Date,
  timeZone: string
): HeatmapWindow {
  const read = (instant: number) => zonedParts(instant, timeZone);

  const local = read(asOf.getTime());
  const today = Date.UTC(local.year, local.month - 1, local.day);
  const toDay = today + DAY_MS;
  const fromDay = toDay - weeks * 7 * DAY_MS;

  // The instant a zone's clock first reads `day`'s midnight. The offset is
  // read at the guess and again at the corrected instant, so a change of
  // offset between the two (daylight saving) does not skew the result.
  const offsetAt = (instant: number) => {
    const p = read(instant);
    return (
      Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) -
      Math.floor(instant / 1000) * 1000
    );
  };
  const midnight = (day: number) => day - offsetAt(day - offsetAt(day));

  return {
    from: new Date(fromDay),
    to: new Date(toDay),
    today: new Date(today),
    query: { from: midnight(fromDay), to: midnight(toDay), tz: timeZone },
  };
}

/** Whether a heatmap's days hold at least one save — a grid with none has
 *  nothing to draw and is not shown. */
export const hasSaves = (days: readonly { saves: number }[]): boolean =>
  days.some((day) => day.saves > 0);

/**
 * The query a server render uses to ask whether the year-long grid, as of
 * `asOf` (now by default), would have anything in it, cut on the days of
 * `timeZone`: the viewer's, as the request's formatter set reads it.
 */
export const yearHeatmapQuery = (timeZone: string, asOf: Date = new Date()) =>
  trailingWeekRange(YEAR_WEEKS, asOf, timeZone).query;
