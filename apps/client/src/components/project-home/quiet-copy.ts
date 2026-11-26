import { pluralizeCount } from "@workspace/session-diff/format";

const DAY_MS = 24 * 60 * 60 * 1000;

/** "30 days", or "1 day": a count of days as the quiet block reads it. */
export const quietDaysLabel = (days: number): string =>
  pluralizeCount(days, "day");

/** How long a track has been quiet, in whole days and never below the project's quiet threshold. */
export function quietSinceLabel(
  lastTouchedAt: Date | string,
  now: Date,
  quietAfterDays: number
): string {
  const elapsed = now.getTime() - new Date(lastTouchedAt).getTime();
  return quietDaysLabel(Math.max(quietAfterDays, Math.floor(elapsed / DAY_MS)));
}

/** "and 3 more" for the quiet tracks the block does not list; null when it lists them all. */
export function quietMoreLabel(shown: number, total: number): string | null {
  const hidden = total - shown;
  return hidden > 0 ? `and ${hidden} more` : null;
}
