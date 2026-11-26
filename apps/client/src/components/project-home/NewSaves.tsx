"use client";

import { AppLink } from "@/components/navigation/AppLink";
import type { SaveEntry } from "@/components/work-heatmap/save-entries";
import { useFormat } from "@workspace/ui/components/format-provider";
import { SaveTimeline } from "@workspace/ui/components/session-structure/save-timeline";

/**
 * The NEW block's saves, grouped into days and timed in the viewer's zone as
 * the formatter set reads it: the zone the server rendered in through
 * hydration, the browser's own after it. `asOf` is the server render's own
 * clock, so "Today" and "Yesterday" come out the same in the server's HTML
 * and in hydration, and hold across a real midnight after it.
 */
export function NewSaves({
  entries,
  asOf,
}: {
  entries: SaveEntry[];
  asOf: Date;
}) {
  const format = useFormat();

  return (
    <SaveTimeline
      entries={entries}
      hrefFor={(entry) => entry.href}
      link={AppLink}
      asOf={asOf}
      format={format}
    />
  );
}
