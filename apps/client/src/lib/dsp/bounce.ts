/**
 * Prints what the Lab plays: an `OfflineAudioContext` render of the current
 * source through the same `dsp-processor.js` module and the listener's
 * settings, encoded to 24-bit FLAC and uploaded as a track attachment. The
 * FLAC's size is estimated against the server's upload cap before the render
 * starts, so a song too long to upload stops at once rather than after it.
 *
 * Independent of whether the Lab is engaged for live playback — a bounce at
 * every setting left default is still a valid print of the plain file, and
 * the Lab's `"player"` node transfers its decoded channels into worklet
 * memory rather than holding a reusable copy on the main thread — so this
 * downloads and decodes its own copy of the source rather than reaching into
 * the live Lab engine for one. Decoding straight into the render context
 * (fixed at {@link BOUNCE_SAMPLE_RATE}, never the live output's own rate)
 * has the browser resample the source to match, so a bounce is pitch- and
 * duration-correct regardless of the device's audio hardware rate. `bounce()`
 * always runs against the queue's current track, whose bytes the browser's
 * HTTP cache already holds from live playback (`private, max-age=3600` on
 * `/static`), so this second `fetch` is ordinarily served locally rather
 * than over the network.
 */

import type { PlaybackSource } from "@/components/music-player/player-engine";
import {
  tooBigMaximum,
  uploadAsset,
  uploadLimit,
} from "@/components/uploads/upload-client";
import { estimateFlacBytes } from "@/lib/dsp/flac-encode";
import type {
  FlacEncodeRequest,
  FlacEncodeResponse,
} from "@/lib/dsp/flac-encode.worker";
import { loadSourceBytes, type LabEngineDeps } from "@/lib/dsp/lab-engine";
import { requestLabCopy } from "@/lib/dsp/lab-copy";
import {
  chainParams,
  playbackSpeed,
  type LabLoudness,
  type LabSettings,
} from "@/lib/dsp/lab-settings";
import { loadProcessor } from "@/lib/dsp/processor-module";
import {
  DSP_PROCESSOR,
  type PlayerCommand,
  type PlayerMessage,
  type PlayerRoleOptions,
} from "@/lib/dsp/processor-protocol";
import type { ActionError, Asset } from "@workspace/api/api";
import { defaultFormatters } from "@workspace/ui/lib/formatters";
import { isActionError } from "@workspace/api/lib/action-result";
import { Chain, CHAIN_QUANTUM } from "@workspace/dsp/chain";
import { loadDsp } from "@workspace/dsp/host/browser";
import { isCoarsePointer } from "@workspace/ui/hooks/use-coarse-pointer";

/** The bounce's fixed render rate, independent of whatever rate live playback happens to run at. */
const BOUNCE_SAMPLE_RATE = 48000;
/** How often a render reports back while it's in flight. */
const CHECKPOINT_SECONDS = 5;
const CHANNELS = 2;

export type BounceRenderProgress =
  | { phase: "rendering"; fraction: number }
  | { phase: "encoding" }
  | { phase: "uploading"; fraction: number };

export type BounceInput = {
  source: PlaybackSource;
  settings: LabSettings;
  /** What `normalise` reads, as the live Lab has it. */
  loudness: LabLoudness;
  /** The match-EQ curve currently applied, from the engine. */
  curve: number[] | null;
  projectId: number;
  trackId: number;
  /** The attachment's file name, already composed. */
  name: string;
};

export type BounceDeps = LabEngineDeps & {
  /** Builds the offline context a render (or a decode probe) runs on. */
  createOfflineContext: (
    channels: number,
    length: number,
    sampleRate: number
  ) => OfflineAudioContext;
  /** Encodes the rendered channels to a FLAC file's bytes, off the main thread. */
  encode: (
    channels: Float32Array[],
    sampleRate: number
  ) => Promise<ArrayBuffer>;
  /** The largest file, in bytes, the server accepts as an upload. */
  uploadLimit: () => Promise<number | ActionError>;
  upload: (
    file: File,
    projectId: number,
    onProgress?: (fraction: number) => void
  ) => Promise<Asset | ActionError>;
  attach: (
    assetId: number,
    parentKind: "track",
    parentId: number
  ) => Promise<Asset | ActionError>;
};

/** The failure a bounce reports when its file is, or would be, over the upload
 *  cap. A size in whole units has no decimal sign for a locale to change, so
 *  the default formatter set writes it as any viewer's would. */
function overCap(size: number, maxBytes: number, estimated: boolean) {
  const mb = (bytes: number) => defaultFormatters().bytes(bytes, 0);
  return {
    error: `This bounce ${estimated ? "would be about" : "is"} ${mb(size)}; uploads are limited to ${mb(maxBytes)}.`,
  };
}

/** Raises the abort reason once the caller has moved on, so a render already in
 *  flight stops short of encoding, uploading or attaching for a track nobody
 *  is bouncing anymore. */
function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted)
    throw signal.reason ?? new DOMException("Aborted", "AbortError");
}

/** The chain's output frames per source frame it reads, and its latency at `settings`. */
async function probeChain(
  settings: LabSettings,
  loudness: LabLoudness,
  curve: number[] | null
): Promise<number> {
  const dsp = await loadDsp();
  const chain = new Chain(dsp, BOUNCE_SAMPLE_RATE, CHAIN_QUANTUM);
  try {
    const { values, bypass } = chainParams(settings, loudness);
    for (const [param, value] of values) chain.set(param, value);
    for (const [block, bypassed] of bypass) chain.setBypass(block, bypassed);
    if (curve) chain.setEqCurve(curve);
    return chain.latency;
  } finally {
    chain.free();
  }
}

/**
 * Waits for the `"player"` role's answer to a `load`: `duration` once the
 * source sits in module memory, or `failed` — most often a phone out of
 * memory for the file's size — which must stop the render rather than let it
 * run against an empty source and print silence.
 */
function waitForLoad(node: AudioWorkletNode): Promise<void> {
  return new Promise((resolve, reject) => {
    node.port.onmessage = (event: MessageEvent<PlayerMessage>) => {
      const message = event.data;
      if (message.type === "duration") resolve();
      else if (message.type === "failed") {
        reject(new Error("There is not enough memory for this file here"));
      }
    };
    node.onprocessorerror = () => {
      reject(new Error("The Lab could not load its processor"));
    };
  });
}

/** Runs the render itself: a `"player"` node fed `channels`, pulled through to `length` output frames. */
async function renderChannels(
  channels: Float32Array[],
  length: number,
  settings: LabSettings,
  loudness: LabLoudness,
  curve: number[] | null,
  deps: BounceDeps,
  onProgress: (status: BounceRenderProgress) => void,
  signal: AbortSignal
): Promise<AudioBuffer> {
  const ctx = deps.createOfflineContext(CHANNELS, length, BOUNCE_SAMPLE_RATE);
  const processor = await loadProcessor(ctx);
  if (!processor.ok) {
    throw new Error(
      processor.reason === "unsupported"
        ? "This browser cannot run the Lab"
        : "The Lab could not load its processor"
    );
  }

  const node = new AudioWorkletNode(ctx, DSP_PROCESSOR, {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [CHANNELS],
    processorOptions: {
      role: "player",
      module: processor.module,
    } satisfies PlayerRoleOptions,
  });
  node.connect(ctx.destination);

  try {
    const send = (command: PlayerCommand, transfer: Transferable[] = []) =>
      node.port.postMessage(command, transfer);

    const { values, bypass } = chainParams(settings, loudness);
    send({ type: "params", values, bypass });
    if (curve) send({ type: "curve", gains: curve });
    const loaded = waitForLoad(node);
    send(
      { type: "load", slot: "a", channels },
      channels.map((c) => c.buffer)
    );
    await loaded;
    node.port.onmessage = null;
    assertNotAborted(signal);

    send({ type: "play" });

    const totalSeconds = length / BOUNCE_SAMPLE_RATE;
    onProgress({ phase: "rendering", fraction: 0 });
    for (
      let at = CHECKPOINT_SECONDS;
      at < totalSeconds;
      at += CHECKPOINT_SECONDS
    ) {
      const checkpoint = at;
      void ctx.suspend(checkpoint).then(() => {
        onProgress({
          phase: "rendering",
          fraction: Math.min(1, checkpoint / totalSeconds),
        });
        return ctx.resume();
      });
    }

    const rendered = await ctx.startRendering();
    onProgress({ phase: "rendering", fraction: 1 });
    return rendered;
  } finally {
    node.disconnect();
  }
}

/**
 * Renders `input.source` through the current chain, encodes it and uploads
 * it as a track attachment. `onProgress` reports the rendering fraction,
 * a bare `encoding` phase (the worker gives no progress of its own) and the
 * uploading fraction; the resolved value is the attached asset, or the
 * upload-limit, upload or attach call's error — including a bounce whose
 * estimated FLAC is over the cap, which stops before rendering, and one the
 * upload refused as too big after all, which reports the same way. Rejects once `signal` aborts, checked
 * between every phase, so a bounce nobody is waiting on anymore never
 * uploads or attaches for a track the listener has moved past.
 */
export async function bounce(
  input: BounceInput,
  deps: BounceDeps,
  onProgress: (status: BounceRenderProgress) => void,
  signal: AbortSignal
): Promise<Asset | ActionError> {
  const maxBytes = await deps.uploadLimit();
  if (typeof maxBytes !== "number") return maxBytes;
  assertNotAborted(signal);

  const decodeCtx = deps.createOfflineContext(CHANNELS, 1, BOUNCE_SAMPLE_RATE);
  const { buffer } = await loadSourceBytes(
    input.source,
    deps,
    () => {},
    signal
  );
  assertNotAborted(signal);
  const decoded = await decodeCtx.decodeAudioData(buffer);
  assertNotAborted(signal);

  const speed = playbackSpeed(input.settings);
  const latency = await probeChain(input.settings, input.loudness, input.curve);
  const length = Math.ceil(decoded.length / speed) + latency;
  const estimate = estimateFlacBytes(length, CHANNELS);
  if (estimate > maxBytes) return overCap(estimate, maxBytes, true);

  const channels = Array.from(
    { length: Math.min(CHANNELS, decoded.numberOfChannels) },
    (_, i) => decoded.getChannelData(i).slice()
  );

  const rendered = await renderChannels(
    channels,
    length,
    input.settings,
    input.loudness,
    input.curve,
    deps,
    onProgress,
    signal
  );
  assertNotAborted(signal);

  onProgress({ phase: "encoding" });
  const renderedChannels = Array.from(
    { length: rendered.numberOfChannels },
    (_, i) => rendered.getChannelData(i).slice()
  );
  const flac = await deps.encode(renderedChannels, BOUNCE_SAMPLE_RATE);
  assertNotAborted(signal);
  const file = new File([flac], input.name, { type: "audio/flac" });

  onProgress({ phase: "uploading", fraction: 0 });
  const uploaded = await deps.upload(file, input.projectId, (fraction) =>
    onProgress({ phase: "uploading", fraction })
  );
  assertNotAborted(signal);
  if (isActionError(uploaded)) {
    const maximum = tooBigMaximum(uploaded);
    return maximum == null ? uploaded : overCap(file.size, maximum, false);
  }

  return deps.attach(uploaded.id, "track", input.trackId);
}

/** Encodes in a fresh worker, torn down once it answers. */
function encodeInWorker(
  channels: Float32Array[],
  sampleRate: number
): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("./flac-encode.worker.ts", import.meta.url),
      { type: "module" }
    );
    worker.onmessage = (event: MessageEvent<FlacEncodeResponse>) => {
      worker.terminate();
      const response = event.data;
      if (response.ok) resolve(response.flac);
      else reject(new Error(response.reason));
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || "The bounce could not be encoded"));
    };
    const request: FlacEncodeRequest = { sampleRate, channels };
    worker.postMessage(
      request,
      channels.map((channel) => channel.buffer)
    );
  });
}

/**
 * `attachAssetTo` is a server action, whose module reaches `server-only`
 * through `lib/server-api.ts`; a plain `import` of it here would drag that
 * into every module that imports `bounce.ts`, including the store under
 * `bun test`. A dynamic import defers that until a bounce actually attaches,
 * which never happens in a test that injects its own `attach`.
 */
const attach: BounceDeps["attach"] = (assetId, parentKind, parentId) =>
  import("@/actions/assets").then(({ attachAssetTo }) =>
    attachAssetTo(assetId, parentKind, parentId)
  );

/** The browser's bounce dependencies: the Lab's own download and copy
 *  fallback, a real offline context, a worker encode, the server's upload
 *  cap, and the existing upload and attach calls. */
export function defaultBounceDeps(): BounceDeps {
  return {
    fetch: (input, init) => fetch(input, init),
    coarse: isCoarsePointer,
    requestCopy: requestLabCopy,
    createOfflineContext: (channels, length, sampleRate) =>
      new OfflineAudioContext(channels, length, sampleRate),
    encode: encodeInWorker,
    uploadLimit,
    upload: uploadAsset,
    attach,
  };
}
