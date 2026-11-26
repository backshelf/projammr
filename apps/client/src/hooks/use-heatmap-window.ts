"use client";

import { trailingWeekRange, type HeatmapWindow } from "@/lib/heatmap-range";
import { useFormat } from "@workspace/ui/components/format-provider";
import type { Formatters } from "@workspace/ui/lib/formatters";
import { useMemo, useState } from "react";

/**
 * The trailing `weeks` a heatmap draws, cut on the viewer's local days, with
 * the `query` that asks the server for the same window and the day the
 * viewer's weeks start on. Fixed for the lifetime of the mount so the grid
 * and the streak count agree, even if the component stays on screen across a
 * real midnight.
 *
 * The days are cut in the zone the formatter set reads: the one the server
 * rendered in through hydration, the browser's own after it. They differ only
 * on a browser's first page, before it has written its zone cookie, when the
 * grid moves to the browser's days on the render after hydration and asks for
 * them once more.
 */
export function useHeatmapWindow(
  weeks: number
): HeatmapWindow & { weekStart: Formatters["weekStart"] } {
  const [asOf] = useState(() => new Date());
  const { timeZone, weekStart } = useFormat();

  return useMemo(
    () => ({ ...trailingWeekRange(weeks, asOf, timeZone), weekStart }),
    [weeks, asOf, timeZone, weekStart]
  );
}
