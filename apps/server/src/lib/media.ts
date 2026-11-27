import { execFile, spawn } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { setPriority } from "node:os";
import { promisify } from "node:util";
import { loadDsp } from "@workspace/dsp/host/bun";
import type { Dsp } from "@workspace/dsp/runtime";
import type { AnalysisSession } from "@workspace/dsp/analysis";
import { instancePolicy } from "./instance-policy.js";
import { FFMPEG_PATH } from "./media-binaries.js";
import {
  AUDIO_EXTENSIONS,
  type AudioExtension,
} from "@workspace/settings/groups/instance-limits";

/**
 * The only module in the server that spawns a child process. Every argument
 * reaches the binary as its own `argv` entry, so a path or filename can never
 * be read as shell syntax — nothing here goes through `/bin/sh`.
 */
const run = promisify(execFile);

/** What a file we produced in each format is served as. */
export const AUDIO_MIME_TYPES: Record<AudioExtension, string> = {
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".aiff": "audio/aiff",
  ".aif": "audio/aiff",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
};

/** The audio format a file name declares, or undefined for anything that is not audio. */
export function audioExtensionOf(name: string): AudioExtension | undefined {
  const lower = name.toLowerCase();
  return AUDIO_EXTENSIONS.find((ext) => lower.endsWith(ext));
}

export function isAudioName(name: string) {
  return audioExtensionOf(name) !== undefined;
}

/**
 * How much of a file's head `hasAudioSignature` reads — enough to hold two
 * consecutive MPEG audio frames even at the format's largest legal size
 * (MPEG-2/2.5 Layer II at 160kbps/8kHz, ~2.9KB per frame).
 */
export const AUDIO_SIGNATURE_BYTES = 6 * 1024;

const tagAt = (head: Uint8Array, at: number, ...tags: string[]) => {
  const found = String.fromCharCode(...head.subarray(at, at + 4));
  return tags.includes(found);
};

/** kbps by 1-based layer index (I, II, III), for an MPEG-1 header. */
const MPEG1_BITRATES_KBPS = [
  [],
  [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
] as const;
/** kbps by 1-based layer index, for an MPEG-2 or MPEG-2.5 header. */
const MPEG2_BITRATES_KBPS = [
  [],
  [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
] as const;
const MPEG1_SAMPLE_RATES = [44100, 48000, 32000];
const MPEG2_SAMPLE_RATES = [22050, 24000, 16000];
const MPEG25_SAMPLE_RATES = [11025, 12000, 8000];

/**
 * The total byte length of the MPEG-1/2/2.5 Layer I/II/III frame beginning
 * at `offset`, or null when the four bytes there are not a well-formed
 * header — a reserved version, layer, bitrate or sample-rate field, none of
 * which a real encoder ever writes there.
 */
function mpegFrameLength(head: Uint8Array, offset: number): number | null {
  const b1 = head[offset + 1] ?? 0;
  if (head[offset] !== 0xff || (b1 & 0xe0) !== 0xe0) return null;

  const version = (b1 >> 3) & 0b11; // 00 MPEG2.5, 01 reserved, 10 MPEG2, 11 MPEG1
  const layerBits = (b1 >> 1) & 0b11; // 00 reserved, 01 Layer III, 10 Layer II, 11 Layer I
  if (version === 1 || layerBits === 0) return null;
  const layer = 4 - layerBits;

  const b2 = head[offset + 2] ?? 0;
  const bitrateIndex = (b2 >> 4) & 0xf;
  const sampleRateIndex = (b2 >> 2) & 0b11;
  if (bitrateIndex === 0 || bitrateIndex === 0xf || sampleRateIndex === 3) {
    return null;
  }
  const padding = (b2 >> 1) & 1;

  const isMpeg1 = version === 3;
  const kbps = (isMpeg1 ? MPEG1_BITRATES_KBPS : MPEG2_BITRATES_KBPS)[layer]![
    bitrateIndex
  ]!;
  const sampleRate = (
    isMpeg1
      ? MPEG1_SAMPLE_RATES
      : version === 2
        ? MPEG2_SAMPLE_RATES
        : MPEG25_SAMPLE_RATES
  )[sampleRateIndex]!;

  if (layer === 1)
    return (Math.floor((12_000 * kbps) / sampleRate) + padding) * 4;
  const coefficient = layer === 3 && !isMpeg1 ? 72_000 : 144_000;
  return Math.floor((coefficient * kbps) / sampleRate) + padding;
}

/**
 * The total byte length of the ADTS (AAC) frame beginning at `offset`, read
 * directly from its own 13-bit `frame_length` field, or null when the sync
 * there is not ADTS's 12-bit form — one bit wider than plain MPEG audio's.
 */
function adtsFrameLength(head: Uint8Array, offset: number): number | null {
  const b1 = head[offset + 1] ?? 0;
  if (head[offset] !== 0xff || (b1 & 0xf0) !== 0xf0) return null;
  const b3 = head[offset + 3] ?? 0;
  const b4 = head[offset + 4] ?? 0;
  const b5 = head[offset + 5] ?? 0;
  return ((b3 & 0x03) << 11) | (b4 << 3) | (b5 >> 5);
}

/**
 * Whether a second MPEG-audio or ADTS frame header follows immediately after
 * the one at the start of `head`, at the exact offset the first frame's own
 * length field declares. A bare sync word is 11 bits, which two unrelated
 * bytes satisfy by chance often enough that it proves nothing on its own; a
 * second header landing exactly where the first says it should is what a
 * real encoder's output has and noise does not.
 */
function hasSecondFrameHeader(head: Uint8Array): boolean {
  const length = mpegFrameLength(head, 0) ?? adtsFrameLength(head, 0);
  if (length === null || length < 4) return false;
  return (
    mpegFrameLength(head, length) !== null ||
    adtsFrameLength(head, length) !== null
  );
}

/**
 * Whether a file's first `AUDIO_SIGNATURE_BYTES` carry the signature of a
 * format `AUDIO_EXTENSIONS` names. `isAudioName` only reads the extension, so a
 * JPEG renamed to `.mp3` passes it and then fails every analysis. Any audio
 * signature counts, whatever the extension says: ffmpeg reads the format from
 * the content, so a FLAC saved as `.wav` still analyses.
 */
export function hasAudioSignature(head: Uint8Array): boolean {
  if (tagAt(head, 0, "RIFF", "RF64", "BW64")) return tagAt(head, 8, "WAVE");
  if (tagAt(head, 0, "FORM")) return tagAt(head, 8, "AIFF", "AIFC");
  if (tagAt(head, 0, "fLaC", "OggS") || tagAt(head, 4, "ftyp")) return true;
  // An ID3 tag can front mp3, aac or flac; past it are MPEG or ADTS frames,
  // whose 11-bit sync word is the only signature a bare mp3 or aac has.
  if (String.fromCharCode(...head.subarray(0, 3)) === "ID3") return true;
  if (head[0] === 0xff && ((head[1] ?? 0) & 0xe0) === 0xe0) {
    return hasSecondFrameHeader(head);
  }
  return false;
}

const MEDIA_BINARIES = [FFMPEG_PATH];

const onPathProbes = new Map<string, Promise<boolean>>();

const isPath = (value: string) => value.includes("/");

/**
 * A bare command name does not resolve with `access`, so presence is decided by
 * running it once. The answer cannot change while the process runs, so it is
 * cached and callers never spawn anything per request.
 */
function resolvesOnPath(command: string): Promise<boolean> {
  let probe = onPathProbes.get(command);
  if (!probe) {
    // A non-zero exit still proves the binary is there — only a failure to
    // spawn it means it is missing.
    probe = run(command, ["-version"]).then(
      () => true,
      (err: NodeJS.ErrnoException) => err.code !== "ENOENT"
    );
    onPathProbes.set(command, probe);
  }
  return probe;
}

/** Whether one of the media binaries can actually be run. */
export function binaryPresent(value: string): Promise<boolean> {
  if (!isPath(value)) return resolvesOnPath(value);
  return access(value, constants.X_OK).then(
    () => true,
    () => false
  );
}

// Probed at boot so the first health check has an answer waiting rather than a
// spawn to wait on.
for (const value of MEDIA_BINARIES) {
  if (!isPath(value)) void resolvesOnPath(value);
}

/**
 * Parses ffmpeg's `Duration: HH:MM:SS.CC` banner line into milliseconds, or
 * null before it has appeared. `convertAudio`'s own progress reads
 * the same line, so the parse lives here rather than beside `decodeInto`.
 */
export function parseFfmpegDurationMs(stderrLine: string): number | null {
  const match = /Duration:\s*(\d+):(\d\d):(\d\d)\.(\d\d)/.exec(stderrLine);
  if (!match) return null;
  const [, hours, minutes, seconds, centiseconds] = match;
  return Math.round(
    ((+hours! * 60 + +minutes!) * 60 + +seconds! + +centiseconds! / 100) * 1000
  );
}

/** Maximum stderr retained per ffmpeg child, keeping the tail for diagnostics. */
export const MAX_FFMPEG_STDERR_CHARS = 16 * 1024;

/**
 * ffmpeg's stderr as it arrives. The pipe splits it wherever it likes, so the
 * `Duration:` banner can land across two chunks; the duration is read from
 * what has been received so far rather than from any one chunk, and stays
 * fixed once found. Retained text is capped at {@link MAX_FFMPEG_STDERR_CHARS}
 * (tail) so a noisy stream cannot grow memory without bound.
 */
export function ffmpegStderr(maxChars = MAX_FFMPEG_STDERR_CHARS) {
  let text = "";
  let durationMs: number | null = null;
  return {
    push(chunk: string) {
      text += chunk;
      durationMs ??= parseFfmpegDurationMs(text);
      if (text.length > maxChars) {
        text = text.slice(text.length - maxChars);
      }
    },
    durationMs: () => durationMs,
    text: () => text,
  };
}

/** The rate and channel count every decode feeds the analysis session at. */
export const DECODE_SAMPLE_RATE = 48_000;
export const DECODE_CHANNELS = 2;
/** Cap ffmpeg's thread pool so background media work cannot starve API requests. */
const FFMPEG_THREAD_ARGS = ["-threads", "1"] as const;
/** Lower scheduling priority applied to spawned ffmpeg processes on Linux (`nice -n 10`). */
const FFMPEG_NICE_PRIORITY = 10;
const DECODE_ARGS_HEAD = [
  "-hide_banner",
  "-nostats",
  "-loglevel",
  "info",
  ...FFMPEG_THREAD_ARGS,
];
const DECODE_ARGS_TAIL = [
  "-vn",
  "-f",
  "f32le",
  "-ac",
  String(DECODE_CHANNELS),
  "-ar",
  String(DECODE_SAMPLE_RATE),
  "-",
];
/** Bytes per interleaved stereo f32 frame: the alignment a decoded chunk is carried to. */
const FRAME_BYTES = DECODE_CHANNELS * 4;

/** How often `decodeInto` and `convertAudio` report progress, at most. */
const PROGRESS_INTERVAL_MS = 250;

export type MediaProgress = (fraction: number) => Promise<void> | void;

/** How long `probeMediaSeconds` gives a bare `-i` read to print a duration. */
export const PROBE_TIMEOUT_MS = 20_000;

/**
 * The longest input a decode or convert will ever read, whatever it declares:
 * the instance's `limits.longestAudioHours`, read at each call so a changed
 * limit applies to the next job.
 */
export const maxMediaSeconds = (): number =>
  instancePolicy().limits.longestAudioHours * 60 * 60;

/**
 * The wall-clock budget a decode or convert of `durationSeconds` gets before
 * its child is killed. Decode and analysis run far faster than real time; a
 * tenth of the duration plus a floor covers a slow disk. `durationSeconds` is
 * clamped to {@link maxMediaSeconds} first, so a caller that already
 * refused a longer input never has to clamp it again to get a sane deadline.
 */
export function mediaDeadlineMs(durationSeconds: number): number {
  return (
    60_000 +
    Math.ceil((Math.min(durationSeconds, maxMediaSeconds()) * 1000) / 10)
  );
}

/**
 * Thrown when an input's own declared length is the reason a job cannot run
 * — over {@link maxMediaSeconds}, or a probe that could not read a
 * duration inside {@link PROBE_TIMEOUT_MS}. Neither is worth a retry: the
 * file is the problem, not the attempt, so `db/queries/jobs.ts` fails the job
 * outright on this error however many attempts its kind otherwise allows.
 */
export class MediaLimitError extends Error {
  constructor(
    message: string,
    readonly code: "media_too_long" | "media_unreadable"
  ) {
    super(message);
    this.name = "MediaLimitError";
  }
}

/**
 * Thrown when an ffmpeg decode or transcode exceeds its wall-clock deadline.
 * Distinct from a caller-initiated `AbortError` so the job runner records a
 * failure and retries instead of misclassifying the timeout as a cancellation.
 */
export class MediaTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaTimeoutError";
  }
}

/** Restricts every ffmpeg read to the local file it was given and caps how
 *  much of it can ever be read, regardless of what the input claims. */
const inputGuards = () => [
  "-protocol_whitelist",
  "file,pipe",
  "-t",
  String(maxMediaSeconds()),
];

/** Builds the argv list for decoding `path` into interleaved stereo f32 PCM. */
export function buildDecodeArgs(path: string): string[] {
  return [
    ...DECODE_ARGS_HEAD,
    ...inputGuards(),
    "-i",
    path,
    ...DECODE_ARGS_TAIL,
  ];
}

/** Builds the argv list for transcoding `input` into `output` under `format`. */
export function buildConvertArgs(
  input: string,
  output: string,
  format: AudioExtension,
  kbps = 320
): string[] {
  const codec =
    format === ".mp3" ? ["-c:a", "libmp3lame", "-b:a", `${kbps}k`] : [];
  return [
    "-y",
    "-hide_banner",
    "-nostats",
    ...FFMPEG_THREAD_ARGS,
    ...inputGuards(),
    "-i",
    input,
    ...FFMPEG_THREAD_ARGS,
    ...codec,
    "-progress",
    "pipe:1",
    output,
  ];
}

/**
 * Spawns ffmpeg with `args` under `deadlineMs`, the one place `decodeInto`,
 * `convertAudio` and `probeMediaSeconds` all get a child, an abort that
 * kills it, and the duration their progress divides against. `deadlineMs` and
 * `signal` combine through `AbortSignal.any`, so a deadline that fires kills
 * the child exactly as a cancel would, while `timedOut()` tells the caller
 * whether the deadline rather than `signal` fired. Rejects with an `AbortError`
 * before spawning anything when `signal` has already aborted, so a cancel that
 * lands before a caller starts never runs ffmpeg on a file nobody wants decoded
 * or encoded anymore.
 */
function spawnFfmpeg(
  args: string[],
  { signal, deadlineMs }: { signal?: AbortSignal; deadlineMs: number }
) {
  const timeoutSignal = AbortSignal.timeout(deadlineMs);
  const combined = signal
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal;
  if (signal?.aborted) {
    throw new DOMException("aborted before ffmpeg started", "AbortError");
  }
  if (timeoutSignal.aborted) {
    throw new MediaTimeoutError(
      `ffmpeg exceeded ${deadlineMs}ms deadline before starting`
    );
  }
  const child = spawn(FFMPEG_PATH, args, { stdio: ["ignore", "pipe", "pipe"] });
  if (process.platform === "linux" && child.pid !== undefined) {
    try {
      setPriority(child.pid, FFMPEG_NICE_PRIORITY);
    } catch {
      // Child may have already exited or the container policy may disallow renicing.
    }
  }
  const onAbort = () => child.kill("SIGKILL");
  combined.addEventListener("abort", onAbort, { once: true });

  const stderr = ffmpegStderr();
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", stderr.push);

  const exit = new Promise<number | null>((resolve) => {
    child.once("error", () => resolve(null));
    child.once("close", (code) => resolve(code));
  });

  return {
    child,
    /** Fires on a cancel, a deadline, or both — the child is already dead either way. */
    signal: combined,
    /** Whether the wall-clock deadline (rather than a caller abort) fired. */
    timedOut: () => timeoutSignal.aborted,
    durationMs: stderr.durationMs,
    stderrTail: stderr.text,
    exit,
    /** Detaches `onAbort`; call once the caller's own stdout loop is done. */
    cleanup: () => combined.removeEventListener("abort", onAbort),
  };
}

/**
 * The input's declared duration in seconds, read from ffmpeg's own banner
 * with no output requested — ffmpeg parses the container header and stops,
 * never decoding a frame. Runs under its own short deadline
 * ({@link PROBE_TIMEOUT_MS} unless `timeoutMs` overrides it for a test),
 * since a probe that hangs is exactly the input `decodeInto` and
 * `convertAudio` must never reach: a `media_unreadable` {@link MediaLimitError}.
 * A duration over `maxSeconds` ({@link maxMediaSeconds} by default) is
 * `media_too_long`, refused the same way before a single frame is decoded.
 * Null when ffmpeg exits — quickly, not timing out — without ever printing a
 * duration: an unreadable file that isn't stalling, which the caller's own
 * decode or convert already reports on its own terms. A `signal` already
 * aborted, or one that fires while the probe runs, rejects with a plain
 * `AbortError` rather than a `MediaLimitError`, since the caller's own cancel
 * is not a fact about the file.
 */
export async function probeMediaSeconds(
  path: string,
  {
    signal,
    timeoutMs = PROBE_TIMEOUT_MS,
    maxSeconds = maxMediaSeconds(),
  }: { signal?: AbortSignal; timeoutMs?: number; maxSeconds?: number } = {}
): Promise<number | null> {
  const {
    durationMs,
    exit,
    cleanup,
    signal: deadline,
  } = spawnFfmpeg([...FFMPEG_THREAD_ARGS, ...inputGuards(), "-i", path], {
    signal,
    deadlineMs: timeoutMs,
  });
  try {
    await exit;
  } finally {
    cleanup();
  }
  if (signal?.aborted) {
    throw new DOMException("probe aborted", "AbortError");
  }
  if (deadline.aborted) {
    throw new MediaLimitError(
      `probing ${path} did not finish inside ${timeoutMs}ms`,
      "media_unreadable"
    );
  }

  const ms = durationMs();
  if (ms === null) return null;
  const seconds = ms / 1000;
  if (seconds > maxSeconds) {
    throw new MediaLimitError(
      `${path} declares ${Math.round(seconds)}s, over the ${maxSeconds}s limit`,
      "media_too_long"
    );
  }
  return seconds;
}

/**
 * The same over-length check {@link probeMediaSeconds} makes, for a duration
 * a caller already has on hand instead of one just read off the file — a row
 * from a prior analysis, most often. Skipping the probe only skips the read;
 * the limit it would have enforced still applies.
 */
function requireKnownDuration(
  durationSeconds: number,
  maxSeconds: number
): number {
  if (durationSeconds > maxSeconds) {
    throw new MediaLimitError(
      `caller-supplied duration ${Math.round(durationSeconds)}s is over the ${maxSeconds}s limit`,
      "media_too_long"
    );
  }
  return durationSeconds;
}

/**
 * Decodes `path` to interleaved stereo f32 at {@link DECODE_SAMPLE_RATE} and
 * feeds every whole frame to `session`. Sizes the decode's deadline
 * ({@link mediaDeadlineMs}) from `durationSeconds` when the caller already
 * has it — a re-analysis, whose row still carries `durationMs` from the run
 * before — otherwise probes the input first through {@link probeMediaSeconds}.
 * Either way a `MediaLimitError` over the input's length propagates before
 * ffmpeg ever spawns for the decode itself. ffmpeg's `Duration:` banner
 * (printed before the first sample reaches stdout) turns frames received
 * into a progress fraction; `onProgress` is called at most once per
 * `PROGRESS_INTERVAL_MS` and never above 0.999, since the true end is
 * `session.finish()` returning. Resolves to the frame count decoded, or null
 * when ffmpeg cannot read the file. `signal` kills the child with `SIGKILL`
 * and rejects with an `AbortError`; exceeding the wall-clock deadline kills
 * the child and rejects with a {@link MediaTimeoutError}.
 */
export async function decodeInto(
  path: string,
  session: AnalysisSession,
  {
    onProgress,
    signal,
    durationSeconds,
    maxMediaSeconds: maxSeconds = maxMediaSeconds(),
    probeTimeoutMs = PROBE_TIMEOUT_MS,
    deadlineMs,
  }: {
    onProgress?: MediaProgress;
    signal?: AbortSignal;
    /** Skips the probe spawn when the caller already knows the input's
     *  length; still checked against `maxMediaSeconds`. */
    durationSeconds?: number;
    maxMediaSeconds?: number;
    /** Overridable so a test can make a stalled probe fail fast. */
    probeTimeoutMs?: number;
    /** Overridable so a test can exercise the decode deadline without waiting 60s. */
    deadlineMs?: number;
  } = {}
): Promise<number | null> {
  const probedSeconds =
    durationSeconds !== undefined
      ? requireKnownDuration(durationSeconds, maxSeconds)
      : await probeMediaSeconds(path, {
          signal,
          maxSeconds,
          timeoutMs: probeTimeoutMs,
        });

  const decodeDeadlineMs = deadlineMs ?? mediaDeadlineMs(probedSeconds ?? 0);
  const { child, durationMs, exit, cleanup, timedOut } = spawnFfmpeg(
    buildDecodeArgs(path),
    {
      signal,
      deadlineMs: decodeDeadlineMs,
    }
  );

  let expectedFrames: number | null = null;
  let frames = 0;
  let carry: Buffer = Buffer.alloc(0);
  let lastReport = 0;
  try {
    for await (const chunk of child.stdout as AsyncIterable<Buffer>) {
      const bytes = carry.length === 0 ? chunk : Buffer.concat([carry, chunk]);
      // A pooled Buffer starts at an arbitrary offset and a chunk may split a
      // frame, so the usable prefix is copied into an aligned Float32Array of
      // whole frames; the remainder carries to the next chunk.
      const usable = bytes.length - (bytes.length % FRAME_BYTES);
      const samples = new Float32Array(usable / 4);
      Buffer.from(samples.buffer).set(bytes.subarray(0, usable));
      session.push(samples);
      carry = bytes.subarray(usable);
      frames += usable / FRAME_BYTES;

      const now = Date.now();
      if (onProgress && now - lastReport > PROGRESS_INTERVAL_MS) {
        expectedFrames ??=
          durationMs() === null
            ? null
            : Math.round((durationMs()! / 1000) * DECODE_SAMPLE_RATE);
        if (expectedFrames) {
          lastReport = now;
          await onProgress(Math.min(0.999, frames / expectedFrames));
        }
      }
    }
  } catch (error) {
    child.kill("SIGKILL");
    if (signal?.aborted) throw error;
    if (timedOut()) {
      throw new MediaTimeoutError(
        `decoding ${path} exceeded ${decodeDeadlineMs}ms deadline`
      );
    }
    return null;
  } finally {
    cleanup();
  }
  if (signal?.aborted) {
    throw new DOMException("decode aborted", "AbortError");
  }
  if (timedOut()) {
    throw new MediaTimeoutError(
      `decoding ${path} exceeded ${decodeDeadlineMs}ms deadline`
    );
  }
  if ((await exit) !== 0) return null;
  session.finish();
  return frames;
}

let dsp: Promise<Dsp> | undefined;

/** The one `dsp.wasm` instance the process analyses through; built on first use. */
export function getDsp(): Promise<Dsp> {
  return (dsp ??= loadDsp());
}

/**
 * Transcodes `input` to `output`; the caller owns both paths. Sizes the
 * encode's deadline ({@link mediaDeadlineMs}) from `durationSeconds` when the
 * caller already has it, otherwise probes `input` first through
 * {@link probeMediaSeconds}. Either way a `MediaLimitError` over the input's
 * length propagates before ffmpeg ever spawns for the encode itself. `format`
 * picks the codec for mp3 and otherwise only has to agree with `output`'s
 * extension, which is what ffmpeg reads the muxer from. `-progress pipe:1`
 * writes `key=value` lines to stdout as the encode runs; `out_time_us`
 * against the duration `parseFfmpegDurationMs` reads off stderr turns into
 * `onProgress`, called at most once per `PROGRESS_INTERVAL_MS` and never
 * above 0.999. Rejects when ffmpeg fails, so the caller decides what an
 * unconvertible file means. `signal` kills the child with `SIGKILL` and
 * rejects with an `AbortError`; exceeding the wall-clock deadline kills the
 * child and rejects with a {@link MediaTimeoutError}.
 */
export async function convertAudio(
  input: string,
  output: string,
  format: AudioExtension,
  kbps = 320,
  {
    onProgress,
    signal,
    durationSeconds,
    maxMediaSeconds: maxSeconds = maxMediaSeconds(),
    deadlineMs,
  }: {
    onProgress?: MediaProgress;
    signal?: AbortSignal;
    /** Skips the probe spawn when the caller already knows the input's
     *  length; still checked against `maxMediaSeconds`. */
    durationSeconds?: number;
    maxMediaSeconds?: number;
    /** Overridable so a test can exercise the convert deadline without waiting 60s. */
    deadlineMs?: number;
  } = {}
): Promise<void> {
  const probedSeconds =
    durationSeconds !== undefined
      ? requireKnownDuration(durationSeconds, maxSeconds)
      : await probeMediaSeconds(input, {
          signal,
          maxSeconds,
        });

  const convertDeadlineMs = deadlineMs ?? mediaDeadlineMs(probedSeconds ?? 0);
  const { child, durationMs, stderrTail, exit, cleanup, timedOut } =
    spawnFfmpeg(buildConvertArgs(input, output, format, kbps), {
      signal,
      deadlineMs: convertDeadlineMs,
    });

  let carry = "";
  let lastReport = 0;
  try {
    child.stdout.setEncoding("utf8");
    for await (const chunk of child.stdout as AsyncIterable<string>) {
      carry += chunk;
      let newlineAt: number;
      while ((newlineAt = carry.indexOf("\n")) !== -1) {
        const line = carry.slice(0, newlineAt).trimEnd();
        carry = carry.slice(newlineAt + 1);
        const match = /^out_time_us=(\d+)$/.exec(line);
        const now = Date.now();
        const duration = durationMs();
        if (
          match &&
          onProgress &&
          duration &&
          now - lastReport > PROGRESS_INTERVAL_MS
        ) {
          lastReport = now;
          await onProgress(Math.min(0.999, Number(match[1]) / 1000 / duration));
        }
      }
    }
  } catch (error) {
    // A stream error unrelated to a cancel still leaves the child to be
    // reaped below by its exit code; a cancel or deadline rethrows directly.
    child.kill("SIGKILL");
    if (signal?.aborted) throw error;
    if (timedOut()) {
      throw new MediaTimeoutError(
        `converting ${input} exceeded ${convertDeadlineMs}ms deadline`
      );
    }
  } finally {
    cleanup();
  }
  if (signal?.aborted) {
    throw new DOMException("convert aborted", "AbortError");
  }
  if (timedOut()) {
    throw new MediaTimeoutError(
      `converting ${input} exceeded ${convertDeadlineMs}ms deadline`
    );
  }
  const code = await exit;
  if (code !== 0) {
    throw new Error(
      `ffmpeg could not convert ${input}: ${stderrTail().trim()}`
    );
  }
}
