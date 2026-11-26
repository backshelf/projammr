/**
 * What `capture.ts` uses to write a shot: where it goes, the `agent-browser`
 * call that drives a session, and the WebP encoding with its size budget.
 */
import { $ } from "bun";
import { resolve } from "node:path";
import type { Viewport } from "./manifest";

export const OUT_DIR = resolve(import.meta.dir, "../../src/assets/screenshots");
/** A shot over this after encoding is re-encoded at lower quality. */
export const BUDGET_BYTES = 250 * 1024;
const QUALITIES = [82, 74, 66, 58];
/** Phone shots are taken at the device's 3× and stored at 2×. */
const PHONE_WIDTH = 780;

/** Runs one `agent-browser` command in a named session and returns its output. */
export async function browser(session: string, args: string[]) {
  const result = await $`agent-browser --session ${session} ${args}`
    .nothrow()
    .quiet();
  if (result.exitCode !== 0) {
    throw new Error(
      `agent-browser ${args.join(" ")}: ${result.stderr.toString() || result.stdout.toString()}`
    );
  }
  return result.stdout.toString();
}

/** Writes `png` to `target` as WebP and returns its size in bytes. */
export async function encode(png: string, target: string, viewport: Viewport) {
  for (const quality of QUALITIES) {
    let image = Bun.file(png).image();
    if (viewport === "phone") image = image.resize(PHONE_WIDTH);
    await image.webp({ quality }).write(target);
    const size = Bun.file(target).size;
    if (size <= BUDGET_BYTES || quality === QUALITIES.at(-1)) return size;
  }
  return Bun.file(target).size;
}
