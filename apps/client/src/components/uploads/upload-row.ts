import { describeJobRow } from "@/components/jobs/job-row";
import type { Job } from "@workspace/api/api";

/** The byte transfer's own status, before any job it hands off to. */
export type TransferStatus = "uploading" | "completed" | "error";

/**
 * The phase an upload's row is in, once the byte transfer stops being the
 * whole story: `following` while a background job it queued (analysis,
 * variants) is still on the project's job map, `done` once that job has
 * lingered out (or there was never one to follow), and `failed` for a job
 * that failed outright — which, like the tray's own failed rows, stays
 * rather than closing itself.
 */
export type UploadRowPhase = "uploading" | "following" | "done" | "failed";

/**
 * Derives the row's phase from the byte transfer's status and, once that
 * finishes, the job it handed off to. `job` reads `undefined` both before the
 * job has appeared on the map and after it has lingered out past `done`, so
 * only `hasTrackedJob` — true once this upload has seen it at least once —
 * tells those two apart.
 */
export function uploadRowPhase({
  status,
  jobId,
  job,
  hasTrackedJob,
}: {
  status: TransferStatus;
  /** The job the caller queued once the transfer completed, if any. */
  jobId: number | undefined;
  job: Job | undefined;
  hasTrackedJob: boolean;
}): UploadRowPhase {
  if (status === "uploading") return "uploading";
  if (status === "error") return "failed";
  if (jobId == null) return "done";
  if (job?.status === "failed") return "failed";
  if (job) return "following";
  return hasTrackedJob ? "done" : "following";
}

/**
 * Whether a row should remove itself now that it reads `done`: only one that
 * had a job to follow and watched it settle, since the job's own linger
 * already gave the row its few seconds of visible completion. A plain upload
 * with nothing to follow has always shown its finished row as its own silent
 * confirmation and stays until the drop zone unmounts, same as a failed row
 * that never auto-closes.
 */
export function uploadRowShouldClose({
  phase,
  jobId,
  hasTrackedJob,
}: {
  phase: UploadRowPhase;
  jobId: number | undefined;
  hasTrackedJob: boolean;
}): boolean {
  return phase === "done" && jobId != null && hasTrackedJob;
}

export type UploadRowText = {
  /** The row's caption: "UPLOADING" during the byte transfer, the job's
   *  current step label while following it, an error once it fails, and
   *  `null` once it is done — the row's usual silent confirmation. */
  caption: string | null;
  /** "Step 2 of 3" while following a multi-step job; `null` otherwise. */
  stepLine: string | null;
  /** The row's meter value, 0–100, or `null` where there is nothing to show
   *  one for. */
  percent: number | null;
};

/**
 * The row's caption, step line and meter value for its current phase, drawn
 * from the same `describeJobRow` the tray reads so the two never drift.
 */
export function uploadRowText({
  phase,
  progress,
  job,
  now,
}: {
  phase: UploadRowPhase;
  /** Byte progress, 0–1, read only during `uploading`. */
  progress: number;
  job: Job | undefined;
  now: number;
}): UploadRowText {
  switch (phase) {
    case "uploading":
      return {
        caption: "UPLOADING",
        stepLine: null,
        percent: Math.round(progress * 100),
      };
    case "following": {
      if (!job)
        return { caption: "Processing…", stepLine: null, percent: null };
      const row = describeJobRow(job, now);
      return {
        caption: row.title,
        stepLine: row.stepLine,
        percent: Math.round(job.percent),
      };
    }
    case "failed":
      return {
        caption: job ? (job.error ?? "Something went wrong.") : "Upload failed",
        stepLine: null,
        percent: null,
      };
    case "done":
      return { caption: null, stepLine: null, percent: null };
  }
}
