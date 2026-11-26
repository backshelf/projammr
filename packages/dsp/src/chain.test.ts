import { describe, expect, test } from "bun:test";

import { Chain, CHAIN_QUANTUM, EQ_CURVE_BANDS } from "./chain";
import { Block, Meter, Param, PARAMS, TimeMode } from "./params";
import { DspError, DspErrorCode, instantiateSync } from "./runtime";

const bytes = await Bun.file(
  new URL("../pkg/dsp.wasm", import.meta.url)
).bytes();
const module = new WebAssembly.Module(bytes);
const RATE = 48_000;

/** A chain and an interleaved stereo sine allocated in its module's memory. */
function setup(seconds: number) {
  const dsp = instantiateSync(module);
  const frames = seconds * RATE;
  const bytesNeeded = frames * 2 * Float32Array.BYTES_PER_ELEMENT;
  const source = dsp.nonZero(dsp.exports.dsp_alloc(bytesNeeded), "dsp_alloc");
  const view = new Float32Array(dsp.exports.memory.buffer, source, frames * 2);
  for (let i = 0; i < frames; i++) {
    const v = 0.5 * Math.sin((2 * Math.PI * 440 * i) / RATE);
    view[2 * i] = v;
    view[2 * i + 1] = v;
  }
  const copy = view.slice();
  return { dsp, chain: new Chain(dsp, RATE), source, frames, copy };
}

/** Plays `quanta` calls, returning the output and the frames read. */
function play(
  { chain, source, frames }: ReturnType<typeof setup>,
  quanta: number
) {
  const out = new Float32Array(quanta * CHAIN_QUANTUM * 2);
  let position = 0;
  for (let q = 0; q < quanta; q++) {
    position += chain.process(source + position * 8, frames - position);
    out.set(chain.output, q * CHAIN_QUANTUM * 2);
  }
  return { out, position };
}

describe("Chain", () => {
  test("a new chain passes the source through after its latency", () => {
    const setupResult = setup(1);
    const { out } = play(setupResult, 100);
    const latency = setupResult.chain.latency;
    const heard = out.subarray(latency * 2);
    expect(heard).toEqual(setupResult.copy.subarray(0, heard.length));
  });

  test("speed 2 in speed mode reads the source twice as fast", () => {
    const setupResult = setup(10);
    setupResult.chain.set(Param.TimeMode, TimeMode.Speed);
    setupResult.chain.set(Param.TimeSpeed, 2);
    const { position } = play(setupResult, 1000);
    expect(Math.abs(position - 2 * 1000 * CHAIN_QUANTUM)).toBeLessThan(4096);
  });

  test("every parameter accepts its generated default and refuses a value past its domain", () => {
    const { chain } = setup(1);
    PARAMS.forEach((spec, id) => {
      const param = id as (typeof Param)[keyof typeof Param];
      chain.set(param, Number(spec.default));
      const beyond =
        spec.kind === "range"
          ? spec.max + 1
          : spec.kind === "toggle"
            ? 2
            : Object.keys(spec.choices).length;
      expect(() => chain.set(param, beyond)).toThrow(
        new DspError(DspErrorCode.BadArgument, "chain_set")
      );
    });
  });

  test("the compressor's gain reduction reads through its meter once engaged", () => {
    const setupResult = setup(1);
    const { chain } = setupResult;
    chain.setBypass(Block.Compressor, false);
    chain.set(Param.CompThresholdDb, -40);
    play(setupResult, 200);
    expect(chain.meter(Meter.GainReductionDb)).toBeGreaterThan(10);
    expect(chain.meter(Meter.Correlation)).toBeCloseTo(1, 3);
  });

  test("the output reads through a fresh view after memory grows", () => {
    const setupResult = setup(1);
    const { dsp, chain } = setupResult;
    chain.process(setupResult.source, setupResult.frames);
    const before = chain.output.slice();
    dsp.withF32(16 * 1024 * 1024, () => undefined);
    expect(chain.output).toEqual(before);
  });

  test("processing does not grow memory", () => {
    const setupResult = setup(4);
    play(setupResult, 10);
    const size = setupResult.dsp.exports.memory.buffer.byteLength;
    setupResult.chain.setBypass(Block.Reverb, false);
    setupResult.chain.set(Param.TimePitchSemitones, 5);
    play(setupResult, 1000);
    expect(setupResult.dsp.exports.memory.buffer.byteLength).toBe(size);
  });

  test("an EQ curve must carry 31 gains", () => {
    const { chain } = setup(1);
    expect(() => chain.setEqCurve([1, 2, 3])).toThrow(RangeError);
    chain.setEqCurve(new Array<number>(EQ_CURVE_BANDS).fill(3));
    chain.setEqCurve(null);
  });

  test("a freed chain fails with BadHandle and frees once", () => {
    const { chain, source, frames } = setup(1);
    chain.free();
    expect(() => chain.process(source, frames)).toThrow(
      new DspError(DspErrorCode.BadHandle, "chain_process")
    );
    expect(Number.isNaN(chain.meter(Meter.Correlation))).toBe(true);
    expect(() => chain.free()).not.toThrow();
  });

  test("a rate the chain cannot run at is refused", () => {
    const dsp = instantiateSync(module);
    expect(() => new Chain(dsp, 1000)).toThrow(
      new DspError(DspErrorCode.BadArgument, "chain_new")
    );
  });
});
