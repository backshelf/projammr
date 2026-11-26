import { isActive } from "@/components/jobs/jobs-poll";
import type { Job } from "@workspace/api/api";

/** The jobs still running or waiting in line, in the order given. */
export function inFlightJobs(jobs: Job[]): Job[] {
  return jobs.filter(isActive);
}

/** "2 running · 1 queued": a clause at zero is dropped. */
export function inFlightCount(jobs: Job[]): string {
  const running = jobs.filter((job) => job.status === "running").length;
  const queued = jobs.filter((job) => job.status === "queued").length;
  return [running > 0 && `${running} running`, queued > 0 && `${queued} queued`]
    .filter(Boolean)
    .join(" · ");
}
