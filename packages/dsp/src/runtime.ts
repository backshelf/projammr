/**
 * The typed loader over an instantiated `dsp.wasm`. It needs nothing but
 * `WebAssembly`, so the same code runs in Bun, on a page's main thread and in
 * an AudioWorklet; `host/*` supplies the bytes or the compiled module for each.
 */

/** The ABI this loader speaks; the module's `dsp_abi_version()` must match. */
export const ABI_VERSION = 1;

/** The codes of `DspError` in `rust/src/error.rs`. */
export const DspErrorCode = {
  None: 0,
  BadHandle: 1,
  BadArgument: 2,
  Unsupported: 3,
  OutOfMemory: 4,
} as const;

interface DspFunction {
  readonly name: string;
  /** Parameter names, for reading; every parameter is a number. */
  readonly params: readonly string[];
  /** `bigint` for an `i64`/`u64` result, `number` for every other number. */
  readonly returns: "number" | "bigint" | "void";
}

/**
 * Every function `dsp.wasm` exports. `DspExports` is derived from this list,
 * and `runtime.test.ts` fails unless the built module exports exactly these
 * names with these parameter counts.
 */
export const DSP_FUNCTIONS = [
  { name: "dsp_abi_version", params: [], returns: "number" },
  { name: "dsp_last_error", params: [], returns: "number" },
  { name: "dsp_alloc", params: ["bytes"], returns: "number" },
  { name: "dsp_free", params: ["ptr", "bytes"], returns: "void" },
  {
    name: "analysis_new",
    params: ["rate", "channels", "flags"],
    returns: "number",
  },
  {
    name: "analysis_push",
    params: ["handle", "ptr", "frames"],
    returns: "number",
  },
  {
    name: "analysis_spectrum_layout",
    params: [
      "handle",
      "bands",
      "lowHz",
      "highHz",
      "fftSize",
      "tiltDbPerOctave",
      "floorDb",
    ],
    returns: "number",
  },
  { name: "analysis_finish", params: ["handle"], returns: "number" },
  { name: "analysis_frames", params: ["handle"], returns: "bigint" },
  { name: "analysis_peaks_ptr", params: ["handle"], returns: "number" },
  { name: "analysis_peaks_len", params: ["handle"], returns: "number" },
  { name: "analysis_lufs", params: ["handle"], returns: "number" },
  { name: "analysis_lra", params: ["handle"], returns: "number" },
  { name: "analysis_true_peak_db", params: ["handle"], returns: "number" },
  { name: "analysis_spectrum_ptr", params: ["handle"], returns: "number" },
  { name: "analysis_spectrum_len", params: ["handle"], returns: "number" },
  { name: "analysis_take_loudness", params: ["handle"], returns: "number" },
  { name: "analysis_take_spectrum", params: ["handle"], returns: "number" },
  { name: "analysis_free", params: ["handle"], returns: "number" },
  { name: "chain_new", params: ["rate"], returns: "number" },
  {
    name: "chain_set",
    params: ["handle", "param", "value"],
    returns: "number",
  },
  {
    name: "chain_set_bypass",
    params: ["handle", "block", "bypassed"],
    returns: "number",
  },
  {
    name: "chain_set_eq_curve",
    params: ["handle", "gains", "len"],
    returns: "number",
  },
  {
    name: "chain_process",
    params: ["handle", "input", "inputFrames", "output", "outputFrames"],
    returns: "number",
  },
  { name: "chain_reset", params: ["handle"], returns: "number" },
  { name: "chain_latency", params: ["handle"], returns: "number" },
  { name: "chain_meter", params: ["handle", "meter"], returns: "number" },
  { name: "chain_free", params: ["handle"], returns: "number" },
  { name: "analysis_tempo", params: ["handle"], returns: "number" },
  { name: "analysis_key", params: ["handle"], returns: "number" },
  { name: "analysis_sections_ptr", params: ["handle"], returns: "number" },
  { name: "analysis_sections_len", params: ["handle"], returns: "number" },
  { name: "analysis_spectrogram_ptr", params: ["handle"], returns: "number" },
  { name: "analysis_spectrogram_len", params: ["handle"], returns: "number" },
  {
    name: "analysis_loudness_curve_ptr",
    params: ["handle"],
    returns: "number",
  },
  {
    name: "analysis_loudness_curve_len",
    params: ["handle"],
    returns: "number",
  },
  {
    name: "analysis_correlation_curve_ptr",
    params: ["handle"],
    returns: "number",
  },
  {
    name: "analysis_correlation_curve_len",
    params: ["handle"],
    returns: "number",
  },
  { name: "analysis_clipping_ptr", params: ["handle"], returns: "number" },
  { name: "analysis_clipping_len", params: ["handle"], returns: "number" },
  { name: "analysis_silence", params: ["handle"], returns: "number" },
  { name: "analysis_pitch_track_ptr", params: ["handle"], returns: "number" },
  { name: "analysis_pitch_track_len", params: ["handle"], returns: "number" },
  {
    name: "analysis_feature_ptr",
    params: ["handle", "series"],
    returns: "number",
  },
  {
    name: "analysis_feature_len",
    params: ["handle", "series"],
    returns: "number",
  },
  {
    name: "analysis_feature_range",
    params: ["handle", "series"],
    returns: "number",
  },
  { name: "offline_features_new", params: [], returns: "number" },
  {
    name: "offline_features_set",
    params: ["handle", "series", "bytes", "len", "min", "max"],
    returns: "number",
  },
  {
    name: "offline_features_set_loudness",
    params: ["handle", "lufs", "len"],
    returns: "number",
  },
  { name: "offline_features_free", params: ["handle"], returns: "number" },
  { name: "offline_align", params: ["a", "b"], returns: "number" },
  {
    name: "offline_diff_new",
    params: ["a", "b", "offsetMs"],
    returns: "number",
  },
  { name: "offline_diff_change_ptr", params: ["handle"], returns: "number" },
  { name: "offline_diff_change_len", params: ["handle"], returns: "number" },
  { name: "offline_diff_loudness_ptr", params: ["handle"], returns: "number" },
  { name: "offline_diff_loudness_len", params: ["handle"], returns: "number" },
  { name: "offline_diff_summary", params: ["handle"], returns: "number" },
  { name: "offline_diff_free", params: ["handle"], returns: "number" },
] as const satisfies readonly DspFunction[];

interface Returns {
  number: number;
  bigint: bigint;
  void: void;
}

type NumberArgs<Params extends readonly string[]> = {
  -readonly [P in keyof Params]: number;
};

/**
 * The instance's exports. A `u32` result (a pointer, a handle) arrives as a
 * signed number; `Dsp` reads it back unsigned.
 */
export type DspExports = { memory: WebAssembly.Memory } & {
  [F in (typeof DSP_FUNCTIONS)[number] as F["name"]]: (
    ...args: NumberArgs<F["params"]>
  ) => Returns[F["returns"]];
};

/** The most `f32`s one allocation can ask for: its byte count must fit a `u32`. */
const MAX_LENGTH = 2 ** 30 - 1;

interface TypedArrayKind<A> {
  new (length: number): A;
  new (buffer: ArrayBuffer, byteOffset: number, length: number): A;
  readonly BYTES_PER_ELEMENT: number;
}

export class DspError extends Error {
  readonly code: number;

  constructor(code: number, what: string) {
    const name = Object.entries(DspErrorCode).find(([, c]) => c === code)?.[0];
    super(`${what} failed: ${name ?? "unknown error"} (${code})`);
    this.name = "DspError";
    this.code = code;
  }
}

/** A typed handle on one instantiated module. One per host thread. */
export class Dsp {
  readonly exports: DspExports;

  constructor(exports: DspExports) {
    const version = exports.dsp_abi_version() >>> 0;
    if (version !== ABI_VERSION) {
      throw new Error(
        `dsp.wasm speaks ABI ${version}, this loader speaks ${ABI_VERSION}`
      );
    }
    this.exports = exports;
  }

  /**
   * Runs `fn` over `length` freshly allocated samples of module memory, then
   * frees them. Any call into the module may grow memory and detach `view`,
   * so `fn` writes through the view before its calls and reads results
   * through `readF32` after them. A length of 0 allocates nothing and passes
   * pointer 0.
   */
  withF32<T>(length: number, fn: (view: Float32Array, ptr: number) => T): T {
    return this.withArray(Float32Array, length, fn);
  }

  /** `withF32` over bytes. */
  withU8<T>(length: number, fn: (view: Uint8Array, ptr: number) => T): T {
    return this.withArray(Uint8Array, length, fn);
  }

  /** Copies `length` samples out of module memory at `ptr`. */
  readF32(ptr: number, length: number): Float32Array {
    return new Float32Array(
      this.exports.memory.buffer,
      ptr >>> 0,
      length
    ).slice();
  }

  /** Copies `length` bytes out of module memory at `ptr`. */
  readU8(ptr: number, length: number): Uint8Array {
    return new Uint8Array(
      this.exports.memory.buffer,
      ptr >>> 0,
      length
    ).slice();
  }

  private withArray<A extends Float32Array | Uint8Array, T>(
    kind: TypedArrayKind<A>,
    length: number,
    fn: (view: A, ptr: number) => T
  ): T {
    if (!Number.isInteger(length) || length < 0 || length > MAX_LENGTH) {
      throw new RangeError(`cannot allocate ${length} values`);
    }
    if (length === 0) return fn(new kind(0), 0);
    const bytes = length * kind.BYTES_PER_ELEMENT;
    const ptr = this.nonZero(this.exports.dsp_alloc(bytes), "dsp_alloc");
    try {
      return fn(new kind(this.exports.memory.buffer, ptr, length), ptr);
    } finally {
      this.exports.dsp_free(ptr, bytes);
    }
  }

  /** Throws unless `code`, an export's status result, is success. */
  check(code: number, what: string): void {
    if (code !== DspErrorCode.None) throw new DspError(code, what);
  }

  /**
   * Returns a pointer or handle read unsigned, or throws the module's last
   * error when it is 0, which is how `dsp_alloc` and every `*_new` fail.
   */
  nonZero(value: number, what: string): number {
    if (value === 0) throw new DspError(this.exports.dsp_last_error(), what);
    return value >>> 0;
  }
}

function fromInstance(instance: WebAssembly.Instance): Dsp {
  return new Dsp(instance.exports as unknown as DspExports);
}

/** Instantiates a compiled module synchronously, as an AudioWorklet must. */
export function instantiateSync(module: WebAssembly.Module): Dsp {
  return fromInstance(new WebAssembly.Instance(module, {}));
}

export async function instantiate(
  source: BufferSource | WebAssembly.Module
): Promise<Dsp> {
  const module =
    source instanceof WebAssembly.Module
      ? source
      : await WebAssembly.compile(source);
  return fromInstance(await WebAssembly.instantiate(module, {}));
}
