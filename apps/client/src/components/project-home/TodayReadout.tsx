"use client";

import { useProjectJobs } from "@/components/jobs/JobsProvider";
import { WeekStrip } from "@/components/project-home/WeekStrip";
import { useSetting } from "@/lib/settings/provider";
import type { ProjectToday } from "@workspace/api/api";
import {
  type ActionError,
  isActionError,
} from "@workspace/api/lib/action-result";
import { Suspense, use } from "react";
import { todaySentence } from "./today-copy";

/**
 * The project masthead's readout: the week strip, then one sentence on what
 * landed in the project's new window, what is running and what has gone quiet. The strip
 * is drawn at once and never remounts; the sentence arrives when the today
 * read settles, and its running clause follows the live jobs stream. A failed
 * read counts as zero and shows nothing of the failure.
 */
export function TodayReadout({
  projectId,
  today,
}: {
  projectId: number;
  today: Promise<ProjectToday | ActionError>;
}) {
  return (
    <div className="flex flex-col gap-3">
      <WeekStrip projectId={projectId} />
      <Suspense fallback={null}>
        <TodaySentence today={today} />
      </Suspense>
    </div>
  );
}

function TodaySentence({
  today,
}: {
  today: Promise<ProjectToday | ActionError>;
}) {
  const result = use(today);
  const newHours = useSetting("project-conventions.todayNewHours");
  const running = useProjectJobs().filter(
    (job) => job.status === "running"
  ).length;

  return (
    <p className="text-body text-ink">
      {todaySentence({
        renders: isActionError(result) ? 0 : result.counts.renders,
        saves: isActionError(result) ? 0 : result.counts.saves,
        running,
        quiet: isActionError(result) ? 0 : result.quiet.total,
        newHours,
      })}
    </p>
  );
}
