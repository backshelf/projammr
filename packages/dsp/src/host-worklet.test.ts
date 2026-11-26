import { expect, test } from "bun:test";

import { loadDsp } from "./host/worklet";
import { ABI_VERSION } from "./runtime";

const module = new WebAssembly.Module(
  await Bun.file(new URL("../pkg/dsp.wasm", import.meta.url)).bytes()
);

test("instantiates the compiled module the node passed in processorOptions", () => {
  const dsp = loadDsp({ processorOptions: { module } });
  expect(dsp.exports.dsp_abi_version()).toBe(ABI_VERSION);
});

test("refuses options that carry no compiled module", () => {
  expect(() => loadDsp(undefined)).toThrow(TypeError);
  expect(() => loadDsp({})).toThrow(TypeError);
});
