// The typed host for dit.wasm, server-only: it reads the module from disk and
// instantiates it synchronously. The export surface is
// crates/dit-wasm/src/lib.rs; the ABI version below must match its
// `ABI_VERSION` (a test compares them).

import { readFileSync } from "node:fs";

/** Changes with any export's name, signature or meaning. */
export const ABI_VERSION = 1;

/** The DAW registry in registration order; a DAW's index is its position. */
export const DAWS = ["ableton"] as const;
export type Daw = (typeof DAWS)[number];

/** Codes `dit_last_error` reports. */
export const DitErrorCode = {
  None: 0,
  Malformed: 1,
  Corrupt: 2,
  Unsupported: 3,
  BadArgument: 4,
} as const;

/** What a set's parse yields: the JSON of the crate's `SetMeta`. */
export interface SetMeta {
  tempo: string | null;
  timeSignature: string | null;
  rootNote: string | null;
  scale: string | null;
  tracksCount: number | null;
  scenesCount: number | null;
  dawVersion: string | null;
  samplePaths: string[] | null;
  structure: SetStructure | null;
}

export interface SetStructure {
  tracks: StructureTrack[];
  clips?: { audio: number; midi: number };
  scenes?: number;
  plugins?: Record<string, { host: string; manufacturer?: string }>;
  truncated?: boolean;
}

export interface StructureTrack {
  kind: "audio" | "midi" | "return" | "group" | "master" | "other";
  name: string;
  devices: string[];
  id?: number;
  groupId?: number;
  color?: string;
}

interface DitExports {
  memory: WebAssembly.Memory;
  dit_abi_version(): number;
  dit_last_error(): number;
  dit_alloc(bytes: number): number;
  dit_free(ptr: number, bytes: number): void;
  dit_parse(daw: number, xml: number, len: number): number;
  dit_materialise(
    daw: number,
    pack: number,
    len: number,
    tree: number,
    side: number
  ): number;
  dit_result_ptr(handle: number): number;
  dit_result_len(handle: number): number;
  dit_result_free(handle: number): number;
}

const ID_LEN = 32;

export class DitError extends Error {
  readonly code: number;

  constructor(code: number, what: string) {
    const name = Object.entries(DitErrorCode).find(([, c]) => c === code)?.[0];
    super(`${what} failed: ${name ?? "unknown error"} (${code})`);
    this.name = "DitError";
    this.code = code;
  }
}

/** A typed handle on one instantiated module. */
export class Dit {
  readonly exports: DitExports;

  constructor(exports: DitExports) {
    const version = exports.dit_abi_version() >>> 0;
    if (version !== ABI_VERSION) {
      throw new Error(
        `dit.wasm speaks ABI ${version}, this loader speaks ${ABI_VERSION}`
      );
    }
    this.exports = exports;
  }

  /** Parses the gunzipped XML of a set into its `SetMeta`. */
  parse(daw: Daw, xml: Uint8Array): SetMeta {
    const index = dawIndex(daw);
    const bytes = this.withBytes(xml, (ptr) =>
      this.result(this.exports.dit_parse(index, ptr, xml.byteLength), "parse")
    );
    return JSON.parse(new TextDecoder().decode(bytes)) as SetMeta;
  }

  /**
   * Rebuilds the XML document of a save from a pack of its objects (records of
   * `[id 32][kind u8][body length u32 LE][body]`), the tree at `treeId` and the
   * side list Blob at `sideId`. The caller gzips the result.
   */
  materialise(
    daw: Daw,
    pack: Uint8Array,
    treeId: Uint8Array,
    sideId: Uint8Array
  ): Uint8Array {
    const index = dawIndex(daw);
    if (treeId.byteLength !== ID_LEN || sideId.byteLength !== ID_LEN) {
      throw new RangeError(`object ids are ${ID_LEN} bytes`);
    }
    return this.withBytes(pack, (packPtr) =>
      this.withBytes(treeId, (treePtr) =>
        this.withBytes(sideId, (sidePtr) =>
          this.result(
            this.exports.dit_materialise(
              index,
              packPtr,
              pack.byteLength,
              treePtr,
              sidePtr
            ),
            "materialise"
          )
        )
      )
    );
  }

  /** Copies `data` into freshly allocated module memory for the length of `fn`. */
  private withBytes<T>(data: Uint8Array, fn: (ptr: number) => T): T {
    if (data.byteLength === 0) return fn(0);
    const ptr = this.exports.dit_alloc(data.byteLength) >>> 0;
    if (ptr === 0) {
      throw new DitError(this.exports.dit_last_error(), "dit_alloc");
    }
    try {
      new Uint8Array(this.exports.memory.buffer, ptr, data.byteLength).set(
        data
      );
      return fn(ptr);
    } finally {
      this.exports.dit_free(ptr, data.byteLength);
    }
  }

  /** Copies a result out of module memory and frees it; 0 is a failure. */
  private result(handle: number, what: string): Uint8Array {
    if (handle === 0) throw new DitError(this.exports.dit_last_error(), what);
    try {
      const ptr = this.exports.dit_result_ptr(handle) >>> 0;
      const len = this.exports.dit_result_len(handle) >>> 0;
      return new Uint8Array(this.exports.memory.buffer, ptr, len).slice();
    } finally {
      this.exports.dit_result_free(handle);
    }
  }
}

function dawIndex(daw: Daw): number {
  return DAWS.indexOf(daw);
}

/**
 * The built module, found relative to this file: in a checkout and in the API
 * image alike, `packages/dit/pkg/dit.wasm` sits beside the package's source.
 */
export const ditWasmUrl = new URL("../pkg/dit.wasm", import.meta.url);

let compiled: WebAssembly.Module | undefined;

/**
 * The compiled module, read and compiled once per process. A module holds no
 * memory of its own, so sharing it is cheap; instances are made from it.
 */
export function compileDit(): WebAssembly.Module {
  if (compiled) return compiled;
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = readFileSync(ditWasmUrl);
  } catch {
    throw new Error(
      `dit.wasm not found at ${ditWasmUrl.pathname}: run \`bun run --filter @workspace/dit build\``
    );
  }
  compiled = new WebAssembly.Module(bytes);
  return compiled;
}

/**
 * A fresh instance of the compiled module, with memory of its own that is
 * reclaimed once the `Dit` is unreachable. Each call is a separate instance.
 */
export function loadDit(): Dit {
  const instance = new WebAssembly.Instance(compileDit(), {});
  return new Dit(instance.exports as unknown as DitExports);
}
