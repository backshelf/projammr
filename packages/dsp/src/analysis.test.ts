import { beforeEach, describe, expect, test } from "bun:test";

import {
  ANALYSIS_LOUDNESS,
  ANALYSIS_PEAKS,
  ANALYSIS_SPECTRUM,
  AnalysisSession,
} from "./analysis";
import { loadDsp } from "./host/bun";
import { DspError, type Dsp } from "./runtime";
import spectrumReference from "./spectrum-reference.fixture.json";

const RATE = 48_000;

let dsp: Dsp;

beforeEach(async () => {
  dsp = await loadDsp();
});

/** `length` samples of a sine at `hz`, starting at sample `offset`. */
function sine(
  hz: number,
  amplitude: number,
  length: number,
  offset = 0
): Float32Array {
  const signal = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    signal[i] = amplitude * Math.sin((2 * Math.PI * hz * (i + offset)) / RATE);
  }
  return signal;
}

function interleaveStereo(mono: Float32Array): Float32Array {
  const out = new Float32Array(mono.length * 2);
  for (let i = 0; i < mono.length; i++) {
    out[i * 2] = mono[i]!;
    out[i * 2 + 1] = mono[i]!;
  }
  return out;
}

/** Uniform noise from a fixed seed, so a slope assertion is reproducible
 *  (the same generator `spectrum.test.ts` uses). */
function whiteNoise(length: number, amplitude: number): Float32Array {
  let seed = 0x2545f491;
  const signal = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    signal[i] = ((seed / 0x100000000) * 2 - 1) * amplitude;
  }
  return signal;
}

/**
 * Feeds a signal to a session, then asserts every band of its average
 * matches `expectedDb` (captured from a direct run of the retired
 * TypeScript `createSpectrumMeter`, `spectrum-reference.fixture.json`) to
 * 0.1 dB.
 */
function expectSpectrumMatchesReference(
  dsp: Dsp,
  signal: Float32Array,
  expectedDb: readonly number[]
): void {
  const session = new AnalysisSession(dsp, RATE, 1, ANALYSIS_SPECTRUM);
  session.push(signal);
  session.finish();

  const curve = session.spectrum!;
  expect(curve.hz).toEqual(spectrumReference.hz);
  for (let b = 0; b < curve.db.length; b++) {
    expect(Math.abs(curve.db[b]! - expectedDb[b]!)).toBeLessThanOrEqual(0.1);
  }
  session.free();
}

describe("peaks", () => {
  test("one magnitude per 50 ms, 0..1, a trailing partial bin counts", () => {
    const session = new AnalysisSession(dsp, RATE, 1, ANALYSIS_PEAKS);
    session.push(sine(1000, 0.5, RATE)); // 1 s: 20 full 50 ms bins
    session.push(sine(1000, 0.9, 100, RATE)); // a short trailing partial bin
    session.finish();

    const peaks = session.peaks;
    expect(peaks).toHaveLength(21);
    for (const value of peaks.slice(0, 20)) {
      expect(Math.abs(value - 0.5)).toBeLessThan(0.001);
    }
    session.free();
  });

  test("is empty without the peaks flag", () => {
    const session = new AnalysisSession(dsp, RATE, 1, ANALYSIS_LOUDNESS);
    session.push(sine(1000, 0.5, RATE));
    session.finish();
    expect(session.peaks).toHaveLength(0);
    session.free();
  });
});

describe("loudness", () => {
  test("a half-amplitude stereo sine reads about -6.0 LUFS and -6.02 dBTP", () => {
    const session = new AnalysisSession(dsp, RATE, 2, ANALYSIS_LOUDNESS);
    session.push(interleaveStereo(sine(1000, 0.5, RATE * 2)));
    session.finish();

    const loudness = session.loudness;
    expect(Math.abs(loudness.lufs - -6.0)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(loudness.truePeakDb - -6.02)).toBeLessThanOrEqual(0.05);
    expect(loudness.lra).toBe(0);
    session.free();
  });

  test("silence reads -Infinity", () => {
    const session = new AnalysisSession(dsp, RATE, 1, ANALYSIS_LOUDNESS);
    session.push(new Float32Array(RATE));
    session.finish();

    expect(session.loudness.lufs).toBe(-Infinity);
    expect(session.loudness.truePeakDb).toBe(-Infinity);
    session.free();
  });

  test("the absolute gate ignores leading silence", () => {
    const withSilence = new AnalysisSession(dsp, RATE, 2, ANALYSIS_LOUDNESS);
    withSilence.push(interleaveStereo(new Float32Array(RATE * 5)));
    withSilence.push(interleaveStereo(sine(1000, 0.5, RATE * 5)));
    withSilence.finish();

    const sineOnly = new AnalysisSession(dsp, RATE, 2, ANALYSIS_LOUDNESS);
    sineOnly.push(interleaveStereo(sine(1000, 0.5, RATE * 5)));
    sineOnly.finish();

    expect(
      Math.abs(withSilence.loudness.lufs - sineOnly.loudness.lufs)
    ).toBeLessThanOrEqual(0.2);
    withSilence.free();
    sineOnly.free();
  });

  test("a 0.99-amplitude sine reads true peak above 0 dBTP from oversampling", () => {
    // A cosine's crest lands exactly on a sample (`loudness.rs`'s own
    // cargo test), isolating the oversampling filter's passband ripple.
    const quarterCycle = RATE / (4 * 1000);
    const session = new AnalysisSession(dsp, RATE, 2, ANALYSIS_LOUDNESS);
    session.push(interleaveStereo(sine(1000, 0.99, RATE, quarterCycle)));
    session.finish();

    expect(session.loudness.truePeakDb).toBeGreaterThan(0);
    session.free();
  });
});

describe("duration", () => {
  test("frames and durationMs track every pushed sample", () => {
    const session = new AnalysisSession(dsp, RATE, 1, 0);
    session.push(new Float32Array(RATE * 1.5));
    session.finish();

    expect(session.frames).toBe(BigInt(RATE * 1.5));
    expect(session.durationMs).toBe(1500);
    session.free();
  });
});

describe("spectrum", () => {
  test.each([
    ["a 440 Hz sine", () => sine(440, 0.5, RATE), spectrumReference.sine440Db],
    ["white noise", () => whiteNoise(RATE * 4, 0.2), spectrumReference.noiseDb],
    ["silence", () => new Float32Array(RATE), spectrumReference.silenceDb],
  ] as const)(
    "matches the retired TypeScript meter's average on %s to 0.1 dB",
    (_name, makeSignal, expectedDb) => {
      expectSpectrumMatchesReference(dsp, makeSignal(), expectedDb);
    }
  );

  test("matches the retired TypeScript meter's average on a half-silence signal to 0.1 dB", () => {
    const signal = new Float32Array(RATE * 4);
    signal.set(sine(440, 0.5, RATE), 0);
    expectSpectrumMatchesReference(
      dsp,
      signal,
      spectrumReference.halfSilenceDb
    );
  });

  test("is null before a full window and without the spectrum flag", () => {
    const withoutFlag = new AnalysisSession(dsp, RATE, 1, ANALYSIS_PEAKS);
    withoutFlag.push(sine(440, 0.5, RATE));
    withoutFlag.finish();
    expect(withoutFlag.spectrum).toBeNull();
    withoutFlag.free();

    const tooShort = new AnalysisSession(dsp, RATE, 1, ANALYSIS_SPECTRUM);
    tooShort.push(new Float32Array(1024));
    expect(tooShort.spectrum).toBeNull();
    tooShort.free();
  });
});

describe("lifecycle", () => {
  test("an unknown flag bit fails construction with BadArgument", () => {
    expect(() => new AnalysisSession(dsp, RATE, 1, 1 << 13)).toThrow(DspError);
  });

  test("free is idempotent", () => {
    const session = new AnalysisSession(dsp, RATE, 1, 0);
    session.free();
    expect(() => session.free()).not.toThrow();
  });

  test("push refuses a sample count that is not a multiple of the channel count", () => {
    const session = new AnalysisSession(dsp, RATE, 2, 0);
    expect(() => session.push(new Float32Array(3))).toThrow(RangeError);
    session.free();
  });
});
