"use client";

import { JobRow } from "@/components/jobs/JobRow";
import { useJobs, useProjectJobs } from "@/components/jobs/JobsProvider";
import { Rows } from "@workspace/ui/components/layout/rows";
import { SectionHead } from "@workspace/ui/components/layout/section-head";
import { inFlightCount, inFlightJobs } from "./in-flight";

/**
 * The project's running and queued jobs, live from the jobs stream. Folds
 * away when nothing is in flight. It takes no project: the jobs provider in
 * the layout already holds the jobs of the project in the URL.
 */
export function JobsSection() {
  const context = useJobs();
  const jobs = inFlightJobs(useProjectJobs());
  if (!context || jobs.length === 0) return null;

  return (
    <section>
      <SectionHead count={inFlightCount(jobs)}>JOBS</SectionHead>
      <Rows>
        {jobs.map((job) => (
          <JobRow
            key={job.id}
            jobId={job.id}
            canManage={context.canManage}
            onCancel={context.cancel}
            onRetry={context.retry}
          />
        ))}
      </Rows>
    </section>
  );
}
