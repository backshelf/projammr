// Builds pkg/dsp.wasm: the crate for wasm32-unknown-unknown, then wasm-opt,
// then a gzipped size gate. Needs cargo (rust/rust-toolchain.toml picks the
// toolchain) and wasm-opt 116 or later on PATH.
import { $ } from "bun";

const CRATE = new URL("../rust/", import.meta.url).pathname;
const PKG = new URL("../pkg/", import.meta.url).pathname;
const OUT = `${PKG}dsp.wasm`;
const RAW = `${CRATE}target/wasm32-unknown-unknown/release/projammr_dsp.wasm`;

/** Gzipped bytes the module may not exceed; the client downloads it once per deployment. */
const SIZE_GATE_GZIP = 160 * 1024;

// `+simd128` lets the compiler auto-vectorise. wasm-opt refuses a module that
// uses a feature it was not told about, and Rust's output for this target
// uses every one of these.
const OPT_FEATURES = [
  "--enable-simd",
  "--enable-bulk-memory",
  "--enable-nontrapping-float-to-int",
  "--enable-sign-ext",
  "--enable-mutable-globals",
  "--enable-reference-types",
  "--enable-multivalue",
];

await $`cargo build --release --target wasm32-unknown-unknown`
  .cwd(CRATE)
  .env({ ...process.env, RUSTFLAGS: "-C target-feature=+simd128" });
await $`mkdir -p ${PKG}`;
await $`wasm-opt -Oz ${OPT_FEATURES} ${RAW} -o ${OUT}`;

const bytes = await Bun.file(OUT).bytes();
const gzipped = Bun.gzipSync(bytes).byteLength;
const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
if (gzipped > SIZE_GATE_GZIP) {
  throw new Error(
    `dsp.wasm is ${kb(gzipped)} gzipped, over the ${kb(SIZE_GATE_GZIP)} gate`
  );
}
console.log(`dsp.wasm: ${kb(bytes.byteLength)}, ${kb(gzipped)} gzipped`);
