// Writes src/params.ts from the parameter table in rust/src/play/params.rs.
// `cargo test` fails until the committed file matches the table again.
import { $ } from "bun";

const CRATE = new URL("../rust/", import.meta.url).pathname;
const OUT = new URL("../src/params.ts", import.meta.url).pathname;

const text = await $`cargo run --quiet --example params`.cwd(CRATE).text();
await Bun.write(OUT, text);
console.log(`wrote ${OUT}`);
