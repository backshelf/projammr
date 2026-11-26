"use client";

import { weekStripCaption } from "@/components/project-home/week-strip";
import { useHeatmapWindow } from "@/hooks/use-heatmap-window";
import { clientGetProjectHeatmap } from "@/lib/client-api";
import type { HeatmapDay } from "@workspace/api/api";
import { isActionError } from "@workspace/api/lib/action-result";
import { Heatmap } from "@workspace/ui/components/heatmap";
import { useArrivalKind } from "@workspace/ui/components/motion/arrival";
import { useEffect, useState } from "react";

/**
 * The trailing seven days of saves as one row of cells, with a caption, for
 * the project masthead. Always drawn: before the fetch settles, or if it
 * fails, every cell sits at level 0 so the masthead never reflows or errors.
 */
export function WeekStrip({ projectId }: { projectId: number }) {
  const { from, to, today, query } = useHeatmapWindow(1);
  const sweep = useArrivalKind() === "load";

  const [days, setDays] = useState<HeatmapDay[]>([]);

  useEffect(() => {
    let cancelled = false;

    void clientGetProjectHeatmap(projectId, query).then((result) => {
      if (cancelled) return;
      setDays(isActionError(result) ? [] : result);
    });

    return () => {
      cancelled = true;
    };
  }, [projectId, query]);

  return (
    <div className="flex flex-col gap-2">
      <Heatmap days={days} from={from} to={to} layout="strip" sweep={sweep} />
      <p className="text-micro text-ink-soft">
        {weekStripCaption(days, today)}
      </p>
    </div>
  );
}
