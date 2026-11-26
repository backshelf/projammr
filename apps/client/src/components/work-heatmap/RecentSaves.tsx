"use client";

import { clientGetProjectSaves, type HeatmapFilters } from "@/lib/client-api";
import { AppLink } from "@/components/navigation/AppLink";
import { SaveTimeline } from "@workspace/ui/components/session-structure/save-timeline";
import type { ProjectSave } from "@workspace/api/api";
import { isActionError } from "@workspace/api/lib/action-result";
import { Button } from "@workspace/ui/components/button";
import { useFormat } from "@workspace/ui/components/format-provider";
import { SectionHead } from "@workspace/ui/components/layout/section-head";
import { useEffect, useMemo, useState } from "react";
import { saveEntries } from "./save-entries";

/** Enough saves to read the shape of a day's work without becoming a page. */
const LIMIT = 10;

/**
 * The saves behind the heatmap above it: the project's most recent, or the
 * ones from the day picked on the grid. It answers what the grid can only
 * gesture at — a lit square says "you worked", this says on what and what
 * changed. The filters are the heatmap's own, so the two always describe the
 * same set of saves.
 */
export function RecentSaves({
  projectId,
  day,
  collectionId,
  labelId,
  daw,
  onClearDay,
}: {
  projectId: number;
  day?: string;
  collectionId?: number;
  labelId?: number;
  daw?: string;
  onClearDay: () => void;
}) {
  // Fixed for the lifetime of the mount so the day labels agree between
  // hydration and any later render, even across a real midnight.
  const [asOf] = useState(() => new Date());
  const [saves, setSaves] = useState<ProjectSave[]>([]);
  const format = useFormat();
  const tz = format.timeZone;

  // The previous list stays on screen while the next one loads, the same way
  // the grid holds its shape rather than flashing a spinner between filters.
  useEffect(() => {
    let cancelled = false;
    const filters: HeatmapFilters = { collectionId, labelId, daw };

    void clientGetProjectSaves(
      projectId,
      { limit: LIMIT, tz, day },
      filters
    ).then((result) => {
      if (cancelled) return;
      setSaves(isActionError(result) ? [] : result);
    });

    return () => {
      cancelled = true;
    };
  }, [projectId, collectionId, labelId, daw, day, tz]);

  const entries = useMemo(
    () => saveEntries(saves, projectId, format),
    [saves, projectId, format]
  );

  return (
    <>
      <SectionHead
        action={
          day != null && (
            <Button variant="ghost" size="sm" onClick={onClearDay}>
              Show recent
            </Button>
          )
        }
      >
        {day == null ? "RECENT SAVES" : `Saves on ${format.calendarDate(day)}`}
      </SectionHead>
      {entries.length > 0 ? (
        <SaveTimeline
          entries={entries}
          hrefFor={(entry) => entry.href}
          link={AppLink}
          asOf={asOf}
          format={format}
        />
      ) : (
        <p className="text-small text-ink-soft">
          {day == null
            ? "No saves recorded yet."
            : "Nothing saved on this day."}
        </p>
      )}
    </>
  );
}
