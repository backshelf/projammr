import { type Dsp, instantiate } from "../runtime.js";

/** The module as a bundler-emitted asset URL. */
export const dspModuleUrl = new URL("../../pkg/dsp.wasm", import.meta.url);

let compiled: Promise<WebAssembly.Module> | undefined;

/**
 * Compiles the module once per page. The `WebAssembly.Module` is also what an
 * AudioWorkletNode receives in `processorOptions` (see `host/worklet.ts`). A
 * failed compile is forgotten, so the next call tries again.
 */
export function compileDsp(): Promise<WebAssembly.Module> {
  compiled ??= WebAssembly.compileStreaming(fetch(dspModuleUrl)).catch(
    (error: unknown) => {
      compiled = undefined;
      throw error;
    }
  );
  return compiled;
}

/** A main-thread instance of the page's compiled module. */
export async function loadDsp(): Promise<Dsp> {
  return instantiate(await compileDsp());
}
