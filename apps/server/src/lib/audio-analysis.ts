import { existsSync } from "node:fs";
import { setPriority } from "node:os";
import { fileURLToPath } from "node:url";
import type { AnalysisSession } from "@workspace/dsp/analysis";
import type { OfflineAnalyses } from "@workspace/dsp/offline";
import {
  MediaLimitError,
  MediaTimeoutError,
  type MediaProgress,
  maxMediaSeconds,
} from "./media.js";

/** Lowest CPU scheduling priority on Linux (`nice -n 19`) so background audio
 *  analysis never preempts HTTP requests or database work. */
const WORKER_NICE_PRIORITY = 19;
/** Grace period after sending an abort IPC before force-killing the worker. */
const ABORT_KILL_GRACE_MS = 1_000;

export interface AudioAnalysisResult {
  durationMs: AnalysisSession["durationMs"];
  peaks: AnalysisSession["peaks"];
  loudness: AnalysisSession["loudness"];
  spectrum: AnalysisSession["spectrum"];
  tempo: OfflineAnalyses["tempo"];
  key: OfflineAnalyses["key"];
  sections: OfflineAnalyses["sections"];
  spectrogram: OfflineAnalyses["spectrogram"];
  loudnessCurve: OfflineAnalyses["loudnessCurve"];
  correlationCurve: OfflineAnalyses["correlationCurve"];
  clipping: OfflineAnalyses["clipping"];
  silence: OfflineAnalyses["silence"];
  pitchTrack: OfflineAnalyses["pitchTrack"];
  features: OfflineAnalyses["features"];
}

export type AudioAnalysisWorkerRequest =
  | {
      type: "analyse";
      file: string;
      flags: number;
      durationSeconds?: number;
      maxMediaSeconds: number;
    }
  | { type: "abort" };

export type AudioAnalysisWorkerMessage =
  | { type: "progress"; fraction: number }
  | { type: "step"; step: "analyse" }
  | { type: "result"; result: AudioAnalysisResult | null }
  | { type: "error"; kind: "abort" | "timeout" | "generic"; message: string }
  | {
      type: "error";
      kind: "limit";
      code: MediaLimitError["code"];
      message: string;
    };

function resolveWorkerPath(): string {
  const candidates = [
    fileURLToPath(new URL("./audio-analysis-worker.ts", import.meta.url)),
    fileURLToPath(new URL("./audio-analysis-worker.js", import.meta.url)),
    fileURLToPath(new URL("./lib/audio-analysis-worker.js", import.meta.url)),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error("audio-analysis-worker entrypoint not found");
}

/**
 * Runs ffmpeg decode and synchronous WASM DSP analysis in a dedicated
 * low-priority child process (`nice -n 19` on Linux) so the API server's main
 * event loop never blocks on audio analysis.
 */
export async function analyseAudioInWorker(
  file: string,
  {
    flags,
    durationSeconds,
    maxMediaSeconds: maxSeconds = maxMediaSeconds(),
    onProgress,
    onStep,
    signal,
  }: {
    flags: number;
    durationSeconds?: number;
    maxMediaSeconds?: number;
    onProgress?: MediaProgress;
    onStep?: (step: "analyse") => Promise<void> | void;
    signal?: AbortSignal;
  }
): Promise<AudioAnalysisResult | null> {
  if (signal?.aborted) {
    throw new DOMException("analysis aborted before starting", "AbortError");
  }

  const workerPath = resolveWorkerPath();
  let settled = false;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  let reportChain = Promise.resolve();

  return await new Promise<AudioAnalysisResult | null>((resolve, reject) => {
    const finish = (
      outcome:
        | { ok: true; value: AudioAnalysisResult | null }
        | { ok: false; error: unknown }
    ) => {
      if (settled) return;
      settled = true;
      if (killTimer) clearTimeout(killTimer);
      signal?.removeEventListener("abort", onAbort);
      void reportChain.finally(() => {
        if (outcome.ok) resolve(outcome.value);
        else reject(outcome.error);
      });
    };

    const proc = Bun.spawn([process.execPath, workerPath], {
      stdio: ["ignore", "ignore", "pipe"],
      ipc(raw) {
        const msg = raw as AudioAnalysisWorkerMessage;
        if (msg.type === "progress") {
          if (onProgress) {
            reportChain = reportChain
              .then(() => onProgress(msg.fraction))
              .catch(() => {});
          }
          return;
        }
        if (msg.type === "step") {
          if (onStep) {
            reportChain = reportChain
              .then(() => onStep(msg.step))
              .catch(() => {});
          }
          return;
        }
        if (msg.type === "result") {
          finish({ ok: true, value: msg.result });
          return;
        }
        if (msg.type === "error") {
          if (msg.kind === "abort") {
            finish({
              ok: false,
              error: new DOMException(msg.message, "AbortError"),
            });
          } else if (msg.kind === "limit") {
            finish({
              ok: false,
              error: new MediaLimitError(msg.message, msg.code),
            });
          } else if (msg.kind === "timeout") {
            finish({
              ok: false,
              error: new MediaTimeoutError(msg.message),
            });
          } else {
            finish({ ok: false, error: new Error(msg.message) });
          }
        }
      },
    });

    if (process.platform === "linux" && proc.pid > 0) {
      try {
        setPriority(proc.pid, WORKER_NICE_PRIORITY);
      } catch {
        // Worker may have exited or container policy may disallow renicing.
      }
    }

    const onAbort = () => {
      try {
        proc.send({ type: "abort" } satisfies AudioAnalysisWorkerRequest);
      } catch {
        // IPC may already be closed.
      }
      killTimer = setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {
          // Already exited.
        }
      }, ABORT_KILL_GRACE_MS);
      killTimer.unref();
    };

    signal?.addEventListener("abort", onAbort, { once: true });

    void proc.exited.then(async (code) => {
      if (settled) return;
      if (signal?.aborted) {
        finish({
          ok: false,
          error: new DOMException("analysis aborted", "AbortError"),
        });
        return;
      }
      const stderrText = await new Response(proc.stderr).text().catch(() => "");
      const detail = stderrText.trim();
      finish({
        ok: false,
        error: new Error(
          detail
            ? `audio analysis worker exited (${code}): ${detail}`
            : `audio analysis worker exited unexpectedly (${code})`
        ),
      });
    });

    proc.send({
      type: "analyse",
      file,
      flags,
      durationSeconds,
      maxMediaSeconds: maxSeconds,
    } satisfies AudioAnalysisWorkerRequest);
  });
}
