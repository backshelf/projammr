import type { Job } from "@workspace/api/api";

type ConversionOutput = { name?: string; url?: string };

/**
 * What a queued conversion's job row says right now: still on its way to the
 * map, running at some percent, finished with an output to fetch, or failed
 * — a cancelled job reads the same as a failed one, since either way there is
 * nothing left to download.
 */
export type ConvertOutcome =
  | { kind: "pending" }
  | { kind: "running"; percent: number }
  | { kind: "done"; output: ConversionOutput }
  | { kind: "failed"; message: string };

/**
 * Reads a conversion's outcome straight off its live job row — the same row
 * the jobs tray reads — rather than a client-side poll of its own.
 */
export function convertOutcome(job: Job | undefined): ConvertOutcome {
  if (!job) return { kind: "pending" };
  switch (job.status) {
    case "done":
      return { kind: "done", output: (job.result as ConversionOutput) ?? {} };
    case "failed":
      return { kind: "failed", message: job.error ?? "Conversion failed." };
    case "cancelled":
      return { kind: "failed", message: "The conversion was cancelled." };
    case "queued":
    case "running":
      return { kind: "running", percent: Math.round(job.percent) };
  }
}

/** One conversion request: the job it queued and a number unique to this
 *  attempt, so a second request that reuses the same job id — the server
 *  hands back a conversion already done rather than re-encoding — still
 *  reads as a fresh request rather than a no-op repeat of the last one. */
export type ConvertRequest = { jobId: number; requestId: number };

/** Whether the dialog should show its own busy state for `outcome`: running,
 *  or not yet seen at all on a job this dialog has never tracked before. A
 *  `pending` outcome for a job it has already tracked once is not busy — that
 *  reads as a job the live map has since lingered out, whose real outcome
 *  `useTrackedJob`'s own fallback read is still resolving. */
export function isConvertRequestRunning(
  outcome: ConvertOutcome | null,
  hasTrackedJob: boolean
): boolean {
  return (
    outcome?.kind === "running" ||
    (outcome?.kind === "pending" && !hasTrackedJob)
  );
}

/**
 * Whether a settled `outcome` for `request` should still fire its side
 * effect (the download, or the failure toast): once per request, tracked by
 * `handledRequestId`. Guards two ways a settled outcome can otherwise repeat
 * itself: an unrelated jobs-map update handing back a new `Job` object for a
 * request already handled, and a later request that reuses the very same job
 * id (and so, unhandled, reads as already settled from the moment it starts).
 */
export function shouldSettleConvertRequest(
  request: ConvertRequest,
  outcome: ConvertOutcome,
  handledRequestId: number | null
): boolean {
  return (
    outcome.kind !== "pending" &&
    outcome.kind !== "running" &&
    handledRequestId !== request.requestId
  );
}
