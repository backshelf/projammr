import { convertOutcome } from "@/components/uploads/convert-outcome";
import { FALLBACK_POLL_MS } from "@/components/jobs/jobs-poll";
import { browserApi } from "@/lib/browser-api";
import { clientGetJob } from "@/lib/client-api";
import { LabUnavailable } from "@/lib/dsp/lab-engine";
import { mediaProxyUrl } from "@/lib/utils";
import { isActionError } from "@workspace/api/lib/action-result";

/** Resolves after `ms`, or rejects as soon as `signal` aborts. */
function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true }
    );
  });
}

/**
 * Queues the 320 kbps MP3 copy the Lab plays when an upload is over its size
 * cap (the same conversion job the download dialog queues, so its row shows
 * in the jobs tray), then reads the job at the tray's fallback cadence until
 * it settles, resolving with the copy's media URL.
 */
export async function requestLabCopy(
  assetId: number,
  signal: AbortSignal
): Promise<string> {
  const { data, error } = await browserApi.POST("/api/assets/{id}/convert", {
    params: { path: { id: String(assetId) } },
    body: { format: ".mp3", kbps: 320 },
    signal,
  });
  if (error || !data) {
    throw new LabUnavailable("A 320 kbps copy could not be requested");
  }
  for (;;) {
    const job = await clientGetJob(data.jobId);
    const outcome = convertOutcome(isActionError(job) ? undefined : job);
    if (outcome.kind === "failed") throw new LabUnavailable(outcome.message);
    if (outcome.kind === "done") {
      if (!outcome.output.url) {
        throw new LabUnavailable("The 320 kbps copy has no file");
      }
      return mediaProxyUrl(outcome.output.url);
    }
    await wait(FALLBACK_POLL_MS, signal);
  }
}
