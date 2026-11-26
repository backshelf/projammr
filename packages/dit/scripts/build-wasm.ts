// Builds pkg/dit.wasm: the dit-wasm crate for wasm32-unknown-unknown, then
// wasm-opt, then a gzipped size gate. Needs cargo (rust-toolchain.toml picks
// the toolchain) and wasm-opt 116 or later on PATH.
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { $ } from "bun";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PKG = join(ROOT, "pkg");
const OUT = join(PKG, "dit.wasm");
const RAW = join(
  ROOT,
  "target",
  "wasm32-unknown-unknown",
  "release",
  "dit_wasm.wasm"
);

/** Gzipped bytes the module may not exceed. */
const SIZE_GATE_GZIP = 1024 * 1024;

// wasm-opt refuses a module that uses a feature it was not told about, and
// Rust's output for this target uses every one of these.
const OPT_FEATURES = [
  "--enable-bulk-memory",
  "--enable-nontrapping-float-to-int",
  "--enable-sign-ext",
  "--enable-mutable-globals",
  "--enable-reference-types",
  "--enable-multivalue",
];

await $`cargo build -p dit-wasm --release --target wasm32-unknown-unknown`.cwd(
  ROOT
);
await $`mkdir -p ${PKG}`;
await $`wasm-opt -Oz ${OPT_FEATURES} ${RAW} -o ${OUT}`;

const bytes = await Bun.file(OUT).bytes();
const gzipped = Bun.gzipSync(bytes).byteLength;
const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
if (gzipped > SIZE_GATE_GZIP) {
  throw new Error(
    `dit.wasm is ${kb(gzipped)} gzipped, over the ${kb(SIZE_GATE_GZIP)} gate`
  );
}
console.log(`dit.wasm: ${kb(bytes.byteLength)}, ${kb(gzipped)} gzipped`);
