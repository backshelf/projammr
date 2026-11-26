import { compileDsp } from "@workspace/dsp/host/browser";
import { ABI_VERSION } from "@workspace/dsp/runtime";

/**
 * The DSP processor loaded into a context: the `projammr-dsp` module
 * registered on its `audioWorklet`, and the `dsp.wasm` `Module` every node
 * receives in `processorOptions`. `unsupported` means the browser has no
 * AudioWorklet; `failed` means the module or the WebAssembly did not load.
 */
export type ProcessorLoad =
  | { ok: true; module: WebAssembly.Module }
  | { ok: false; reason: "unsupported" | "failed" };

/**
 * Loads the DSP processor into `ctx`. The worklet module is versioned by
 * `ABI_VERSION` on the query string so a deploy never pairs a cached
 * processor with a newer `dsp.wasm`, and `compileDsp` compiles the WebAssembly
 * once per page, so every node shares the one `Module` and instantiates its
 * own memory.
 */
export async function loadProcessor(
  ctx: BaseAudioContext
): Promise<ProcessorLoad> {
  const worklet = ctx.audioWorklet as AudioWorklet | undefined;
  if (!worklet || typeof AudioWorkletNode === "undefined") {
    return { ok: false, reason: "unsupported" };
  }
  try {
    const [, module] = await Promise.all([
      worklet.addModule(`/dsp-processor.js?v=${ABI_VERSION}`),
      compileDsp(),
    ]);
    return { ok: true, module };
  } catch {
    return { ok: false, reason: "failed" };
  }
}
