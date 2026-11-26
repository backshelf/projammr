import { describe, expect, test } from "bun:test";

import {
  ABI_VERSION,
  Dsp,
  DSP_FUNCTIONS,
  DspError,
  DspErrorCode,
  type DspExports,
  instantiate,
  instantiateSync,
} from "./runtime";

const bytes = await Bun.file(
  new URL("../pkg/dsp.wasm", import.meta.url)
).bytes();
const module = new WebAssembly.Module(bytes);

describe("the module's surface", () => {
  test("exports exactly the functions DSP_FUNCTIONS lists, with their parameter counts", () => {
    const { exports } = new WebAssembly.Instance(module, {});
    const exported = Object.fromEntries(
      Object.entries(exports).flatMap(([name, value]) =>
        typeof value === "function" ? [[name, value.length]] : []
      )
    );
    const listed = Object.fromEntries(
      DSP_FUNCTIONS.map(({ name, params }) => [name, params.length])
    );
    expect(exported).toEqual(listed);
  });

  test("exports its memory", () => {
    expect(instantiateSync(module).exports.memory).toBeInstanceOf(
      WebAssembly.Memory
    );
  });

  test("needs no imports, so every host instantiates it the same way", () => {
    expect(WebAssembly.Module.imports(module)).toEqual([]);
  });

  test("reports the ABI version the loader speaks", () => {
    expect(instantiateSync(module).exports.dsp_abi_version()).toBe(ABI_VERSION);
  });

  test("a module on another ABI version is refused", () => {
    const { exports } = instantiateSync(module);
    const other: DspExports = {
      ...exports,
      dsp_abi_version: () => ABI_VERSION + 1,
    };
    expect(() => new Dsp(other)).toThrow(`ABI ${ABI_VERSION + 1}`);
  });

  test("instantiates from bytes and from a compiled module alike", async () => {
    for (const source of [bytes, module]) {
      const dsp = await instantiate(source);
      expect(dsp.exports.dsp_abi_version()).toBe(ABI_VERSION);
    }
  });

  test("the error codes match DspError in rust/src/error.rs", async () => {
    const source = await Bun.file(
      new URL("../rust/src/error.rs", import.meta.url)
    ).text();
    const body = /pub enum DspError \{([^}]*)\}/.exec(source)?.[1] ?? "";
    const rust = Object.fromEntries(
      [...body.matchAll(/^\s*(\w+) = (\d+),/gm)].map(([, name, code]) => [
        name,
        Number(code),
      ])
    );
    expect(rust).toEqual({ ...DspErrorCode });
  });
});

describe("memory", () => {
  test("samples written before memory grows read back through a fresh view", () => {
    const dsp = instantiateSync(module);
    dsp.withF32(4, (view, ptr) => {
      view.set([1, 2, 3, 4]);
      const before = dsp.exports.memory.buffer;

      // 64 MB is far past the initial memory, so this allocation grows it.
      dsp.withF32(16 * 1024 * 1024, (big) => big.fill(0.5));

      expect(dsp.exports.memory.buffer).not.toBe(before);
      expect(view.length).toBe(0);
      expect(dsp.readF32(ptr, 4)).toEqual(new Float32Array([1, 2, 3, 4]));
    });
  });

  test("withF32 frees what it allocates, so repeated calls do not grow memory", () => {
    const dsp = instantiateSync(module);
    dsp.withF32(1 << 20, () => undefined);
    const size = dsp.exports.memory.buffer.byteLength;
    for (let i = 0; i < 100; i++) dsp.withF32(1 << 20, () => undefined);
    expect(dsp.exports.memory.buffer.byteLength).toBe(size);
  });

  test("withF32 of no samples allocates nothing", () => {
    const { exports } = instantiateSync(module);
    let allocations = 0;
    const counting = new Dsp({
      ...exports,
      dsp_alloc: (size) => {
        allocations++;
        return exports.dsp_alloc(size);
      },
    });
    counting.withF32(0, (view, ptr) => {
      expect(view.length).toBe(0);
      expect(ptr).toBe(0);
    });
    expect(allocations).toBe(0);
  });

  test("readF32 copies, so the copy outlives the allocation", () => {
    const dsp = instantiateSync(module);
    const copy = dsp.withF32(3, (view, ptr) => {
      view.set([0.25, 0.5, 0.75]);
      return dsp.readF32(ptr, 3);
    });
    dsp.withF32(3, (view) => view.fill(0));
    expect(copy).toEqual(new Float32Array([0.25, 0.5, 0.75]));
  });

  test("withU8 and readU8 do for bytes what withF32 and readF32 do for samples", () => {
    const dsp = instantiateSync(module);
    const copy = dsp.withU8(3, (view, ptr) => {
      view.set([1, 128, 255]);
      return dsp.readU8(ptr, 3);
    });
    dsp.withU8(3, (view) => view.fill(0));
    expect(copy).toEqual(new Uint8Array([1, 128, 255]));
    expect(() => dsp.withU8(-1, () => undefined)).toThrow(RangeError);
  });

  test("withF32 refuses a length that is not a sample count", () => {
    const dsp = instantiateSync(module);
    for (const length of [-1, 1.5, Number.NaN, 2 ** 30]) {
      expect(() => dsp.withF32(length, () => undefined)).toThrow(RangeError);
    }
  });
});

describe("errors", () => {
  test("allocating zero bytes returns 0 and leaves BadArgument as the last error", () => {
    const { exports } = instantiateSync(module);
    expect(exports.dsp_alloc(0)).toBe(0);
    expect(exports.dsp_last_error()).toBe(DspErrorCode.BadArgument);
  });

  test("an allocation memory cannot hold throws OutOfMemory from withF32", () => {
    const dsp = instantiateSync(module);
    let error: unknown;
    try {
      dsp.withF32(2 ** 30 - 1, () => undefined);
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toBeInstanceOf(DspError);
    expect((error as DspError).code).toBe(DspErrorCode.OutOfMemory);
  });

  test("nonZero throws the module's last error for a failed call", () => {
    const dsp = instantiateSync(module);
    expect(() => dsp.nonZero(dsp.exports.dsp_alloc(0), "dsp_alloc")).toThrow(
      "dsp_alloc failed: BadArgument (2)"
    );
  });

  test("check passes success and throws a DspError carrying any other code", () => {
    const dsp = instantiateSync(module);
    expect(() => dsp.check(DspErrorCode.None, "push")).not.toThrow();
    expect(() => dsp.check(DspErrorCode.BadHandle, "push")).toThrow(
      new DspError(DspErrorCode.BadHandle, "push")
    );
  });

  test("freeing a null pointer is ignored", () => {
    const { exports } = instantiateSync(module);
    expect(() => exports.dsp_free(0, 16)).not.toThrow();
  });
});
