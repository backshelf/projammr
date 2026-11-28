import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  ANALYSIS_LOUDNESS,
  ANALYSIS_PEAKS,
  ANALYSIS_SPECTRUM,
} from "@workspace/dsp/analysis";
import { ANALYSIS_OFFLINE } from "@workspace/dsp/offline";
import { writeTone } from "../test/media.js";
import { analyseAudioInWorker } from "./audio-analysis.js";
import { MediaLimitError } from "./media.js";

const FLAGS =
  ANALYSIS_PEAKS | ANALYSIS_LOUDNESS | ANALYSIS_SPECTRUM | ANALYSIS_OFFLINE;

let dir: string;
let wav: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "audio-analysis-worker-test-"));
  wav = join(dir, "tone.wav");
  await writeTone(wav);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("analyseAudioInWorker", () => {
  it("analyses an audio file in an isolated child process and reports steps", async () => {
    const steps: string[] = [];
    const progress: number[] = [];

    const result = await analyseAudioInWorker(wav, {
      flags: FLAGS,
      onStep: (step) => {
        steps.push(step);
      },
      onProgress: (fraction) => {
        progress.push(fraction);
      },
    });

    expect(result).not.toBeNull();
    expect(result!.durationMs).toBeGreaterThan(0);
    expect(result!.peaks.length).toBeGreaterThan(0);
    expect(Number.isFinite(result!.loudness.lufs)).toBe(true);
    expect(result!.spectrogram.columns).toBeGreaterThan(0);
    expect(result!.spectrogram.bytes).toBeInstanceOf(Uint8Array);
    expect(steps).toEqual(["analyse"]);
    expect(progress.length).toBeGreaterThan(0);
  });

  it("transfers large spectrogram payloads over IPC without exiting early", async () => {
    const longWav = join(dir, "long.wav");
    await writeTone(longWav, { seconds: 60 });

    const result = await analyseAudioInWorker(longWav, { flags: FLAGS });
    expect(result).not.toBeNull();
    expect(result!.durationMs).toBeGreaterThanOrEqual(59_000);
    expect(result!.spectrogram.bytes.byteLength).toBeGreaterThan(100_000);
  });

  it("returns null for an unreadable file", async () => {
    const bogus = join(dir, "not-audio.wav");
    await writeFile(bogus, "not a wav file");

    const result = await analyseAudioInWorker(bogus, { flags: FLAGS });
    expect(result).toBeNull();
  });

  it("propagates MediaLimitError when file exceeds maxMediaSeconds", async () => {
    await expect(
      analyseAudioInWorker(wav, {
        flags: FLAGS,
        durationSeconds: 10,
        maxMediaSeconds: 1,
      })
    ).rejects.toBeInstanceOf(MediaLimitError);
  });

  it("rejects with AbortError when signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      analyseAudioInWorker(wav, {
        flags: FLAGS,
        signal: controller.signal,
      })
    ).rejects.toThrow(/aborted/i);
  });
});
