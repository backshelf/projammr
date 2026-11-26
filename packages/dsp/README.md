# `@workspace/dsp`

The audio maths that the server, the page, and the AudioWorklet share. The maths is a Rust crate compiled to one
WebAssembly module, `pkg/dsp.wasm`, and a TypeScript loader runs that module in all three hosts. `src/spectrum.ts`
holds the spectrum layout and display helpers; `src/analysis.ts` wraps one streaming `Analysis` session (peaks,
BS.1770 loudness, the long-term average spectrum), `src/live.ts` wraps its live per-hop readouts, and
`src/offline.ts` reads the analyses the session computes when it finishes (tempo, key, sections, spectrogram,
curves, clipping, silence, pitch track, feature buffers) and compares two versions from their stored features.

## Prerequisites

- Rust 1.97.1 with the `wasm32-unknown-unknown` target, clippy, and rustfmt. `rust/rust-toolchain.toml` pins these,
  so rustup installs them on the first `cargo` command in `rust/`.
- `wasm-opt` version 116 or later on `PATH`. Install it with `cargo install wasm-opt` or your distribution's
  `binaryen` package.

## Scripts

| Script              | What it does                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| `bun run build`     | `cargo build` for `wasm32-unknown-unknown`, then `wasm-opt -Oz`, then a 160 KB gzipped size gate |
| `bun run params`    | Regenerates `src/params.ts` from the parameter table in `rust/src/play/params.rs`                |
| `bun run test`      | `cargo test` in `rust/`, then `bun test` over the built `pkg/dsp.wasm`                           |
| `bun run lint`      | `cargo clippy -D warnings` for the wasm target, then ESLint                                      |
| `bun run typecheck` | `bun check`                                                                                      |
| `bun run format`    | Prettier, then `cargo fmt`                                                                       |

`pkg/` is never committed. turbo builds it before any task that depends on this package, and
`bun run --filter @workspace/dsp build` from the repository root builds it on its own.

## Layout

```
rust/src/lib.rs        The export surface: every #[unsafe(no_mangle)] function, and nothing else
rust/src/error.rs      DspError, the codes every export reports, and the last-error slot
rust/src/registry.rs   Objects behind generational u32 handles, and the *_new / *_free shape
rust/src/util/         Shared building blocks: FFT plans per size, Hann windows, mel filterbanks
rust/src/analysis/     The Analysis session: peaks, loudness, spectrum, live per-hop readouts, offline analyses
rust/src/play/         The Lab's playback blocks, the parameter table and the Chain
scripts/build.ts       cargo → wasm-opt → pkg/dsp.wasm, with the size gate
scripts/params.ts      Writes src/params.ts from the Rust parameter table
src/runtime.ts         The typed loader: Dsp, instantiate, instantiateSync, DSP_FUNCTIONS
src/analysis.ts        AnalysisSession: the typed wrapper over one analysis_* session
src/live.ts            createLiveLoudnessMeter/createLiveSpectrumMeter: process/take meters over it
src/offline.ts         OfflineAnalyses over a finished session; FeatureSet, alignFeatures, diffFeatures
src/params.ts          Generated: block, parameter and meter ids, with each parameter's domain
src/chain.ts           Chain: typed setters and a pull-model process over the chain_* exports
src/host/bun.ts        Reads pkg/dsp.wasm next to the package source (the server)
src/host/browser.ts    Compiles the module once per page from a bundler asset URL
src/host/worklet.ts    Instantiates the page's compiled module inside a processor constructor
```

## The ABI

The module exports numbers only. The AudioWorklet global scope has no `TextDecoder`, so there is no generated glue
and no string crosses the boundary. Every export follows these rules:

- Names are `snake_case`, prefixed by the object kind (`analysis_*`, `chain_*`), or `dsp_*` for the module itself.
- An object lives behind a non-zero `u32` handle. `*_new` returns 0 on failure, and `dsp_last_error()` then gives
  the reason. Every other call that can fail returns a `DspError` code, 0 on success.
- Sample data is interleaved `f32` in memory that the host allocates with `dsp_alloc(bytes)` and frees with
  `dsp_free(ptr, bytes)`.
- Results come back as a `*_ptr` and `*_len` pair that points into storage the object owns. The pointer stays valid
  until the next call on that handle, so the loader copies immediately.
- Any call can grow memory, which detaches every view over the old buffer. The loader creates a view after the calls
  that can grow memory, never before.
- Bad input returns an error code. A panic aborts, and the host sees a trap, so a trap is always a bug.

To add an export, do the following:

1. Write it in `rust/src/lib.rs`, holding any object kind in a `registry::Table`.
2. Append its name, parameter names, and result kind to `DSP_FUNCTIONS` in `src/runtime.ts`. `DspExports` derives
   its type from that list, and `runtime.test.ts` fails when the built module and the list disagree.
3. If the change alters an existing export's name, signature, or meaning, increment `ABI_VERSION` in both
   `rust/src/lib.rs` and `src/runtime.ts`.
