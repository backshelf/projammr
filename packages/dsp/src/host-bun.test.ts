import { expect, test } from "bun:test";

import { dspWasmUrl, loadDsp } from "./host/bun";
import { ABI_VERSION } from "./runtime";

test("finds the built module in the package's pkg directory", async () => {
  const pkg = new URL("../pkg/dsp.wasm", import.meta.url);
  expect(dspWasmUrl.href).toBe(pkg.href);
  expect(await Bun.file(dspWasmUrl).exists()).toBe(true);
});

test("loads a module on the loader's ABI", async () => {
  const dsp = await loadDsp();
  expect(dsp.exports.dsp_abi_version()).toBe(ABI_VERSION);
});

test("each load is a separate instance with its own memory", async () => {
  const [a, b] = await Promise.all([loadDsp(), loadDsp()]);
  expect(a.exports.memory).not.toBe(b.exports.memory);
});
