import { type Dsp, instantiate } from "../runtime.js";

/**
 * The built module, found relative to this file: in a checkout and in the API
 * image alike, `packages/dsp/pkg/dsp.wasm` sits beside the package's source.
 */
export const dspWasmUrl = new URL("../../pkg/dsp.wasm", import.meta.url);

/** Reads and instantiates the module; each call is a separate instance. */
export async function loadDsp(): Promise<Dsp> {
  return instantiate(await Bun.file(dspWasmUrl).arrayBuffer());
}
