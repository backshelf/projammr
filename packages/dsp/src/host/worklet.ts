import { type Dsp, instantiateSync } from "../runtime.js";

/** What a DSP processor's node carries in `processorOptions`. */
export interface DspProcessorOptions {
  /** The main thread's compiled `dsp.wasm` (`compileDsp` in `host/browser.ts`). */
  module: WebAssembly.Module;
}

/**
 * Instantiates the module inside an AudioWorkletProcessor's constructor.
 * Synchronous instantiation is allowed off the main thread at any module size.
 */
export function loadDsp(options?: {
  processorOptions?: DspProcessorOptions;
}): Dsp {
  const module: unknown = options?.processorOptions?.module;
  if (!(module instanceof WebAssembly.Module)) {
    throw new TypeError("processorOptions.module is not a compiled dsp.wasm");
  }
  return instantiateSync(module);
}
