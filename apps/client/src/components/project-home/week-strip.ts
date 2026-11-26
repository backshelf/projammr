import type { HeatmapDay } from "@workspace/api/api";
import { lastSaveLabel } from "@workspace/ui/lib/day-label";
import { streaks } from "@workspace/ui/lib/heatmap";

const WINDOW_DAYS = 7;

/** The line under the week strip: how many of the trailing seven days had a
 *  save, and how long ago the latest was. */
export function weekStripCaption(days: HeatmapDay[], today: Date): string {
  const active = days.filter((day) => day.saves > 0);
  if (active.length === 0) return `no saves in the last ${WINDOW_DAYS} days`;

  const { since } = streaks(active, today);
  return [
    `saved ${active.length} of the last ${WINDOW_DAYS} days`,
    since == null ? null : `last save ${lastSaveLabel(since)}`,
  ]
    .filter(Boolean)
    .join(" · ");
}
