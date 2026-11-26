import type { BlockId, MeterId, ParamId } from "./params.js";
import type { Dsp } from "./runtime.js";

/** Output frames per `process` call by default: one Web Audio render quantum. */
export const CHAIN_QUANTUM = 128;
/** Gains a match-EQ curve carries: one per ISO 1/3-octave band, 20 Hz to 20 kHz. */
export const EQ_CURVE_BANDS = 31;

const CHANNELS = 2;
const F32 = Float32Array.BYTES_PER_ELEMENT;

/**
 * One `Chain` in module memory: the Lab's blocks, in order, on one source.
 * Parameters are addressed by `Param` and `Block` from `params.ts`.
 *
 * The output and EQ-curve buffers are allocated once, here, so `process`
 * allocates nothing. Any call into the module may grow memory and detach a
 * view, so `output` builds a fresh view on every read.
 */
export class Chain {
  readonly frames: number;
  readonly #dsp: Dsp;
  #handle: number;
  readonly #output: number;
  readonly #curve: number;

  /** A chain for a context at `rate` Hz that fills `frames` frames per call. */
  constructor(dsp: Dsp, rate: number, frames = CHAIN_QUANTUM) {
    if (!Number.isInteger(frames) || frames <= 0) {
      throw new RangeError(`cannot process ${frames} frames per call`);
    }
    const { exports } = dsp;
    this.#dsp = dsp;
    this.frames = frames;
    this.#handle = dsp.nonZero(exports.chain_new(rate), "chain_new");
    const buffers: number[] = [];
    try {
      for (const bytes of this.#bufferBytes()) {
        buffers.push(dsp.nonZero(exports.dsp_alloc(bytes), "dsp_alloc"));
      }
    } catch (error) {
      buffers.forEach((ptr, i) =>
        exports.dsp_free(ptr, this.#bufferBytes()[i]!)
      );
      exports.chain_free(this.#handle);
      throw error;
    }
    [this.#output, this.#curve] = buffers as [number, number];
  }

  #bufferBytes(): [output: number, curve: number] {
    return [this.frames * CHANNELS * F32, EQ_CURVE_BANDS * F32];
  }

  /** Sets a parameter; throws `DspError` (BadArgument) outside its domain. */
  set(param: ParamId, value: number): void {
    this.#dsp.check(
      this.#dsp.exports.chain_set(this.#handle, param, value),
      "chain_set"
    );
  }

  setBypass(block: BlockId, bypassed: boolean): void {
    this.#dsp.check(
      this.#dsp.exports.chain_set_bypass(this.#handle, block, bypassed ? 1 : 0),
      "chain_set_bypass"
    );
  }

  /** Replaces the EQ's bands with a 31-band curve in dB, or restores them with `null`. */
  setEqCurve(gains: ArrayLike<number> | null): void {
    const { exports } = this.#dsp;
    if (gains === null) {
      this.#dsp.check(
        exports.chain_set_eq_curve(this.#handle, 0, 0),
        "chain_set_eq_curve"
      );
      return;
    }
    if (gains.length !== EQ_CURVE_BANDS) {
      throw new RangeError(
        `an EQ curve has ${EQ_CURVE_BANDS} gains, not ${gains.length}`
      );
    }
    new Float32Array(exports.memory.buffer, this.#curve, EQ_CURVE_BANDS).set(
      gains
    );
    this.#dsp.check(
      exports.chain_set_eq_curve(this.#handle, this.#curve, EQ_CURVE_BANDS),
      "chain_set_eq_curve"
    );
  }

  /**
   * Fills `output` from the interleaved stereo source at `source` in module
   * memory, which holds `sourceFrames` frames from the read position to the
   * end. Returns the source frames read; the caller advances its read
   * position by that many.
   */
  process(source: number, sourceFrames: number): number {
    const read = this.#dsp.exports.chain_process(
      this.#handle,
      source,
      sourceFrames,
      this.#output,
      this.frames
    );
    if (read < 0) this.#dsp.check(-read, "chain_process");
    return read;
  }

  /** The last `process` call's interleaved output, valid until the next call into the module. */
  get output(): Float32Array {
    return new Float32Array(
      this.#dsp.exports.memory.buffer,
      this.#output,
      this.frames * CHANNELS
    );
  }

  /** Flushes the chain's buffers and signal state, for a seek. */
  reset(): void {
    this.#dsp.check(this.#dsp.exports.chain_reset(this.#handle), "chain_reset");
  }

  /** Output frames between a source frame being read and being heard. */
  get latency(): number {
    const frames = this.#dsp.exports.chain_latency(this.#handle);
    if (frames < 0) this.#dsp.check(-frames, "chain_latency");
    return frames;
  }

  /** A meter's current reading; NaN once the chain is freed. */
  meter(meter: MeterId): number {
    return this.#dsp.exports.chain_meter(this.#handle, meter);
  }

  /** Frees the chain and its buffers. Later calls fail with BadHandle. */
  free(): void {
    if (this.#handle === 0) return;
    const { exports } = this.#dsp;
    this.#dsp.check(exports.chain_free(this.#handle), "chain_free");
    this.#handle = 0;
    const [output, curve] = this.#bufferBytes();
    exports.dsp_free(this.#output, output);
    exports.dsp_free(this.#curve, curve);
  }
}
