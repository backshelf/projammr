"use client";

import { useProjectJobs } from "@/components/jobs/JobsProvider";
import { WeekStrip } from "@/components/project-home/WeekStrip";
import { useSetting } from "@/lib/settings/provider";
import { pluralizeCount } from "@workspace/session-diff/format";
import type { ProjectToday } from "@workspace/api/api";
import {
  type ActionError,
  isActionError,
} from "@workspace/api/lib/action-result";
import { Suspense, use } from "react";
import { todaySentence } from "./today-copy";

/**
 * The project masthead's readout: the week strip, then one sentence on what
 * landed in the project's new window, what is running and what has gone quiet.
 * Viewers see only the rendered music clauses; editors also see a jump link
 * when unassigned DAW sets are waiting in the inbox.
 */
export function TodayReadout({
  projectId,
  today,
  canEdit = true,
}: {
  projectId: number;
  today: Promise<ProjectToday | ActionError>;
  canEdit?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <WeekStrip projectId={projectId} />
      <Suspense fallback={null}>
        <TodaySentence today={today} canEdit={canEdit} />
      </Suspense>
    </div>
  );
}

function TodaySentence({
  today,
  canEdit,
}: {
  today: Promise<ProjectToday | ActionError>;
  canEdit: boolean;
}) {
  const result = use(today);
  const newHours = useSetting("project-conventions.todayNewHours");
  const running = useProjectJobs().filter(
    (job) => job.status === "running"
  ).length;
  const unassignedTotal =
    canEdit && !isActionError(result) ? result.unassignedSets.total : 0;

  return (
    <p className="text-body text-ink">
      {todaySentence({
        renders: isActionError(result) ? 0 : result.counts.renders,
        saves: canEdit && !isActionError(result) ? result.counts.saves : 0,
        running,
        quiet: isActionError(result) ? 0 : result.quiet.total,
        newHours,
      })}
      {unassignedTotal > 0 && (
        <>
          {" · "}
          <a
            href="#unassigned-sets"
            className="text-ink-soft underline-offset-4 motion-ink hover:text-ink hover:underline"
          >
            {pluralizeCount(unassignedTotal, "unassigned DAW set")}
          </a>
        </>
      )}
    </p>
  );
}
