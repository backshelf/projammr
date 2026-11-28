import { AnalysisSession } from "@workspace/dsp/analysis";
import { OfflineAnalyses } from "@workspace/dsp/offline";
import {
  decodeInto,
  DECODE_CHANNELS,
  DECODE_SAMPLE_RATE,
  getDsp,
  MediaLimitError,
  MediaTimeoutError,
} from "./media.js";
import type {
  AudioAnalysisWorkerMessage,
  AudioAnalysisWorkerRequest,
} from "./audio-analysis.js";

function send(message: AudioAnalysisWorkerMessage): void {
  process.send?.(message);
}

const abortController = new AbortController();

process.on("message", (raw: unknown) => {
  const message = raw as AudioAnalysisWorkerRequest;
  if (message.type === "abort") {
    abortController.abort();
    return;
  }
  if (message.type !== "analyse") return;

  void (async () => {
    const dsp = await getDsp();
    const session = new AnalysisSession(
      dsp,
      DECODE_SAMPLE_RATE,
      DECODE_CHANNELS,
      message.flags
    );
    try {
      const frames = await decodeInto(message.file, session, {
        onProgress: (fraction) => send({ type: "progress", fraction }),
        signal: abortController.signal,
        durationSeconds: message.durationSeconds,
        maxMediaSeconds: message.maxMediaSeconds,
      });
      if (frames === null) {
        send({ type: "result", result: null });
        return;
      }

      send({ type: "step", step: "analyse" });
      const loudness = session.loudness;
      const offline = new OfflineAnalyses(session);
      const estimators = 10;
      let estimated = 0;
      const readEstimator = <T>(read: () => T): T => {
        const value = read();
        send({ type: "progress", fraction: ++estimated / estimators });
        return value;
      };

      const tempo = readEstimator(() => offline.tempo);
      const key = readEstimator(() => offline.key);
      const sections = readEstimator(() => offline.sections);
      const spectrogram = readEstimator(() => offline.spectrogram);
      const loudnessCurve = readEstimator(() => offline.loudnessCurve);
      const correlationCurve = readEstimator(() => offline.correlationCurve);
      const clipping = readEstimator(() => offline.clipping);
      const silence = readEstimator(() => offline.silence);
      const pitchTrack = readEstimator(() => offline.pitchTrack);
      const features = readEstimator(() => offline.features);

      send({
        type: "result",
        result: {
          durationMs: session.durationMs,
          peaks: session.peaks,
          loudness,
          spectrum: session.spectrum,
          tempo,
          key,
          sections,
          spectrogram,
          loudnessCurve,
          correlationCurve,
          clipping,
          silence,
          pitchTrack,
          features,
        },
      });
    } catch (error) {
      if (abortController.signal.aborted) {
        send({ type: "error", kind: "abort", message: "analysis aborted" });
      } else if (error instanceof MediaLimitError) {
        send({
          type: "error",
          kind: "limit",
          code: error.code,
          message: error.message,
        });
      } else if (error instanceof MediaTimeoutError) {
        send({
          type: "error",
          kind: "timeout",
          message: error.message,
        });
      } else {
        send({
          type: "error",
          kind: "generic",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      session.free();
      process.disconnect?.();
    }
  })();
});
