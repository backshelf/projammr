/**
 * Encodes a bounce's rendered channels to FLAC off the main thread. A plain
 * module worker — unlike `processor.worklet.ts`, it needs no separate build
 * step, since Turbopack bundles a `new Worker(new URL(...))` expression the
 * way webpack does; `bounce.ts` is what constructs it.
 *
 * libFLAC's WebAssembly build is imported here and nowhere else, so neither
 * its glue nor its binary joins the page's own bundle. The glue finds its
 * `.wasm` through `FLAC_SCRIPT_LOCATION`, a file-name-to-URL map it reads
 * when it evaluates, and it reads that from `process.env` whenever a
 * `process` exists — which Turbopack's polyfill makes true in a worker, so
 * the map goes there, pointing at the bundler's emitted URL, before the
 * dynamic import.
 */

import { encodeFlac24, whenFlacReady } from "@/lib/dsp/flac-encode";
import type { Flac } from "libflacjs";

/** What `bounce.ts` posts: the rendered channels and the rate they're at. */
export type FlacEncodeRequest = {
  sampleRate: number;
  channels: Float32Array[];
};

/** What the worker answers: the FLAC file's bytes, or why there are none. */
export type FlacEncodeResponse =
  { ok: true; flac: ArrayBuffer } | { ok: false; reason: string };

const WASM_FILE = "libflac.min.wasm.wasm";
const wasmUrl = new URL(
  "libflacjs/dist/libflac.min.wasm.wasm",
  import.meta.url
);

let library: Promise<Flac> | undefined;

function loadFlac(): Promise<Flac> {
  Object.assign(process.env, {
    FLAC_SCRIPT_LOCATION: { [WASM_FILE]: wasmUrl.href },
  });
  library ??= import("libflacjs/dist/libflac.min.wasm.js").then((module) =>
    whenFlacReady((module as unknown as { default: Flac }).default)
  );
  return library;
}

const reply = (response: FlacEncodeResponse, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(response, transfer);

self.onmessage = async (event: MessageEvent<FlacEncodeRequest>) => {
  const { sampleRate, channels } = event.data;
  try {
    const bytes = encodeFlac24(await loadFlac(), channels, sampleRate);
    reply({ ok: true, flac: bytes.buffer }, [bytes.buffer]);
  } catch (error) {
    reply({
      ok: false,
      reason:
        error instanceof Error
          ? error.message
          : "The bounce could not be encoded",
    });
  }
};
