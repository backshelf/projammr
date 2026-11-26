import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import {
  ANALYSIS_LOUDNESS,
  ANALYSIS_PEAKS,
  ANALYSIS_SPECTRUM,
  AnalysisSession,
} from "@workspace/dsp/analysis";
import {
  restoreInstancePolicy,
  stubInstancePolicy,
} from "../test/instance-policy.js";
import { makeStallingFifo, writeTone } from "../test/media.js";
import { mediaQueue } from "./jobs.js";
import {
  AUDIO_SIGNATURE_BYTES,
  convertAudio,
  decodeInto,
  DECODE_CHANNELS,
  ffmpegStderr,
  DECODE_SAMPLE_RATE,
  getDsp,
  hasAudioSignature,
  isAudioName,
  maxMediaSeconds,
  MediaLimitError,
  mediaDeadlineMs,
  parseFfmpegDurationMs,
  probeMediaSeconds,
} from "./media.js";

let dir: string;
let wav: string;

/** A fresh session with every flag `decodeInto` is fed under in the funnel. */
async function newSession(): Promise<AnalysisSession> {
  const dsp = await getDsp();
  return new AnalysisSession(
    dsp,
    DECODE_SAMPLE_RATE,
    DECODE_CHANNELS,
    ANALYSIS_PEAKS | ANALYSIS_LOUDNESS | ANALYSIS_SPECTRUM
  );
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "media-test-"));
  wav = join(dir, "tone.wav");
  await writeTone(wav);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("isAudioName", () => {
  it("matches audio extensions regardless of case", () => {
    expect(isAudioName("Take 3.WAV")).toBe(true);
    expect(isAudioName("mix.flac")).toBe(true);
    expect(isAudioName("notes.pdf")).toBe(false);
    expect(isAudioName("wav")).toBe(false);
  });
});

describe("hasAudioSignature", () => {
  const head = (...parts: (string | number[])[]) =>
    new Uint8Array(
      parts.flatMap((p) =>
        typeof p === "string" ? [...p].map((ch) => ch.charCodeAt(0)) : p
      )
    );

  it("recognises every accepted container by its leading bytes", () => {
    expect(hasAudioSignature(head("RIFF", [0, 0, 0, 0], "WAVE"))).toBe(true);
    expect(hasAudioSignature(head("RF64", [0, 0, 0, 0], "WAVE"))).toBe(true);
    expect(hasAudioSignature(head("FORM", [0, 0, 0, 0], "AIFC"))).toBe(true);
    expect(hasAudioSignature(head("fLaC"))).toBe(true);
    expect(hasAudioSignature(head("OggS"))).toBe(true);
    expect(hasAudioSignature(head([0, 0, 0, 0x20], "ftypM4A "))).toBe(true);
    expect(hasAudioSignature(head("ID3", [4, 0]))).toBe(true);
  });

  it("reads the real tone ffmpeg wrote as audio", async () => {
    const bytes = await Bun.file(wav).slice(0, 12).bytes();
    expect(hasAudioSignature(bytes)).toBe(true);
  });

  it("refuses an image, a non-audio RIFF, and a file too short to tell", () => {
    expect(hasAudioSignature(head([0xff, 0xd8, 0xff, 0xe0]))).toBe(false);
    expect(hasAudioSignature(head([0x89], "PNG"))).toBe(false);
    expect(hasAudioSignature(head("RIFF", [0, 0, 0, 0], "WEBP"))).toBe(false);
    expect(hasAudioSignature(head("FORM", [0, 0, 0, 0], "ILBM"))).toBe(false);
    expect(hasAudioSignature(head("RIFF"))).toBe(false);
    expect(hasAudioSignature(head())).toBe(false);
  });

  it("rejects a binary whose first two bytes happen to match the MPEG sync word", () => {
    // A real frame's header at offset 0 declares where the next one starts;
    // random bytes after a lucky sync essentially never land on another
    // valid header at that exact offset.
    const random = new Uint8Array(AUDIO_SIGNATURE_BYTES);
    random[0] = 0xff;
    random[1] = 0xfb; // MPEG-1 Layer III sync, same as a real mp3's
    for (let i = 2; i < random.length; i++) random[i] = (i * 2654435761) & 0xff;
    expect(hasAudioSignature(random)).toBe(false);
  });

  it("accepts a real MP3 whose second frame header confirms the first", async () => {
    const bare = join(dir, "bare.mp3");
    await writeTone(bare, { seconds: 1, format: "mp3", id3: false });

    const bytes = await Bun.file(bare).slice(0, AUDIO_SIGNATURE_BYTES).bytes();
    // Confirms the fixture actually reaches the branch under test rather
    // than being caught by the ID3 tag ffmpeg writes by default.
    expect(String.fromCharCode(...bytes.subarray(0, 3))).not.toBe("ID3");
    expect(bytes[0]).toBe(0xff);
    expect(hasAudioSignature(bytes)).toBe(true);
  });
});

describe("parseFfmpegDurationMs", () => {
  it("reads HH:MM:SS.CC from ffmpeg's banner line", () => {
    const line = "  Duration: 00:03:29.71, start: 0.000000, bitrate: 1411 kb/s";
    expect(parseFfmpegDurationMs(line)).toBe((3 * 60 + 29) * 1000 + 710);
  });

  it("returns null before the duration line has appeared", () => {
    const line = "Input #0, wav, from 'tone.wav':";
    expect(parseFfmpegDurationMs(line)).toBeNull();
  });
});

describe("ffmpegStderr", () => {
  it("reads a duration banner that arrives split across two chunks", () => {
    const stderr = ffmpegStderr();
    stderr.push("Input #0, wav, from 'tone.wav':\n  Duration: 00:0");
    expect(stderr.durationMs()).toBeNull();
    stderr.push("3:29.71, start: 0.000000, bitrate: 1411 kb/s\n");
    expect(stderr.durationMs()).toBe((3 * 60 + 29) * 1000 + 710);
  });

  it("keeps the whole of stderr for an error message", () => {
    const stderr = ffmpegStderr();
    stderr.push("first ");
    stderr.push("second");
    expect(stderr.text()).toBe("first second");
  });
});

describe("decodeInto", () => {
  let longTone: string;

  beforeAll(async () => {
    // Long enough that analysing it takes over a second, so the abort test
    // kills a decode that is genuinely still running and the progress test
    // sees more than one report.
    longTone = join(dir, "long.wav");
    await writeTone(longTone, { seconds: 200 });
  });

  it("decodes a real file to the expected frame count", async () => {
    const twoSeconds = join(dir, "two-seconds.wav");
    await writeTone(twoSeconds, { seconds: 2 });

    const session = await newSession();
    try {
      const frames = await decodeInto(twoSeconds, session);
      expect(frames).not.toBeNull();
      expect(frames!).toBeCloseTo(2 * DECODE_SAMPLE_RATE, -2);
      expect(session.durationMs).toBeCloseTo(2000, -2);
    } finally {
      session.free();
    }
  });

  it("reports progress that rises and stays below 1", async () => {
    const session = await newSession();
    const fractions: number[] = [];
    try {
      // No `durationSeconds` hint, on purpose: this is the unknown-duration
      // path, so `decodeInto` pays for a real probe spawn before the real
      // decode spawn it's timing progress against. `apps/server`'s
      // `bun run test` raises the per-test default for exactly this case.
      await decodeInto(longTone, session, {
        onProgress: (fraction) => {
          fractions.push(fraction);
        },
      });
    } finally {
      session.free();
    }

    expect(fractions.length).toBeGreaterThan(1);
    for (let i = 1; i < fractions.length; i++) {
      expect(fractions[i]!).toBeGreaterThanOrEqual(fractions[i - 1]!);
    }
    expect(fractions.every((fraction) => fraction < 1)).toBe(true);
  }, 15_000);

  it("returns null for a file that is not audio rather than throwing", async () => {
    const path = join(dir, "decode-notes.wav");
    await writeFile(path, "this is not a wav file");

    const session = await newSession();
    try {
      expect(await decodeInto(path, session)).toBeNull();
    } finally {
      session.free();
    }
  });

  it("kills the child and rejects with AbortError when aborted mid-decode", async () => {
    const session = await newSession();
    const controller = new AbortController();
    let onFirstChunk = () => {};
    const decodingStarted = new Promise<void>((resolve) => {
      onFirstChunk = resolve;
    });

    try {
      const decoding = decodeInto(longTone, session, {
        signal: controller.signal,
        onProgress: onFirstChunk,
      });
      await decodingStarted;

      controller.abort();
      await expect(decoding).rejects.toThrow(
        expect.objectContaining({ name: "AbortError" })
      );
    } finally {
      session.free();
    }
  });
});

describe("mediaDeadlineMs", () => {
  it("is 60s plus a tenth of the duration, capped at the six-hour input", () => {
    expect(maxMediaSeconds()).toBe(6 * 60 * 60);
    expect(mediaDeadlineMs(0)).toBe(60_000);
    expect(mediaDeadlineMs(600)).toBe(60_000 + 60_000);
    expect(mediaDeadlineMs(maxMediaSeconds())).toBe(
      mediaDeadlineMs(maxMediaSeconds() * 10)
    );
  });

  it("caps at the longest input the instance sets", () => {
    stubInstancePolicy({ limits: { longestAudioHours: 1 } });
    try {
      expect(maxMediaSeconds()).toBe(3600);
      expect(mediaDeadlineMs(7200)).toBe(60_000 + 360_000);
    } finally {
      restoreInstancePolicy();
    }
  });
});

describe("the instance's longest input", () => {
  afterEach(() => {
    restoreInstancePolicy();
  });

  it("refuses a probe over the limit in force as media_too_long", async () => {
    // The fixture tone is half a second long; a quarter-second limit refuses it.
    stubInstancePolicy({ limits: { longestAudioHours: 0.25 / 3600 } });

    await expect(probeMediaSeconds(wav)).rejects.toMatchObject({
      code: "media_too_long",
    });
  });
});

describe("deadlines", () => {
  // Every fixture is tracked and removed on every exit path — a leftover
  // fifo in the shared temp directory would otherwise confuse the next run.
  const cleanup: string[] = [];
  afterEach(async () => {
    await Promise.all(
      cleanup.splice(0).map((path) => rm(path, { force: true }))
    );
  });

  // Comfortably above the 200ms deadline under test, so a genuine regression
  // (no deadline at all) times out and fails the suite here instead of
  // hanging the whole run.
  const STALL_TEST_TIMEOUT_MS = 5000;

  it(
    "kills a decode child stalled reading a fifo and rejects instead of hanging",
    async () => {
      const fifo = join(dir, `stall-${crypto.randomUUID()}`);
      cleanup.push(fifo);
      await makeStallingFifo(fifo);

      const session = await newSession();
      try {
        const decoding = decodeInto(fifo, session, { probeTimeoutMs: 200 });
        await expect(decoding).rejects.toBeInstanceOf(MediaLimitError);
        await expect(decoding).rejects.toMatchObject({
          code: "media_unreadable",
        });
      } finally {
        session.free();
      }
    },
    STALL_TEST_TIMEOUT_MS
  );

  it(
    "releases the queue slot once a stalled decode is killed, so the queue drains",
    async () => {
      const fifo = join(dir, `stall-queue-${crypto.randomUUID()}`);
      cleanup.push(fifo);
      await makeStallingFifo(fifo);

      const session = await newSession();
      mediaQueue.enqueue("stall-queue-drain", async () => {
        await decodeInto(fifo, session, { probeTimeoutMs: 200 }).catch(
          () => {}
        );
        session.free();
      });
      expect(mediaQueue.size).toBeGreaterThan(0);

      // Settling at all is the slot coming free: the task's own key, not the
      // rest of the queue.
      await mediaQueue.settled("stall-queue-drain");
    },
    STALL_TEST_TIMEOUT_MS
  );

  it("refuses a declaration over the limit without decoding", async () => {
    const path = join(dir, "over-long.wav");
    await writeTone(path, { seconds: 2 });

    const probing = probeMediaSeconds(path, { maxSeconds: 1 });
    await expect(probing).rejects.toBeInstanceOf(MediaLimitError);
    await expect(probing).rejects.toMatchObject({ code: "media_too_long" });
  });

  it("reads the real duration of a file under the limit", async () => {
    const path = join(dir, "under-long.wav");
    await writeTone(path, { seconds: 2 });
    expect(await probeMediaSeconds(path, { maxSeconds: 10 })).toBeCloseTo(2, 1);
  });
});

describe("convertAudio", () => {
  let longTone: string;

  beforeAll(async () => {
    // Long enough that the encode is still running under full test-suite
    // concurrency, so the abort test reliably kills a conversion in flight
    // rather than racing one that has already finished.
    longTone = join(dir, "convert-abort.wav");
    await writeTone(longTone, { seconds: 600 });
  });

  it("transcodes to the requested format", async () => {
    const output = join(dir, "tone.mp3");
    await convertAudio(wav, output, ".mp3", 128);
    expect(existsSync(output)).toBe(true);

    const session = await newSession();
    try {
      expect(await decodeInto(output, session)).not.toBeNull();
      expect(session.durationMs).toBeCloseTo(500, -2);
    } finally {
      session.free();
    }
  });

  it("rejects when the input does not exist", async () => {
    await expect(
      convertAudio(join(dir, "missing.wav"), join(dir, "missing.mp3"), ".mp3")
    ).rejects.toThrow();
  });

  it("treats a path holding shell syntax as one filename", async () => {
    const marker = join(dir, "convert-pwned");
    await expect(
      convertAudio(`x.wav; touch ${marker}; `, join(dir, "out.mp3"), ".mp3")
    ).rejects.toThrow();
    expect(existsSync(marker)).toBe(false);
  });

  it("kills the child and rejects with AbortError when aborted mid-convert", async () => {
    const output = join(dir, "convert-abort.mp3");

    const controller = new AbortController();
    let onFirstProgress = () => {};
    const convertingStarted = new Promise<void>((resolve) => {
      onFirstProgress = resolve;
    });

    const converting = convertAudio(longTone, output, ".mp3", 128, {
      signal: controller.signal,
      onProgress: onFirstProgress,
    });
    await convertingStarted;

    controller.abort();
    await expect(converting).rejects.toThrow(
      expect.objectContaining({ name: "AbortError" })
    );
  });

  it("rejects with AbortError and never spawns when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      convertAudio(wav, join(dir, "pre-aborted.mp3"), ".mp3", 128, {
        signal: controller.signal,
      })
    ).rejects.toThrow(expect.objectContaining({ name: "AbortError" }));
    expect(existsSync(join(dir, "pre-aborted.mp3"))).toBe(false);
  });
});
