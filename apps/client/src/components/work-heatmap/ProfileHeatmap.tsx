"use client";

import { clientGetMyHeatmap } from "@/lib/client-api";
import { useHeatmapWindow } from "@/hooks/use-heatmap-window";
import { YEAR_WEEKS } from "@/lib/heatmap-range";
import { pluralizeCount } from "@workspace/session-diff/format";
import type { UserHeatmapDay } from "@workspace/api/api";
import { isActionError } from "@workspace/api/lib/action-result";
import { Heatmap } from "@workspace/ui/components/heatmap";
import { streaks } from "@workspace/ui/lib/heatmap";
import { useEffect, useState } from "react";

/**
 * The cross-project save-activity grid on the profile page. Unfiltered — the
 * `/me/heatmap` route takes no filters — and the project count comes from
 * the rows themselves: `projects` is carried per day, so the count worked
 * across the whole window is the max over the days, not a sum.
 */
export function ProfileHeatmap() {
  const { from, to, today, query, weekStart } = useHeatmapWindow(YEAR_WEEKS);

  const [days, setDays] = useState<UserHeatmapDay[]>([]);

  useEffect(() => {
    let cancelled = false;

    void clientGetMyHeatmap(query).then((result) => {
      if (cancelled) return;
      setDays(isActionError(result) ? [] : result);
    });

    return () => {
      cancelled = true;
    };
  }, [query]);

  const totalSaves = days.reduce((sum, d) => sum + d.saves, 0);
  const projectCount = days.reduce((max, d) => Math.max(max, d.projects), 0);
  const { longest, since } = streaks(days, today);

  const lede = [
    `${pluralizeCount(totalSaves, "save")} on ${pluralizeCount(days.length, "day")}`,
    `across ${pluralizeCount(projectCount, "project")}`,
    `longest streak ${pluralizeCount(longest, "day")}`,
    since == null
      ? null
      : since === 0
        ? "last save today"
        : `last save ${pluralizeCount(since, "day")} ago`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex flex-col gap-3">
      <Heatmap days={days} from={from} to={to} weekStart={weekStart} />
      <p className="text-micro text-ink-soft">{lede}</p>
    </div>
  );
}
