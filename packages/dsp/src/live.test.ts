import { beforeEach, describe, expect, test } from "bun:test";

import { loadDsp } from "./host/bun";
import { createLiveLoudnessMeter, createLiveSpectrumMeter } from "./live";
import type { Dsp } from "./runtime";
import { SPECTRUM_LAYOUT } from "./spectrum";
import spectrumReference from "./spectrum-reference.fixture.json";

const RATE = 48_000;
/** `createLoudnessMeter`'s own hop length: `Math.round(sampleRate * 0.01)`. */
const HOP = Math.round(RATE * 0.01);

let dsp: Dsp;

beforeEach(async () => {
  dsp = await loadDsp();
});

function sineHop(hz: number, amplitude: number, offset: number): Float32Array {
  const out = new Float32Array(HOP);
  for (let i = 0; i < HOP; i++) {
    out[i] = amplitude * Math.sin((2 * Math.PI * hz * (i + offset)) / RATE);
  }
  return out;
}

/**
 * `createLoudnessMeter(48000)`'s first eight 10 ms hops of a 0.5-amplitude
 * 1 kHz stereo sine, fed one hop per `process` call as the worklet does.
 * Copied from a direct run of the client's hand-rolled loudness meter,
 * since retired in favour of this session (`packages/dsp` cannot import
 * `apps/client`) — the meter comes up from its first hop rather than
 * sitting at the floor for 400 ms, which is the behaviour
 * `analysis_take_loudness`'s window/filled correction reproduces.
 */
const LOUDNESS_METER_FIRST_HOPS: readonly {
  momentary: number;
  shortTerm: number;
}[] = [
  { momentary: -6.02626228414063, shortTerm: -6.02626228414063 },
  { momentary: -6.020004137158093, shortTerm: -6.020004137158093 },
  { momentary: -6.017905774036764, shortTerm: -6.017905774036764 },
  { momentary: -6.016894860145493, shortTerm: -6.016894860145493 },
  { momentary: -6.0162939801145265, shortTerm: -6.0162939801145265 },
  { momentary: -6.015894071959165, shortTerm: -6.015894071959165 },
  { momentary: -6.0156085113435145, shortTerm: -6.0156085113435145 },
  { momentary: -6.01539435967746, shortTerm: -6.01539435967746 },
];
/** The sample peak of a 0.5-amplitude sine in dBFS: `20·log10(0.5)`. */
const EXPECTED_PEAK = 20 * Math.log10(0.5);

describe("createLiveLoudnessMeter", () => {
  test("matches createLoudnessMeter's first hops to 0.1 dB, rising from the first hop", () => {
    const meter = createLiveLoudnessMeter(dsp, RATE, 2);

    let offset = 0;
    for (const expected of LOUDNESS_METER_FIRST_HOPS) {
      const hop = sineHop(1000, 0.5, offset);
      offset += HOP;
      meter.process([hop, hop]);
      const readout = meter.take();

      expect(readout).not.toBeNull();
      expect(
        Math.abs(readout!.momentary - expected.momentary)
      ).toBeLessThanOrEqual(0.1);
      expect(
        Math.abs(readout!.shortTerm - expected.shortTerm)
      ).toBeLessThanOrEqual(0.1);
      expect(Math.abs(readout!.peak - EXPECTED_PEAK)).toBeLessThanOrEqual(0.1);
    }
  });

  test("reports nothing before a hop closes", () => {
    const meter = createLiveLoudnessMeter(dsp, RATE, 1);
    meter.process([new Float32Array(HOP - 1)]);
    expect(meter.take()).toBeNull();
  });

  test("silence gates to -Infinity", () => {
    const meter = createLiveLoudnessMeter(dsp, RATE, 1);
    meter.process([new Float32Array(HOP)]);
    const readout = meter.take()!;
    expect(readout.momentary).toBe(-Infinity);
    expect(readout.shortTerm).toBe(-Infinity);
    expect(readout.peak).toBe(-Infinity);
  });
});

// `spectrumReference.hopBands` is a direct run of the retired TypeScript
// `createSpectrumMeter` on a full-window 440 Hz sine, captured before its
// removal (`spectrum-reference.fixture.json`).
describe("createLiveSpectrumMeter", () => {
  test("matches the retired TypeScript meter's per-hop bands to 0.1 dB", () => {
    const size = SPECTRUM_LAYOUT.fftSize;
    const signal = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      signal[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / RATE);
    }

    const live = createLiveSpectrumMeter(dsp, RATE, 1);
    live.process([signal]);
    const bands = live.take();

    expect(bands).not.toBeNull();
    for (let b = 0; b < bands!.length; b++) {
      expect(
        Math.abs(bands![b]! - spectrumReference.hopBands[b]!)
      ).toBeLessThanOrEqual(0.1);
    }
  });

  test("reports nothing before the first full window", () => {
    const live = createLiveSpectrumMeter(dsp, RATE, 1);
    live.process([new Float32Array(1024)]);
    expect(live.take()).toBeNull();
  });

  test("128-frame quanta perform zero WASM allocations in steady state", () => {
    let allocCalls = 0;
    const origAlloc = dsp.exports.dsp_alloc;
    const spyExports = {
      ...dsp.exports,
      dsp_alloc(bytes: number) {
        allocCalls++;
        return origAlloc(bytes);
      },
    };
    const spyDsp = Object.assign(Object.create(Object.getPrototypeOf(dsp)), {
      exports: spyExports,
    }) as Dsp;

    const loudness = createLiveLoudnessMeter(spyDsp, RATE, 2);
    const spectrum = createLiveSpectrumMeter(spyDsp, RATE, 2);
    const allocsAfterInit = allocCalls;

    const left = new Float32Array(128).fill(0.25);
    const right = new Float32Array(128).fill(-0.25);
    for (let i = 0; i < 16; i++) {
      loudness.process([left, right]);
      spectrum.process([left, right]);
    }
    expect(allocCalls).toBe(allocsAfterInit);
    loudness.free();
    spectrum.free();
  });
});
