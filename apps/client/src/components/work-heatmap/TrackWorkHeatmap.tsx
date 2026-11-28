"use client";

import { clientGetProjectHeatmap } from "@/lib/client-api";
import { lastSaveLabel } from "@workspace/ui/lib/day-label";
import { useHeatmapWindow } from "@/hooks/use-heatmap-window";
import { pluralizeCount } from "@workspace/session-diff/format";
import type { HeatmapDay } from "@workspace/api/api";
import { isActionError } from "@workspace/api/lib/action-result";
import { Heatmap } from "@workspace/ui/components/heatmap";
import { RailBlock, RailLabel } from "@workspace/ui/components/layout/rail";
import { streaks } from "@workspace/ui/lib/heatmap";
import { useEffect, useState } from "react";

const WEEKS = 12;

/**
 * A compact 12-week save-activity grid for one track, shown in the rail.
 * Unfiltered (`trackId` pins the request), so — unlike `WorkHeatmap` on the
 * project page — there is no URL filter state to own. Owns its own
 * `RailBlock` so tracks with no saves render nothing without flashing an
 * empty heading.
 */
export function TrackWorkHeatmap({
  projectId,
  trackId,
}: {
  projectId: number;
  trackId: number;
}) {
  const { from, to, today, query, weekStart } = useHeatmapWindow(WEEKS);

  const [days, setDays] = useState<HeatmapDay[]>([]);

  useEffect(() => {
    let cancelled = false;

    void clientGetProjectHeatmap(projectId, query, { trackId }).then(
      (result) => {
        if (cancelled) return;
        setDays(isActionError(result) ? [] : result);
      }
    );

    return () => {
      cancelled = true;
    };
  }, [projectId, trackId, query]);

  if (days.length === 0) return null;

  const activeDays = days.length;
  const { since } = streaks(days, today);

  const caption = [
    `${pluralizeCount(activeDays, "day")} in the last 3 months`,
    since == null ? null : `last save ${lastSaveLabel(since)}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <RailBlock>
      <RailLabel>WORKED ON</RailLabel>
      <div className="flex flex-col gap-2">
        <Heatmap
          days={days}
          from={from}
          to={to}
          weekStart={weekStart}
          compact
        />
        <p className="text-micro text-ink-soft">{caption}</p>
      </div>
    </RailBlock>
  );
}
