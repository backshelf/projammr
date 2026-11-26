import type { DescribedJob } from "../db/schema/jobs.js";
import { errorFields, log } from "./log.js";

type Listener = (job: DescribedJob) => void;

const logger = log("job-events");

/**
 * Every change to a job row, fanned out to whoever is watching the row's
 * project. The bus lives in the process, like the queue whose work it reports,
 * so a second API instance would see only its own jobs.
 */
const listeners = new Map<number, Set<Listener>>();

export function publishJob(job: DescribedJob): void {
  if (job.projectId == null) return;
  for (const listener of listeners.get(job.projectId) ?? []) {
    try {
      listener(job);
    } catch (error) {
      logger.error("job listener failed", {
        projectId: job.projectId,
        jobId: job.id,
        ...errorFields(error),
      });
    }
  }
}

/** Calls `listener` with every job the project publishes until unsubscribed. */
export function subscribeProject(
  projectId: number,
  listener: Listener
): () => void {
  let project = listeners.get(projectId);
  if (!project) {
    project = new Set();
    listeners.set(projectId, project);
  }
  project.add(listener);

  return () => {
    project.delete(listener);
    if (project.size === 0 && listeners.get(projectId) === project) {
      listeners.delete(projectId);
    }
  };
}

/** How many listeners the project has, so a caller can see one leave. */
export function projectListenerCount(projectId: number): number {
  return listeners.get(projectId)?.size ?? 0;
}
